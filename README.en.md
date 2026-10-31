# Usage · dsh-usage

[中文](README.md) | [English](README.en.md)

> A **Usage** page inside the DeepSeek Harness (DSH) settings panel: token usage and
> cache hits for today and all time, a six-month heatmap, and the quotas and reset
> times of the APIs wired into this Harness. The cumulative ledger lives in the
> per-user data directory, so removing the plugin or reinstalling DSH does not lose it.

![Usage panel](docs/panel-light.png)

The plugin registers one `settings.section` named 用量 (Usage), placed directly below
**Agent 预设** (Agent presets), with its own hand-drawn bar-chart glyph.

## What's new (1.6.0)

- The ledger now lives in the **per-user data directory** (Windows `%LOCALAPPDATA%\dsh-usage\`,
  macOS `~/Library/Application Support/dsh-usage/`, Linux `$XDG_DATA_HOME/dsh-usage/`): removing the plugin,
  uninstalling or reinstalling DSH no longer deletes it, and the next install inherits it.
- On first load a 1.5.0 ledger from `$DSH_HOME/usage-ledger/` is merged in; the old files are left untouched.
- Also fixes the deleted-session marker not reaching the ledger file, which under-counted the deleted-session figure.

## Install the DSH desktop first

The plugin lives inside Harness, so the desktop app comes first. The official download page is
[deepseek.com/download](https://www.deepseek.com/download/); its **DeepSeek Harness desktop** section offers:

| Platform | Installer | Requirement |
|---|---|---|
| macOS | [dsh-latest-macos-arm64.dmg](https://download.deepseek.com/desktop/dsh-latest-macos-arm64.dmg) | Apple silicon, macOS 13 or later (Intel chips are not supported) |
| Windows | [dsh-latest-windows-x64.exe](https://download.deepseek.com/desktop/dsh-latest-windows-x64.exe) | 64-bit Windows |

The product page is [deepseek.com/harness](https://www.deepseek.com/harness/); the source, docs and quick start live at
[GitHub · deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) and
[guide/quickstart](https://deepseek-harness.github.io/deepseek-harness/en/guide/quickstart).
It runs in the background and reads local files — the usage figures this panel folds come out of the session logs it keeps on this machine.

## Install

This is a standard DSH bundle (`package.json` declares `dsh.bundle.patch` and `dsh.client`),
and the desktop app can install it straight from GitHub — no manual plugin download needed:

1. Open the **DSH desktop** → **Plugins** in the sidebar → **Add plugin** → **Install a third-party plugin**;
2. Enter this repository's URL in "Package name or address": `https://github.com/linanbuan/dsh-usage`
   (the field also accepts npm package names and absolute local directory paths);
3. Click **Install** and **restart DSH** when prompted so the host half loads.

You can also fetch the repo first and enter the **absolute path** of the unzipped directory instead:

```bash
git clone https://github.com/linanbuan/dsh-usage.git
# or on GitHub: Code → Download ZIP, then unzip
```

Installing through an agent session, or through a terminal that has the `dsh` command, is equivalent:

```text
plugin_manager   action: install_bundle   target: <absolute path to this directory>
```

```bash
dsh plugin --profile <your profile> add <absolute path to this directory>
```

That runs the pnpm install and writes `@local/dsh-usage` into the profile's `dsh.profile.bundles`.
When upgrading from 1.5.0, uninstall the old version before installing this one (third-party plugins are
not updated in place); the old ledger is inherited automatically on the first start.

The **host half needs a Harness restart** to activate (host modules go through Node's
ESM cache and do not participate in HMR); the browser half updates immediately through
HMR. To switch it off, override the row in the profile's own `cordis.patch.yml`:

```yaml
- id: usage-panel
  disabled: true
```

## What it shows

| Section | Content |
|---|---|
| Overview strip | Today's usage, today's cache hits, all-time usage and cache hits (with the cache share of the prompt), the busiest day, and the current and longest run of days — plus a line naming when the ledger started, when it last synced, and what the logs still on disk add up to |
| Where "all time" comes from | The cumulative figures come from a local ledger (next section) held in a per-user data directory that survives plugin removal and a DSH reinstall: a deleted session is no longer read, but the usage it already contributed never drops back out |
| History heatmap | Six months, one cell per day — or per week after switching to **Weekly**. Deeper colour means more usage; hover a cell (or focus it from the keyboard) to float that day's or week's usage and cache hits; click one for the full detail below, and step the window with the arrows |
| API quotas | `kimi-coding` (5-hour window, monthly total), `commandcode` (5-hour, weekly, monthly) and `opencode-go` (rolling 5-hour, weekly, monthly) used share and reset times |

Token counts are always shown as **complete integers** — never abbreviated to `K` / `M` / `B`.

`commandcode` is reported as a **percentage**, never as an amount: each of its models has its own dollar cap, so the same "US$48 left" buys a different amount of work per model and the figure is not comparable. The share of a window already spent is, so that is all the panel reports. The billing-period allowance is derived on the spot from **spent + remaining** (true for any plan), falling back to the published price table only when the API withholds the remaining figure; `kimi-coding` returns ratios itself and is unchanged.

`opencode-go` reads `https://opencode.ai/zen/go/v1/usage`, which answers with each window's `percent` and `resetsAt` directly, so those are shown as they come. Its three windows are three separate caps (by the plan's own accounting: 5-hour = 20% of the monthly limit, weekly = 50%, monthly = 100%), so they stay three rows even on a quiet account where all three read 0% — equal percentages here are not a restatement of one limit. The credential reference is `OPENCODEGO_API_KEY`; the endpoint reports no plan (Go / Go Plus), so the card shows no plan row.

