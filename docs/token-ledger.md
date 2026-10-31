# 增量式 Token 账本（dsh-usage 1.5.0 起，1.6.0 迁址 · 已实施）

> 目标读者：要动手改 `index.js` / `client.js` 的人（也包括三个月后的我自己）。
> 本文给出**可执行的实现口径**：数据模型、每轮同步算法、调度、原子写、面板改动、验证方式。
> 文中数字全部来自本机实测（149 个会话 / 72.6 MB 会话日志），测量脚本与原型在 `.local/`（不进仓库）。

## 0. 实施记录（1.5.0）

方案已按本文落地，落点如下：

| 位置 | 内容 |
|---|---|
| `lib/ledger.js` | 账本本体：折叠原语、`syncLedger`、`ledgerView`、`mergeLedgers`、原子读写 |
| `index.js` | `GET /api/usage/usage` 改由账本作答；`syncIntervalMs` 定时同步 + 激活预热 + dispose 落盘 |
| `client.js` | 概览条下的账本说明行（起始时刻、上次更新、本机现存日志、已删除会话数） |
| `tools/seed-ledger.mjs` | 无 Host 时建账；`--backfill --from <备份目录>` 只加不改地补记已删会话 |
| `test/selfcheck.mjs` | 新增 A2 节：26 条账本断言（只增不减的全套不变量 + 存储层） |

本机实测（149 个现存会话 + 一份 296 个会话的旧备份，其中 169 个已从磁盘删除）：

| 项 | 数字 |
|---|---|
| 账本总用量 | 补记后 = 现存活 + 已删会话补记（两者相加与备份折叠结果逐会话一致；约 1/3 来自现存日志、约 2/3 来自已删会话）。具体数字属本机用量，按 `AI推送须知.md` 口径不进仓库 |
| 账本行数 | 318 行（149 现存 / 169 已删），其中 26 行按 `session-` 前缀拼写（见下条） |
| id 拼写 | 本机 149 个目录里 123 个是裸 UUID、26 个带 `session-` 前缀（id 世代不同）。账本按**目录名原文**记键；同一会话换拼写出现时**就地改名收养**，合并写盘时把成对拼写**折叠成一行**，否则同一段历史会被记两次 |
| 补记来源 | `~/.dsh.backup-<日期>-<时间>/sessions`（296 个会话，其中 127 个仍是现存活会话，已跳过） |
| 首次建账 | 2 665 ms（真机全量同步 2 665–3 068 ms） |
| 空闲同步 | 2 ms，0 次日志读取（整条请求 49 ms，含进程启动） |
| 面板命中缓存的一次读取 | 2 ms |
| 账本文件 | 186 KB |

补记之后，"累计"比"本机现存日志"多出来的正好是那 169 个已删除会话的用量；这正是概览条下面那一行的读法。

## 0.5 一句话结论

把「每次打开面板都从头折叠全部会话日志」换成**持久化账本**：每条会话记住读到哪了，每轮只读新增事件并累加；
会话从磁盘消失只打标记、绝不扣减。实测建账一次 2.1–3.1 s，之后空闲 tick **2 ms、零日志读取**（含请求 49 ms），
面板读取合并 0.08 ms，账本文件约 70 KB / 149 会话（≈0.46 KB/会话）。

## 0.6 1.6.0：账本迁到每用户数据目录

1.5.0 把账本写在 `$DSH_HOME/usage-ledger/` 下，它跟着 Harness 的 home 走：换一个 home、卸载重装 DSH，就等于换了一份账本，
面板上的累计会看起来倒退。1.6.0 把账本迁到**每用户的操作系统数据目录**，刻意同时离开插件目录和 DSH home；
旧位置的账本在首次加载时合并进来，原文件不移动也不删除。

| 位置 | 内容 |
|---|---|
| `lib/ledger.js` | `resolveDataRoot` / `resolveLedgerPath`（忽略 `DSH_HOME`）、`resolveLegacyLedgerPaths`、`resolveImportRecordPath`、`loadLedgerWithInheritance`、`imported.json` 读写 |
| `index.js` | 首次加载走 `loadLedgerWithInheritance`；响应里的 `scan.ledgerPath` 把账本路径交给面板 |
| `client.js` | 说明行的浮层显示账本文件路径，并写明卸载插件 / 重装 DSH 都不会丢 |
| `tools/seed-ledger.mjs` | 与面板同一个缺省路径，同样继承旧账本；`--dry-run` 不导入也不写盘 |
| `test/selfcheck.mjs` | 存储位置、继承与「卸载 + 重装后累计不变」的断言 |

