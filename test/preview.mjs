// Render the plugin's real component trees to a static page so the panel's layout
// and heat scale can be inspected without the host. Structure, class names and CSS
// all come from client.js; only the host's design tokens are supplied here.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

let loaded
globalThis.window = { __ModuleLoader__: { load(definition) { loaded = definition } } }
new Function(`${source}\nreturn window.__ModuleLoader__.__last;`)()
const react = {
  createElement(tag, props, ...children) {
    return { $$typeof: 'element', tag, props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children } }
  },
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useRef: (initial) => ({ current: initial }),
  useCallback: (fn) => fn,
  Fragment: 'Fragment',
}
const clientModule = loaded.factory((name) => {
  if (name === 'react') return react
  throw new Error(`unexpected require: ${name}`)
})
const { Activity, SelectionDetail, StatStrip, dateKey, addDays } = clientModule.__internals

const cssStart = source.indexOf('const CSS = `') + 'const CSS = `'.length
const cssEnd = source.indexOf('`\n', cssStart)
const CSS = source.slice(cssStart, cssEnd)

// ── sample data: 12 months of plausible volume, ending today ────────────────
const today = new Date()
const days = []
let seed = 20261023
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
for (let back = 400; back >= 0; back -= 1) {
  const date = dateKey(addDays(today, -back))
  const weekday = addDays(today, -back).getDay()
  const quiet = weekday === 0 || weekday === 6 ? 0.35 : 1
  const burst = back === 0 || back === 1 || back === 9 ? 2.6 : 1
  if (rand() < 0.16) continue
  const total = Math.round((0.4 + rand() * 4.2) * quiet * burst * 1_000_000)
  const cacheRead = Math.round(total * (0.55 + rand() * 0.4))
  const output = Math.round((total - cacheRead) * 0.42)
  const input = Math.round((total - cacheRead) * 0.34)
  const cacheWrite = total - cacheRead - output - input
  days.push({
    date,
    input,
    output,
    cacheRead,
    cacheWrite,
    total,
    requests: Math.round(total / 40_000),
    providers: {
      'kimi-coding': { input, output, cacheRead, cacheWrite, total, requests: Math.round(total / 90_000) },
    },
  })
}
const todayBucket = days.find((bucket) => bucket.date === dateKey(today)) ?? days[days.length - 1]
const totals = days.reduce(
  (sum, bucket) => ({
    input: sum.input + bucket.input,
    output: sum.output + bucket.output,
    cacheRead: sum.cacheRead + bucket.cacheRead,
    cacheWrite: sum.cacheWrite + bucket.cacheWrite,
    total: sum.total + bucket.total,
    requests: sum.requests + bucket.requests,
  }),
  { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, requests: 0 },
)

// ── serialise the real element trees ─────────────────────────────────────────
const styleOf = (style) =>
  style === undefined
    ? ''
    : Object.entries(style)
        .map(([key, value]) => {
          const name = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
          return `${name}:${String(value)}`
        })
        .join(';')

const VOID_TAGS = new Set(['br', 'img', 'input', 'hr', 'meta', 'link'])
const toHtml = (node) => {
  if (node === null || node === undefined || node === false) return ''
  if (Array.isArray(node)) return node.map(toHtml).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (node.$$typeof !== 'element') return ''
  const { tag, props } = node
  // Component elements (Stat, Line, …) only exist as functions here; expand them so
  // the preview shows what the host would paint.
  if (typeof tag === 'function') return toHtml(tag(props ?? {}))
  const attributes = []
  for (const [key, value] of Object.entries(props ?? {})) {
    if (key === 'children' || value === undefined || value === null || value === false) continue
    if (key === 'style') {
      attributes.push(` style="${styleOf(value)}"`)
      continue
    }
    if (key === 'className') {
      attributes.push(` class="${String(value)}"`)
      continue
    }
    if (key.startsWith('on')) {
      attributes.push(` data-has-${key.toLowerCase()}="1"`)
      continue
    }
    attributes.push(` ${key}="${String(value).replace(/"/g, '&quot;')}"`)
  }
  if (VOID_TAGS.has(tag)) return `<${tag}${attributes.join('')}>`
  return `<${tag}${attributes.join('')}>${toHtml(props?.children)}</${tag}>`
}

const strip = toHtml(StatStrip({ today: todayBucket, totals, days, available: true }))
const daily = toHtml(Activity({ days, grain: 'day', onGrain: () => {}, selected: { grain: 'day', key: todayBucket.date }, onSelect: () => {} }))
const weekly = toHtml(Activity({ days, grain: 'week', onGrain: () => {}, selected: { grain: 'week', key: '2026-10-19' }, onSelect: () => {} }))
const detail = toHtml(SelectionDetail({ grain: 'day', point: todayBucket.date, bucket: todayBucket }))