![API quotas](docs/panel-quota.png)

## Cumulative usage and the ledger

The all-time figures are not "add up whatever logs exist right now" — they are kept in a
local ledger. It lives in the **per-user operating-system data directory**, deliberately not in
the plugin directory and not in the DSH home: both can be removed or replaced when something is
uninstalled, while the usage history is meant to outlive them:

```text
Windows   %LOCALAPPDATA%\dsh-usage\ledger.json      # falls back to %APPDATA%, then %USERPROFILE%\AppData\Local
macOS     ~/Library/Application Support/dsh-usage/ledger.json
Linux     $XDG_DATA_HOME/dsh-usage/ledger.json      # ~/.local/share/dsh-usage/ledger.json by default
```

Two other files sit beside it:

```text
ledger.json.bak   the previous successful write
imported.json     a record of which old ledgers were merged (each file's size + mtime)
```

`DSH_USAGE_LEDGER` still overrides the location, as a **complete file path**; `DSH_HOME` no
longer moves the ledger, and neither does a profile setting.

**Uninstalling does not take the ledger with it.** Removing the bundle, or uninstalling or
reinstalling DSH, never automatically removes this directory, so the next install reads the
same file and carries on: a DSH reinstall opens a new home with new sessions, the old rows stay
credited (marked gone) and new sessions are added, so the totals never go backwards.

An upgrade from 1.5.0 or earlier **merges** the ledger left at the old location into this one,
without moving or deleting the original: `$DSH_HOME/usage-ledger/ledger.json` and
`~/.dsh/usage-ledger/ledger.json` (the same file when `DSH_HOME` is unset; both homes are
checked when it points elsewhere). The merge keeps, per session, the row that consumed more
events and the earliest start; `imported.json` records each old file's size and modification
time, so one version is imported once — if an older Harness advances that file again, the next
load merges it again.

One row per session, holding the day buckets it has contributed and how far into its log
that contribution has been read. Therefore:

- **deleting a session never lowers the total.** The sync that notices the missing log only
  stamps `goneAt` on its row; the usage that row already holds stays in the totals;