落点表、回退顺序与继承规则见 §3.1；配置文件口径见 §5；写盘与多实例见 §6。

## 1. 目标与非目标

目标：

1. **累计数字单调不减**：删会话、删日志、换机器目录都不影响已经记下的累计。
2. **不重复读历史**：未变化的会话一轮同步**一次日志都不打开**。
3. **后台定时记录**：可配置间隔（默认 10 分钟），闲时也往前走。
4. **不依赖恢复会话**：只记用量，不复制、不复原、不碰会话文件本身。

非目标：

- 不做防伪（个人自用，读的是自己机器上的日志）。
- 不恢复已经删掉的历史（建账时点之前被删的用量找不回来 —— 要找回得先恢复备份再建账，见 §8）。
- 不改会话日志格式、不改 provider 额度那条慢路径。

## 2. 可用的原料（对宿主接口的事实核对）

| 接口 | 给什么 | 成本（实测） |
|---|---|---|
| `sessionPersistence.list()` | 每条会话 `{header, revision, sizeBytes}`；只读 header 帧 + `stat`，**不带 eventCount** | 149 会话 56 ms（纯目录扫描+stat 10 ms） |
| `handle.read(offset, n)` | `{events}`，按**数组下标**切片；后端每次调用整份解码（revision 未变时命中 memo，直接复用已冻结事件） | 最大会话 2.0 MB ≈ 28 ms |
| `revision` | `dev:ino:size:mtimeNs` 形态的物理标识，用来判断「这条会话动过没有」 | 免费（在 list() 里） |

三条必须记住的坑：

1. **offset 是事件数组下标**。`read(offset, n)` 按数组下标切片；`events` **不含** header 记录（header 在快照的 `header` 字段里）。
   本机 149 个会话的 seq 都从 0 稠密、与下标一致（`isSeeded` 的 3 个也一样），但别把这个巧合写死：
   `offset` 按「**已消费事件数**」记，并用 `firstSeq === lastSeq + 1` 交叉校验（§4 铁律 2）。
2. **`read()` 不是真随机读**：无论 offset 多大多小，后端都整份解码再切片。
   好消息是 memo 让「没变过的会话」零成本；坏消息是「变了的会话」成本 ∝ 它自己的文件大小，与 offset 无关。
   因此判据必须是**先判断要不要读**，而不是靠小 offset 省 CPU。
3. **`list()` 不区分归档**：归档会话只要日志还在盘上就照常出现在 list() 里，账本照常计入 —— 这正是我们要的行为。

## 3. 数据模型

账本文件放在**每用户的操作系统数据目录**（§3.1）：`…/dsh-usage/ledger.json`。同目录另外两个文件：
`ledger.json.bak`（上一次成功写盘的副本）与 `imported.json`（旧账本的导入记录，见 §3.1）。

```jsonc
{
  "version": 1,
  "createdAt": 1792855000000,   // 建账时刻（面板不显示它：说明行显示的是覆盖到的第一天）
  "updatedAt": 1792859000000,   // 最后一次成功同步
  "sessions": {
    "<session-id>": {
      "project": "--D-AI-...--",
      "offset": 4821,           // 已消费事件数（下一次从数组下标 4821 读）
      "lastSeq": 4820,          // 最后一个已消费事件的 seq（连续性校验用）
      "revision": "1234:5678:900112:1792859000000000000",
      "sizeBytes": 2058546,
      "firstSeenAt": 1792300000000,
      "lastSeenAt": 1792859000000,
      "goneAt": null,           // 非 null = 日志已从磁盘消失；只打标记，贡献继续留在累计里
      "days": {                 // 该会话自己按本地日历日折出来的贡献（唯一真相来源）
        "2026-10-18": {
          "input": 40476, "output": 16740,
          "cacheRead": 4055120, "cacheWrite": 0, "requests": 137,
          "providers": { "opencode-go": { "input": 0, "...": "同形状" } }
        }
      }
    }
  }
}
```

设计取舍：

- **只存「每条会话的按天贡献」**，不落盘全局汇总。面板要的 `totals` / `days` / `today` 在读取时由所有会话行（含 `gone` 的）合并得到——
  一份数据一个真相，不会出现「汇总和明细对不上」。合并成本实测 0.05 ms/次。