const quota = `
<div class="dsu-section" id="quota">
  <div class="dsu-colHead">
    <div class="dsu-colTitle">
      <h3 class="dsu-cardTitle">API 额度</h3>
      <span class="dsu-hint">额度与刷新时间来自各提供方的官方接口。</span>
    </div>
    <span class="dsu-pill dsu-pillOk">正常</span>
  </div>
  <div class="dsu-providerGrid">
    <div class="dsu-card">
      <div class="dsu-colHead">
        <div class="dsu-colTitle"><h3 class="dsu-cardTitle">kimi-coding</h3><span class="dsu-hint">刚刚读取</span></div>
        <span class="dsu-pill dsu-pillPlan">月度套餐</span>
      </div>
      <div class="dsu-window">
        <div class="dsu-windowTop"><span class="dsu-windowName">5 小时</span><span class="dsu-windowValue">44%</span></div>
        <div class="dsu-bar"><span class="dsu-barFill" style="width:44%"></span></div>
        <div class="dsu-windowFoot"><span>已用 0.44 / 上限 1.00</span><span>2 小时后刷新</span></div>
      </div>
      <div class="dsu-window">
        <div class="dsu-windowTop"><span class="dsu-windowName">月度</span><span class="dsu-windowValue">63.5%</span></div>
        <div class="dsu-bar"><span class="dsu-barFill" style="width:63.5%"></span></div>
        <div class="dsu-windowFoot"><span>已用 31.75 / 上限 50.00</span><span>12 天后刷新</span></div>
      </div>
    </div>
    <div class="dsu-card">
      <div class="dsu-colHead">
        <div class="dsu-colTitle"><h3 class="dsu-cardTitle">opencode-go</h3><span class="dsu-hint">上次成功的数据</span></div>
        <span class="dsu-pill dsu-pillMuted">未配置密钥</span>
      </div>
      <div class="dsu-window">
        <div class="dsu-windowTop"><span class="dsu-windowName">滚动窗口</span><span class="dsu-windowValue">5%</span></div>
        <div class="dsu-bar"><span class="dsu-barFill" style="width:5%"></span></div>
        <div class="dsu-windowFoot"><span>已用 0.05</span><span>提供方未给出刷新时间</span></div>
      </div>
    </div>
  </div>
</div>`

const page = (theme) => `<!doctype html>
<html lang="zh-CN" data-theme="${theme}">
<head>
<meta charset="utf-8">
<title>用量面板预览 · ${theme}</title>
<style>
  :root {
    --dsw-alias-label-primary: #1b1d21;
    --dsw-alias-label-secondary: #5b6169;
    --dsw-alias-border-l1: rgba(0, 0, 0, 0.12);
    --dsw-alias-border-l2: rgba(0, 0, 0, 0.26);
    --dsw-alias-bg-layer-1: rgba(0, 0, 0, 0.045);
    --dsw-alias-bg-layer-2: #ffffff;
    --dsw-alias-brand-primary: #3b6ef5;
    --dsw-alias-state-success-primary: #238a4e;
    --dsw-alias-state-error-primary: #d13c34;
    --dsw-alias-state-warn-primary: #b07808;
    color-scheme: light;
  }
  html[data-theme="dark"] {
    --dsw-alias-label-primary: #e8eaed;
    --dsw-alias-label-secondary: #a0a6ad;
    --dsw-alias-border-l1: rgba(255, 255, 255, 0.14);
    --dsw-alias-border-l2: rgba(255, 255, 255, 0.3);
    --dsw-alias-bg-layer-1: rgba(255, 255, 255, 0.06);
    --dsw-alias-bg-layer-2: #202226;
    --dsw-alias-brand-primary: #6b93ff;
    color-scheme: dark;
  }
  body { margin: 0; padding: 26px 30px 34px; background: ${theme === 'dark' ? '#17181b' : '#f7f7f8'};
    font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; }
  .panel { width: 880px; margin: 0 auto; }
  .sample-note { font: 12px/18px "Segoe UI", sans-serif; color: #8a8f97; margin: 0 0 14px; }
  .dsu-section { position: relative; }
  .sample-tip { position: relative; height: 0; z-index: 3; }
  .sample-tip .dsu-tip { position: absolute; left: 246px; top: 84px; transform: none; }
${CSS}
</style>
</head>
<body>
<div class="panel">
  <p class="sample-note">静态预览：结构、类名与样式表都取自 client.js，仅由本页提供主题变量。悬停浮层在此处按同一样式手工摆放了一份。</p>
  <div class="dsu-root">
    ${strip}
    <div class="dsu-section" id="day"><h2 class="dsu-h2">每日</h2>
      <div class="sample-tip"><div class="dsu-tip" role="tooltip">
        <div class="dsu-tipTitle">2026年10月23日 周五</div>
        <span class="dsu-tipBadge">今天</span>
        <div class="dsu-tipBody">
          <div class="dsu-tipRow"><span>总用量</span><b>1274035</b></div>
          <div class="dsu-tipRow"><span>缓存命中</span><b class="dsu-ok">759046</b></div>
          <p class="dsu-tipFoot">输入 175096 · 输出 216295 · 缓存写入 123598 · 计费次数 32</p>
        </div>
      </div></div>
      ${daily}
    </div>
    <div class="dsu-section" id="week"><h2 class="dsu-h2">每周</h2>${weekly}</div>
    ${detail}
    ${quota}
  </div>
</div>
</body>
</html>`

mkdirSync(new URL('../.local/preview/', import.meta.url), { recursive: true })
writeFileSync(new URL('../.local/preview/light.html', import.meta.url), page('light'))
writeFileSync(new URL('../.local/preview/dark.html', import.meta.url), page('dark'))
console.log('wrote preview pages; days:', days.length, 'today:', todayBucket.date, 'total:', todayBucket.total)