- **growth costs a tail read.** A session whose `revision` did not move is not opened at
  all; one that moved is read from its recorded offset;
- **an anomaly only warns.** A shorter log, a reordered one, or an unreadable one is skipped
  with a warning in the panel's footer — the credit already given never goes back;
- **it syncs every 10 minutes** (configurable through `syncIntervalMs`, floor 60 seconds),
  and the panel's Refresh advances it immediately;
- writes are temp-file-plus-rename with a `.bak` copy, and two windows sharing one home are
  merged per session by "whichever row read further", so neither can rewind the other into
  double counting;
- **a session that changes id spelling is still one row.** Early Harness ids were bare UUIDs
  and later ones carry a `session-` prefix, so one machine can hold both: rows are keyed by the
  directory name verbatim, a session that reappears under the other spelling has its row
  *renamed* (credit kept), and a save merges the two spellings back into a single row.

The `on disk now` line under the strip is the same merge restricted to sessions whose logs
are still there. The difference between the two numbers is exactly the sessions that were
deleted but are still remembered. Hovering that line shows the ledger file's full path and
says that removing the plugin or reinstalling DSH will not lose it.

Deleting `ledger.json` and `ledger.json.bak` resets the ledger (the total then restarts
from what is on disk). `imported.json` keeps the old ledgers out, so the pre-upgrade history
does not grow back when the new files are deleted; delete it too only if you deliberately
want the old ledgers imported again.

### Seeding or backfilling without Harness running

`tools/seed-ledger.mjs` uses the same fold as the panel to advance the ledger from a
directory of session logs:

```bash
node tools/seed-ledger.mjs                      # build / advance from this machine's logs
node tools/seed-ledger.mjs --backfill --from <a backed-up sessions directory>
```

It uses the same default path as the panel and inherits the old ledgers too.

`--backfill` is **add-only**: sessions present in the backup but absent from the ledger are
credited as already-gone rows (no session file is copied or restored), while ids the ledger
already knows are left exactly as they are, so running it twice is a no-op. `--dry-run`
prints the outcome without writing.