- **键是宿主报告的会话 id 原文**（也就是日志目录名），不做任何规范化。宿主的 id 有过两种拼写
  （2026 年某版起带 `session-` 前缀），本机两种都还在盘上，所以「同一会话、两种键」是必须处理的第一类边界：
  - 同步时，精确 id 不存在但另一种拼写存在 → **把那行改名成新 id**（`adoptOtherSpelling`，用量原样保留，结果里计 `adopted`）；
  - 写盘合并时，两种拼写同时存在 → **折叠成一行**（取 `offset` 更大者，平局留带前缀的那行）。只做同步侧改名是不够的：
    磁盘上的旧键会在下一次合并时被「补回来」，于是同一会话两条活行、历史被记两次。
- **每会话按天 + provider 拆开存**，因为面板的选中日明细要显示 provider 构成（`client.js` 的 `dsu-providers`）。
- 体积：69 KB / 149 会话 ≈ 0.46 KB/会话，2000 会话约 1 MB，全天候读写无压力。

### 3.1 账本放在哪（1.6.0）

`resolveLedgerPath()` 先看 `$DSH_USAGE_LEDGER`（给的是**完整文件路径**，测试或确实要指向别处时的逃生门），
否则落在每用户数据目录下的 `dsh-usage/ledger.json`：

| 平台 | 缺省位置 | 回退 |
|---|---|---|
| Windows | `%LOCALAPPDATA%\dsh-usage\ledger.json` | `%APPDATA%\dsh-usage\ledger.json` → `%USERPROFILE%\AppData\Local\dsh-usage\ledger.json` |
| macOS | `~/Library/Application Support/dsh-usage/ledger.json` | —— |
| Linux / 其他 | `$XDG_DATA_HOME/dsh-usage/ledger.json` | 缺省 `~/.local/share/dsh-usage/ledger.json` |

**离开 DSH home 是刻意的**：插件目录与 DSH home 都可能随卸载 / 重装被删除或替换，而用量历史要比它们活得久。
所以 `$DSH_HOME` 只影响 Harness 自己的东西，**不再影响账本落在哪**；profile 的配置也搬不动它。

旧账本继承（`loadLedgerWithInheritance()`）：首次加载时把 1.5.0 及更早的位置合并进来。旧位置是
`$DSH_HOME/usage-ledger/ledger.json` 与 `~/.dsh/usage-ledger/ledger.json`（`DSH_HOME` 未设置时两者是同一个文件；
设成别处时两个 home 都看）；候选路径按解析后的绝对路径去重（Windows 上再折叠大小写），并排除新位置自己：

- 按会话取 `offset` 更大的那一行（它包含另一行的全部事件），`createdAt` 取更早的，其余沿用 §6 的合并规则；
- 合并后写盘一次，旧文件**原样留在原处**：不移动、不删除、不截断——本机可能还装着旧版 Harness 在写它；
- 新位置旁边的 `imported.json` 记住每个旧文件的 `size` + `mtime` + 导入时刻，所以同一个版本只导入一次；
  旧文件以后又被旧版 Harness 推进（大小或 mtime 变了）才会再次合并；
- 删掉 `ledger.json` 与 `ledger.json.bak` 是「清零」，`imported.json` 不删，旧历史因此不会重新长回来；
  确实要从旧账本重导一次时才连它一起删。

`imported.json` 的形状（键是旧账本的绝对路径，Windows 上按小写折叠；坏记录按「没有记录」处理，等价于重新导入，这一步幂等）：

```jsonc
{
  "version": 1,
  "sources": {
    "<旧账本绝对路径>": { "size": 102400, "mtimeMs": 1792859000000, "at": 1792859100000 }
  }
}
```

## 4. 每轮同步算法

```text
sync():
  snapshots = await persistence.list()          // 56 ms，只读 header + stat
  live = new Set()
  for snap of snapshots:
    live.add(snap.header.id)
    prev = sessions[snap.header.id] ?? adopt(sessions, snap.header.id)   // 换了 id 拼写：就地改名收养，用量保留
    if prev && prev.goneAt === null && prev.revision === snap.revision:
        continue                                 // 零日志读取，本轮最常见
    if !prev:                                    // 新会话：整份读，一次性建行
        page = readAll(id); days = fold(page.events)
        sessions[id] = { offset: page.events.length, lastSeq: last(days), revision, sizeBytes, days }
        continue
    if snap.sizeBytes < prev.sizeBytes:          // 变小：迁移/重写/外部截断
        warn('log shrank'); continue             // 只告警，绝不回退已记的累计
    // 变大：只读尾部（分页循环，直到读到空页）
    page = read(prev.offset, PAGE)
    if firstSeq(page) !== prev.lastSeq + 1:      // seq 不连续 = 日志被重排
        warn('seq mismatch'); continue
    days = fold(page.events, prev.days)          // 累加进该会话已有贡献
    prev.offset += page.events.length; prev.lastSeq = ...; prev.revision/sizeBytes = ...
  for [id,row] of sessions:                      // 磁盘上没了
    if !live.has(id) && row.goneAt === null:
        row.goneAt = now; row.lastSeenAt = now     // 只打标记、不扣减；lastSeenAt 让合并写保留标记
  persist()                                      // 原子写 + .bak
```

三条铁律（比算法本身更重要）：

1. **只加不减**。任何异常分支的处理都是「保持原样 + 告警」，唯一会减少累计的操作是人工删账本文件。
2. **连续性校验**：新读到的第一个事件的 `seq` 必须等于 `lastSeq + 1`；不等就说明这条日志被重排/重写过，
   宁可这一轮不计，也不猜。
3. **异常不中断整轮**：单条会话读失败只记 `warnings`，其余会话照常推进（沿用现有 `collectUsage` 的告警风格）。

两个容易被忽略的补充：

- **分页**：一次 `read` 只取 `READ_PAGE`（512）条，要循环到空页为止；`offset` 每页推进，`lastSeq` 只记最后一页的。
- **同一会话换拼写**：`adopt` 只认「另一种拼写的那一行」——`session-<uuid>` ↔ `<uuid>`，uuid 唯一，所以不可能是两条会话。
  收养后 `revision` 变了 → 走「变大」分支从旧 `offset` 往后读，等于零成本（日志没变时读到空页）。
- **删掉又放回来**（从备份恢复）：行还在（`goneAt` 非空），revision 变了 → 走「变大」分支，从旧 `offset` 往后读，
  已经记过的事件不会重复计，多出来的部分照常计入。这正是「先恢复备份、再建账」和「先建账、后恢复备份」都安全的根据。

## 5. 调度

| 时机 | 动作 | 说明 |
|---|---|---|
| 激活后 `WARMUP_DELAY_MS`（2.5 s） | 建账 / 同步一次 | 复用现有 warm-up 钩子，避开启动竞争 |
| 定时器 `syncIntervalMs`（默认 600 000 = 10 分钟，下限 60 000） | 同步一次 | `setInterval` + `unref()`，不挡进程退出 |
| `GET /api/usage/usage` | 15 s TTL 内直接回账本；过期则**同步一次再回** | 打开面板立刻看到最新；同步本身空闲时只有 26 ms |
| `x-usage-force: 1` | 同步一次 | 面板「刷新」按钮 |
| 插件 dispose | `clearInterval` + 最后一次写盘 | `ctx.effect` 的清理函数里做 |

**单飞**：`let inFlight` —— 定时器与请求触发的同步互斥，后到的直接 await 前一次的结果，不叠加。

配置走 `cordis.patch.yml`：

```yaml
- id: usage-panel
  config:
    syncIntervalMs: 600000     # 后台记录间隔，下限 60000
```

账本位置**不是配置项**：`$DSH_USAGE_LEDGER`（完整文件路径）是唯一的覆盖方式，只在测试或确实要指向别处时当逃生门用；
profile 的配置改不动它，`$DSH_HOME` 也不行（§3.1）。

## 6. 写盘与多实例

- **原子写**：`ledger.json.tmp` → `rename`；写前把旧文件复制成 `.bak`（旧主文件损坏时保留上一份可解析的 `.bak`；从 `.bak` 恢复后再次写盘不会把坏文件拷成备份）。中途崩溃最多丢一轮同步，不会写坏。
- **合并写的平局规则**：两行 `offset` 相同时，「谁读得更多」分不出高下，此时必须取 `lastSeenAt` 更新的那一行
  （连同它的 `revision` / `sizeBytes` / `goneAt`）。若平局时留下磁盘上的旧行，刚同步好的 `revision` 会被丢掉，
  下一轮又看到「变了」，于是每一轮都重读一遍刚刚读完的日志——实测就是这么把 2 ms 空闲 tick 变成 2.7 s 全量扫描的。
  自检里为此留了断言（`ledger: a tie keeps the fresher revision`）。