The data model, the sync loop, the exact edges of "credit only grows", and why this is not
SQLite are written up in [docs/token-ledger.md](docs/token-ledger.md); the traps this change ran
into (deleted sessions, a changed id spelling, the profile's `link:` dependency) are in
[docs/project-log/log.md](docs/project-log/log.md).

## Speed

The panel never waits. The two halves differ in cost by three orders of magnitude, so
they are requested separately:

| Half | Measured |
|---|---|
| Local data (the ledger; logs only when one grew) | 2.7 s to build, then 1-50 ms |
| Provider quota (one overseas round trip) | usually 0.2-2 s, up to 10 s when the path jitters |

Therefore:

- the strip and the heatmap paint as soon as the local data arrives, and the quota
  section fills in behind them;
- all five provider requests go out **concurrently** (it used to be two serialized
  groups — kimi, then command code — which paid the round trip twice; `opencode-go`
  joined later and is concurrent as well);
- a quota answer is served as-is while it is under 90 seconds old, and once stale it is
  returned immediately while a background refresh runs (`refreshing` tells the page to
  come back for the fresh answer);
- activation warms both caches 2.5 seconds after boot and revalidates every 5 minutes,
  so **opening Settings is usually a cache hit**;
- all-time usage is read from the local ledger, which **opens no log at all while idle**
  (149 sessions: 2 ms of syncing, 49 ms for the whole request) and reads only the new tail
  when one grows.

Network jitter never becomes a red card: each read gets its own **20-second** deadline and
one **retry** when it times out or the socket drops (both requests are idempotent GETs),
and when two rounds in a row fail, **the last good numbers stay** and are labelled with the
time they came from plus why this round failed, instead of blanking the card. That is not
theory — this machine's path to `api.commandcode.ai` is normally 230-900 ms, yet produced a
10.5 s connect timeout and a 9.4 s response in a single afternoon, and the old 8-second
deadline is exactly what turned the card into "the provider did not answer in time".

![Dark theme](docs/panel-dark.png)

## Accounting

- Total usage = input + cache read + cache write + output, matching
  `@deepseek-ai/dsh-token-meter`: a billed record's `inputTokens` is its **uncached**
  prompt, so cache hits are never double counted.
- Cache hits are that accounting's cache-read share.
- Days are bucketed by **local timezone** calendar day; **weekly** folds them into ISO weeks (Monday to Sunday).
- Data comes from the Host's `sessionPersistence` service — the compressed on-disk
  session format is never re-implemented here — and is folded into the local ledger that
  the panel then reads.

## Layout

```
package.json       bundle manifest (dsh.bundle.patch + dsh.client)
cordis.patch.yml   one insert row: mounts the host half
index.js           host half: /api/usage/usage, /api/usage/quota, /api/usage/report
client.js          browser half: the settings.section page (build-free lazy CJS bundle)
lib/ledger.js      the incremental ledger: fold, sync, merge, atomic read/write, path
                   resolution and inheritance of the old ledgers
tools/seed-ledger.mjs  build the ledger, or backfill it from a backup, without Harness
                   (same default path)
icon.svg           bundle icon
locale/*.json      plugin-manager title and description
docs/              panel shots produced by test/preview.mjs, the ledger design note,
                   and the project log
  token-ledger.md  the ledger's data model, sync algorithm and edge cases
  project-log/     the project log (append-only)
test/selfcheck.mjs activation self-check
test/preview.mjs   static preview: renders the real component tree to HTML
```

## Privacy

- Provider API keys are resolved from the Harness credential store and **stay on the
  host**; the browser only ever receives upstream response bodies.
- Quotas come from each provider's own public API; no third-party CLI's private files
  and no browser cookies are read.
- This repository contains no keys, account identifiers, or machine-specific paths.

## Self-check

```bash
node test/selfcheck.mjs      # or pnpm test
```

It loads both halves the way the plugin systems do, activates them against stub
contexts, and exercises all three routes offline: export forms, route shape and path
uniqueness, the no-credential degraded response, the token accounting, the provider
parsers, that one timeout really does cost exactly one retry, that two failed rounds keep
the previous good numbers and their failure reason, that a configuration change (a removed
key) is never papered over with old numbers, that the five requests really do overlap, that
the local half touches no network, and the section's id / order / label / component type.
A separate ledger section asserts the whole "credit only grows" contract: bootstrap equals a
full fold, an unchanged session is never opened, growth is credited exactly once, a deletion
never lowers the total, a restored session resumes from its offset, a shorter or reordered log
only warns, two ledgers merge towards the row that read further, a corrupt file falls back to
`.bak`, and the strip's ledger caption renders.
1.6.0 adds the storage and inheritance assertions on top: the default path on all three
platforms, the `DSH_USAGE_LEDGER` override, `DSH_HOME` no longer moving the ledger, an old
ledger being imported only once, a reset not resurrecting old history, and the totals surviving
a simulated plugin removal plus DSH reinstall.
The browser half additionally asserts the heatmap's window, week columns, ISO weeks, shades,
weekly aggregation and day runs, plus the rendered grid's cell count, `aria-label`s, legend
and toggles. Exit code 0 means all checks passed.

To look at the panel without starting Harness:

```bash
node test/preview.mjs        # writes .local/preview/{light,dark}.html
```

It renders the same CSS and the same real component tree into a static page; only the theme
variables are supplied by the page. The shots in `docs/` come from it (the hover tooltip in
them is a sample laid out with the same classes).

## Credits

The technique of drawing one's own glyph in the settings rail and retiring the shell's
fallback icon follows the same approach as the MIT-licensed
[`commandcode-dash`](https://github.com/Momonaka/commandcode-dash).

## License

[MIT](LICENSE) © linanbuan