- **合并写**（两个 DSH 窗口同时跑时）：写盘前重新读一次磁盘上的文件，按会话 id 合并：
  同一 id 取 `offset` 更大的那行（它包含更早那行的全部事件）；`offset` 相同时取 `lastSeenAt` 更新的一行，
  它的 `revision` / `sizeBytes` / `goneAt` 随之一并取胜（§6 的平局规则），`createdAt` 取更早的。
  这样「后写的覆盖先写的」不会造成同一个事件被记两次（offset 是绝对位置，回退才会重复计）。
  标记「已删除」时同样更新 `lastSeenAt`：否则平局会让磁盘上 `goneAt: null` 的旧行赢回来，标记永远写不进盘
  （1.6.0 修复，自检里留了 `ledger store: a gone mark survives the merge-on-save`）。
- **继承先于同步**：`loadLedgerWithInheritance()` 在第一次同步之前把旧位置的账本并进来并写盘一次
  （`imported.json` 用 `tmp + rename` 单独写）。旧行带着它记下的 `offset`，少了这一步，
  第一次同步会把旧安装已经折叠过的日志再记一遍。
- 别用文件锁：个人自用，合并写比锁简单，且失败模式温和（最多丢一轮增量，下一轮自然补上）。

## 7. 面板（`client.js`）改动

- `今日用量 / 累计用量 / 累计缓存命中 / 峰值单日 / 连续使用 / 热力图 / 选中明细` 一律改用账本数据（形状不变，只是来源从「现场折叠」换成「账本合并」）。
- 顶部统计条下面加一行说明（新增 i18n 键）：
  `账本自 09-24 起 · 更新于 10-25 22:18 · 本机现存日志 <现存合计>（<N> 个会话）· 已删除 <M> 个会话，其用量仍计入累计`
  ——「现存」是老的现场折叠数，用来解释「账本 > 现存」这种情形（删过会话）。
- 1.6.0 起，说明行的浮层（`title`）改成「说明文案 + 账本文件路径」两行（路径取 `scan.ledgerPath`，为空时只显示文案），
  文案写明卸载插件或重装 DSH 都不会删除账本——这是用户唯一能在面板上核对「该备份哪个文件」的地方；文案仍走 i18n，中英同步。
- 建账中的状态：`首次建账中，当前显示本机现存日志。`（首屏不等建账，2–3 s 后自动换上账本数）。
- 告警（`warnings`）照现有 `note` 行的样式展示，最多 3 条。

## 8. 边界与风险

| 情形 | 行为 | 备注 |
|---|---|---|
| 建账前就删掉的会话 | 记不回来 | 想找回就先从备份恢复日志，**再**首次建账（顺序反了也能补：恢复出来的会话对账本是「新会话」，整份计入） |
| 改时区 | 历史不变 | day key 在记账时就定死；新事件按新时区落桶 |
| 会话被迁移/重写（DSH 格式升级） | 该会话后续增量可能漏记 | 宁少记不倒退；面板 `warnings` 里可见 |
| 日志被外部截断 | 同上 | —— |
| 两个 DSH 实例同时跑 | 合并写，最多丢一轮 | 见 §6 |
| 账本文件损坏 | 启动时读 `.bak`；都坏则重新建账（累计从当下重来） | 建账前先备份账本；旧位置的账本仍在时，删 `imported.json` 可让它重新导入 |
| 卸载插件 / 卸载或重装 DSH | 账本不动，下一次安装接着记 | 账本在每用户数据目录，不在插件目录也不在 DSH home |
| 1.5.0 及更早的旧账本 | 首次加载合并进来，旧文件原样留在原处 | `imported.json` 记 size + mtime，一个版本只导入一次 |
| 换了 `DSH_HOME` / 新开一个 home | 账本不变 | 新 home 只带来新会话：旧行继续计入（标 `gone`），新会话照常加入 |
| 磁盘很小 | 账本 1 MB/2000 会话 | —— |

## 8.5 为什么是一个 JSON 文件，而不是 SQLite / 宿主的 storage

- 规模：0.46 KB/会话，2000 会话 ≈ 1 MB —— 一次 `JSON.parse` 就是全部查询，不需要索引。
- 依赖：插件现在零依赖、零构建步骤；引 SQLite 会破坏这条硬约束（`README` 与 `AI推送须知.md` 都写着）。
- 原子性：`tmp + rename` 加一份 `.bak` 足够应付「写盘一半崩溃」；SQLite 的 WAL 在这里是过度设计。
- 迁移：`version` 字段留着，将来真要换存储，读旧文件、写新存储即可，面板契约不变。

## 9. 落地清单（已完成）

| 文件 | 改动 |
|---|---|
| `lib/ledger.js`（新增，纯逻辑，无 IO 副作用） | `foldEvents` / `addUsage` / `mergeDays` / `applySnapshot` / `mergeLedgerFiles`，全部纯函数，`__internals` 暴露给测试 |
| `lib/ledger.js` 的存储层（计划里单独的 `lib/ledger-store.js`，最终并进同一模块） | 读写 + 原子写 + `.bak` + 合并写；当时的账本路径是 `<DSH_HOME>/usage-ledger/ledger.json`（1.6.0 起改为每用户数据目录，见 §3.1） |
| `index.js` | 注入 `sessionPersistence`（已有）；新 `syncLedger(ctx)` + 单飞；`usageReport()` 改回账本，附 `live` 现场折叠；`apply()` 里加定时器与 dispose 写盘；`usage` 路由保留 15 s TTL |
| `client.js` | §7 的数据源与说明行；i18n（zh/en 同步加键） |
| `package.json` | 版本 1.4.0 → **1.5.0**（新增数据口径 = minor）；`files` 加 `lib/ledger.js`、`tools/seed-ledger.mjs`、`docs/*.md`；`exports` 加 `./ledger`；`scripts.ledger` |
| `test/selfcheck.mjs` | 假 persistence 的账本场景（见 §10），断言「只加不减」 |
| `README.md` / `README.en.md` | 「它显示什么」表格加一行「累计来自本机账本，删会话不会降低」 |

1.6.0（存储位置迁址）的落点：

| 文件 | 改动 |
|---|---|
| `lib/ledger.js` | `resolveDataRoot` / `resolveLedgerPath`（每用户数据目录，忽略 `DSH_HOME`）、`resolveLegacyLedgerPaths`、`resolveImportRecordPath`、`loadLedgerWithInheritance`、`imported.json` 读写；另修 `goneAt` 落盘（标记时同步 `lastSeenAt`） |
| `index.js` | 首次加载走 `loadLedgerWithInheritance`；响应里带 `scan.ledgerPath` |
| `client.js` | 说明行的浮层显示账本路径与「卸载 / 重装不丢」的说明 |
| `tools/seed-ledger.mjs` | 与面板同一个缺省路径；同样继承旧账本；`--dry-run` 时 `write: false` |
| `package.json` | 1.5.0 → **1.6.0** |
| `cordis.patch.yml` | 注释改写：账本在每用户数据目录，`DSH_HOME` 不影响它 |
| `README.md` / `README.en.md` | 存储位置、继承、清零语义 |
| `test/selfcheck.mjs` | 存储位置与继承的断言（§10） |

保持既有硬约束：无构建步骤、Host 半只读本地事实、HTTP 200 + `ok` 判别式、数字不缩写、文案走 i18n。

实际是三块一起落的，因为账本一旦作答，面板必须同时能解释它（否则"累计 > 现存"看起来像 bug）：

1. **Host 半 + 账本**：`lib/ledger.js` 与 `index.js` 里的单飞同步、`syncIntervalMs` 定时器、dispose 落盘。
   响应里同时带 `scan.live`（现存汇总）与 `scan.gone`（已删会话数），面板据此解释差额。
2. **面板**：统计条下加 `账本自 … · 更新于 … · 本机现存日志 …（N 个会话）· 已删除 N 个会话` 一行；
   `test/preview.mjs` 的样张同步带上 `scan`，两种主题都截图确认过排版。
3. **收口**：README 中英双版各加「累计用量与账本」一节、版本 1.5.0、`cordis.patch.yml` 里写明 `syncIntervalMs`。

## 10. 验证

自检（`node test/selfcheck.mjs`）用假的 persistence 覆盖 10 个场景，A2 节集中了账本断言（全套 180+ 条，含 1.6.0 新增的存储位置、旧账本继承与重装存活），断言全部是「数字与不变量」而不是实现细节：

1. 新会话 → 计入一次；再同步一次 → 计入次数不变（幂等）。
2. 未变化 → `read` 调用数为 0。
3. 追加 → 只读尾部，累计等于同一份日志的全量折叠。
4. 删除会话 → 累计**不变**，行标 `goneAt`。
5. 删除后同名 id 重新出现且内容更长 → 只计新增部分（或整份计入，二者都不得少于原值）。
6. 日志变短 → 累计不变 + 有告警。
7. seq 断裂 → 累计不变 + 有告警。
8. 两个账本文件合并 → 无重复计费、无丢失。
9. 同一会话换成另一种 id 拼写出现 → 行改名、用量不变、`adopted` 加一、`gone` 为 0。
10. 两份账本各记一种拼写，合并后只剩一行、用量只算一次（否则磁盘上的旧键会在每次写盘时被补回来）。

1.6.0 追加（同一节）：三个平台的缺省路径、`DSH_USAGE_LEDGER` 覆盖、`DSH_HOME` 不再影响落点、旧账本只导入一次、
清零后旧历史不复活，以及模拟卸载插件 + 重装 DSH 后累计不变。

真机（改完必做）：

1. 首次打开面板 → 先显示现存数，2–3 s 后切成账本数，两者此时应基本相等（差值 = 面板打开到建账之间的增量）。
2. 手动删掉一个会话目录 → 刷新面板：累计**不降**，现存数下降。
3. 隔 10 分钟再开 → 数字只增。
4. 深浅主题各看一眼说明行的排版。

对账工具（调试用，不进 UI）：`__internals.fullFold()` 与账本总数对比；原型脚本 `.local/ledger-scenarios.mjs` 可在任意会话根目录上复现上述全部场景。

## 11. 实测数据（本机 149 会话 / 72.6 MB / 68,481 事件）

| 动作 | 耗时 |
|---|---|
| `list()`（目录 + header 校验 + stat） | 56 ms |
| 首次建账（全量折叠 149 会话） | 2 100–2 700 ms（一次性） |
| 空闲 tick（全部命中 revision） | 原型 24–26 ms；真机第二轮起 2 ms，0 次日志读取 |
| 单会话增长后的 tick（2.0 MB 日志尾部） | 99–101 ms |
| 面板合并视图（149 会话） | 0.08 ms |
| 账本文件 | 原型 69–79 KB（149 会话）；真机 318 行（含 169 行已删）192 KB |
| 真机一次「全量重读」（Host 重启、revision 世代变化后） | 2.6–3.0 s；之后回到 4–107 ms |

## 12. 与「不恢复会话」的关系

本方案完全不碰会话文件：不复制、不留副本、不重建索引，只在每用户数据目录的 `dsh-usage/` 下维护自己的账本（§3.1）。
会话日志是**输入**，账本是**输出**；日志删了，输出仍在。

## 13. 附录：参考实现（可直接搬进 `lib/ledger.js`）

```js
/** 一次 read 取多少条事件，与现有 READ_PAGE 一致。 */
const PAGE = 512

/**
 * 账本里 `days` 是普通对象（写盘友好）；bucket 形状与现有 `emptyBucket()` 完全一致（含 `total`）。
 * 注意：index.js 现有的 `mergeDays()` 吃的是 `Map`，账本不能直接复用它。
 */
function mergeInto(into, from) {
  for (const [date, bucket] of Object.entries(from)) {
    const target = into[date] ?? (into[date] = emptyBucket(date))
    target.input += bucket.input
    target.output += bucket.output
    target.cacheRead += bucket.cacheRead
    target.cacheWrite += bucket.cacheWrite
    target.total += bucket.total
    target.requests += bucket.requests
    for (const [provider, child] of Object.entries(bucket.providers ?? {})) {
      const existing = target.providers[provider] ?? emptyBucket(date)
      existing.input += child.input
      existing.output += child.output
      existing.cacheRead += child.cacheRead
      existing.cacheWrite += child.cacheWrite
      existing.total += child.total
      existing.requests += child.requests
      target.providers[provider] = existing
    }
  }
}

/**
 * 把一段事件的用量折进「按天贡献」里，就地修改 `days`。
 * `days` 是 { 'YYYY-MM-DD': {input, output, cacheRead, cacheWrite, requests, providers} }。
 */
function foldInto(days, events) {
  for (const event of events) {
    if (event?.type !== 'assistant/message') continue
    const usage = event?.data?.usage
    if (usage === undefined || usage === null) continue
    const date = localDateKey(event.time)
    const bucket = days[date] ?? (days[date] = emptyBucket(date))
    addUsage(bucket, usage, String(event?.data?.message?.source?.provider ?? ''))
  }
}

/**
 * 一轮同步：先看快照决定要不要读，只读新增事件，只加不减。
 *
 * 关键：这一轮读到的用量先折叠进 `delta`，整条会话读通了才并进 `row.days`。
 * 中途出现「seq 不连续」时直接丢弃 delta —— 否则半条日志已经并进去了、
 * offset 却没推进，下一轮会把它重复计一次。
 *
 * @returns {{read:number, skipped:number, gone:number, warnings:string[]}}
 */
export async function syncLedger(persistence, ledger) {
  const warnings = []
  const snapshots = await persistence.list()
  const live = new Set()
  let read = 0
  let skipped = 0
  for (const snapshot of snapshots) {
    const id = String(snapshot?.header?.id ?? '')
    if (id === '') continue
    live.add(id)
    const prev = ledger.sessions[id]
    const sizeBytes = typeof snapshot?.sizeBytes === 'number' ? snapshot.sizeBytes : undefined
    // 1) 没动过：一次日志都不打开
    if (prev !== undefined && prev.goneAt === null && prev.revision === snapshot.revision) { skipped += 1; continue }
    // 2) 变短：只告警，绝不回退
    if (prev !== undefined && sizeBytes !== undefined && typeof prev.sizeBytes === 'number' && sizeBytes < prev.sizeBytes) {
      warnings.push(`${id}: 日志变短（${sizeBytes} < ${prev.sizeBytes}），保留已记用量`)
      continue
    }
    read += 1
    const delta = {}
    let offset = prev?.offset ?? 0
    let lastSeq = prev?.lastSeq ?? -1
    let ok = true
    const handle = await persistence.open(id, 'read')
    try {
      for (;;) {
        const page = await handle.read(offset, PAGE)
        const events = Array.isArray(page?.events) ? page.events : []
        if (events.length === 0) break
        // 3) 连续性校验：第一条新事件的 seq 必须接着上次
        const firstSeq = events.find((event) => typeof event?.seq === 'number')?.seq
        if (lastSeq >= 0 && typeof firstSeq === 'number' && firstSeq !== lastSeq + 1) {
          warnings.push(`${id}: seq 不连续（期望 ${lastSeq + 1}，读到 ${firstSeq}），本轮跳过`)
          ok = false
          break
        }
        foldInto(delta, events)
        offset += events.length
        for (const event of events) if (typeof event?.seq === 'number') lastSeq = event.seq
        if (events.length < PAGE) break
      }
    } catch (error) {
      warnings.push(`${id}: ${String(error?.message ?? error)}`)
      ok = false
    } finally {
      await handle.close()
    }
    if (!ok) continue                       // 行保持原样，下一轮再试
    const days = prev?.days ?? {}
    mergeInto(days, delta)                  // 整条读通了才并入
    ledger.sessions[id] = {
      project: String(snapshot?.header?.cwd ?? prev?.project ?? ''),
      offset,
      lastSeq,
      revision: snapshot.revision,
      sizeBytes,
      firstSeenAt: prev?.firstSeenAt ?? Date.now(),
      lastSeenAt: Date.now(),
      goneAt: null,
      days,
    }
  }
  // 4) 磁盘上没了：只打标记，贡献继续留在累计里
  let gone = 0
  for (const [id, row] of Object.entries(ledger.sessions)) {
    if (!live.has(id) && row.goneAt === null) { row.goneAt = Date.now(); gone += 1 }
  }
  ledger.updatedAt = Date.now()
  if (!ledger.createdAt) ledger.createdAt = ledger.updatedAt
  return { read, skipped, gone, warnings }
}

/** 面板要的形状：把每条会话（含已消失的）的天合并成 {today, totals, days}。 */
export function ledgerView(ledger, now = Date.now()) {
  const days = {}
  for (const row of Object.values(ledger.sessions)) mergeInto(days, row.days)
  const totals = emptyBucket('total')
  for (const date of Object.keys(days).sort()) mergeInto({ [date]: totals }, { [date]: days[date] })
  const today = days[localDateKey(now)] ?? emptyBucket(localDateKey(now))
  return { days, totals, today, sessions: Object.keys(ledger.sessions).length }
}
```

上面这段代码就是对着一份真实 `~/.dsh/sessions` 拷贝跑过的版本（六个场景：建账 / 空闲 / 追加 / 删除 / 重写 / 损坏，
断言「累计只增不减」与「增量 == 全量折叠」）。脚本在 `.local/ledger-ref.mjs` 与 `.local/ledger-ref-scenarios.mjs`，不进仓库：
`node .local/ledger-ref-scenarios.mjs` 即可复现 §11 的数字。
