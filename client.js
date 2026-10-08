/**
 * 用量 (Usage) — browser half.
 *
 * A hand-authored lazy-CJS bundle in the shape `dsh-client-modules` serves and
 * `window.__ModuleLoader__` materializes: plain `React.createElement` over
 * markup this plugin styles itself, requiring only `react` from the shell's
 * platform module table — no build step, no external module requests, and no
 * guessing at another package's private component API.
 *
 * It registers exactly one `settings.section` — the same additive seat the
 * shipped 账号与余额 / 通用设置 / 模型 / 内置插件 / Agent 预设 pages use — and
 * reads both of its figures from its own two authenticated `/api/usage/*`
 * routes. Nothing privileged happens here: the API keys stay on the host.
 *
 * @module @local/dsh-usage/client
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-usage',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { useCallback, useEffect, useMemo, useRef, useState } = React
    const h = React.createElement

    /** Settings section id. */
    const SECTION_ID = 'usage'

    /** Locale namespace this bundle registers its dictionary under. */
    const LOCALE_NS = 'usage'

    // -----------------------------------------------------------------------
    // Copy
    // -----------------------------------------------------------------------

    const DICT = {
      zh: {
        nav: '用量',
        heading: '用量',
        subtitle: '本机 Harness 的 token 用量与已接入 API 的额度。',
        refresh: '刷新',
        refreshing: '刷新中',
        today: '当日',
        allTime: '累计',
        totalUsage: '总用量',
        cacheHit: '缓存命中',
        input: '输入',
        output: '输出',
        cacheRead: '缓存读取',
        cacheWrite: '缓存写入',
        requests: '计费次数',
        history: '历史用量',
        monthTotal: '本月总用量',
        monthCache: '本月缓存命中',
        noData: '本月没有记录。',
        dayDetail: '选中日期',
        pickDay: '在上方的日历里选择一天，查看当天的精确数字。',
        total: '总用量',
        legendTotal: '总用量',
        legendCache: '缓存命中',
        prevMonth: '上个月',
        nextMonth: '下个月',
        thisMonth: '回到本月',
        providerUsage: '按提供方',
        quota: 'API 额度',
        quotaHint: '额度与刷新时间来自各提供方的官方接口。',
        quotaLoading: '正在向提供方读取额度…',
        quotaRefreshing: '后台更新中',
        statusOk: '正常',
        statusError: '读取失败',
        statusNoKey: '未配置密钥',
        statusStale: '上次成功的数据',
        staleHint: '本次读取失败，以下数字来自',
        used: '已用',
        cap: '上限',
        reset: '刷新时间',
        resetsIn: '后刷新',
        noReset: '提供方未给出刷新时间',
        retry: '重试',
        loadFailed: '读取失败',
        loading: '正在读取…',
        unavailable: '本组合未挂载会话持久化，无法统计用量。',
        generatedAt: '统计时间',
        timeZone: '时区',
        sessions: '会话',
        note: '总用量 = 输入 + 缓存读取 + 缓存写入 + 输出；缓存命中为其中的缓存读取部分。',
        creditUnit: '额度',
        weekdays: '一二三四五六日',
        todayBadge: '今天',
      },
      en: {
        nav: 'Usage',
        heading: 'Usage',
        subtitle: 'Token usage on this machine and the quotas of the APIs wired into it.',
        refresh: 'Refresh',
        refreshing: 'Refreshing',
        today: 'Today',
        allTime: 'All time',
        totalUsage: 'Total',
        cacheHit: 'Cache hits',
        input: 'Input',
        output: 'Output',
        cacheRead: 'Cache read',
        cacheWrite: 'Cache write',
        requests: 'Billed calls',
        history: 'History',
        monthTotal: 'Month total',
        monthCache: 'Month cache hits',
        noData: 'No records this month.',
        dayDetail: 'Selected day',
        pickDay: 'Pick a day in the calendar above to see its exact figures.',
        total: 'Total',
        legendTotal: 'Total',
        legendCache: 'Cache hits',
        prevMonth: 'Previous month',
        nextMonth: 'Next month',
        thisMonth: 'Back to this month',
        providerUsage: 'By provider',
        quota: 'API quotas',
        quotaHint: 'Quotas and reset times come from each provider\u2019s own API.',
        quotaLoading: 'Reading quotas from the providers…',
        quotaRefreshing: 'refreshing',
        statusOk: 'OK',
        statusError: 'Failed',
        statusNoKey: 'No key',
        statusStale: 'Last good read',
        staleHint: 'This read failed; the figures below are from',
        used: 'Used',
        cap: 'Cap',
        reset: 'Resets',
        resetsIn: 'from now',
        noReset: 'The provider reported no reset time',
        retry: 'Retry',
        loadFailed: 'Could not load',
        loading: 'Loading…',
        unavailable: 'This composition mounts no session persistence, so usage cannot be counted.',
        generatedAt: 'Read at',
        timeZone: 'Time zone',
        sessions: 'Sessions',
        note: 'Total = input + cache read + cache write + output; cache hits are the cache-read share of it.',
        creditUnit: 'credits',
        weekdays: 'MTWTFSS',
        todayBadge: 'today',
      },
    }

    /**
     * The locale service's translate function for this namespace, bound in
     * `apply`. It reads the active locale at call time, so a language switch
     * needs no re-registration.
     *
     * @type {((key: string) => string) | undefined}
     */
    let translate

    /** @returns {'zh'|'en'} from the document language the locale service maintains. */
    function langOf() {
      const raw = (typeof document === 'undefined' ? '' : document.documentElement.getAttribute('lang')) || 'zh'
      return String(raw).toLowerCase().startsWith('zh') ? 'zh' : 'en'
    }

    /**
     * @param {string} key
     * @returns {string}
     */
    function tr(key) {
      if (translate !== undefined) {
        try {
          const value = translate(key)
          if (typeof value === 'string' && value !== '' && value !== key) return value
        } catch {
          /* fall through to the bundled dictionary */
        }
      }
      const dict = DICT[langOf()] ?? DICT.zh
      return dict[key] ?? key
    }

    /** Re-render on a locale switch (locale service when present, `lang` as the fallback). */
    function useLocaleVersion() {
      const [version, setVersion] = useState(0)
      useEffect(() => {
        const locale = localeRef.current
        if (locale !== undefined && typeof locale.subscribe === 'function') {
          return locale.subscribe(() => setVersion((value) => value + 1))
        }
        if (typeof MutationObserver === 'undefined') return undefined
        const observer = new MutationObserver(() => setVersion((value) => value + 1))
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
        return () => observer.disconnect()
      }, [])
      return version
    }

    /** Ticking clock, so reset countdowns stay honest without refetching. */
    function useNow(intervalMs) {
      const [now, setNow] = useState(Date.now())
      useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), intervalMs)
        return () => clearInterval(timer)
      }, [intervalMs])
      return now
    }

    // -----------------------------------------------------------------------
    // Formatting — token counts are shown as plain digits, never abbreviated.
    // -----------------------------------------------------------------------

    /**
     * @param {unknown} value
     * @returns {string} the exact integer, or an em dash when there is none.
     */
    function plain(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return String(Math.round(value))
    }

    /**
     * @param {unknown} value
     * @param {number} digits
     * @returns {string}
     */
    function decimal(value, digits) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return value.toFixed(digits)
    }

    /**
     * @param {unknown} used
     * @param {unknown} cap
     * @returns {number|undefined} 0-100
     */
    function ratio(used, cap) {
      if (typeof used !== 'number' || typeof cap !== 'number' || cap <= 0) return undefined
      return (used / cap) * 100
    }

    /**
     * @param {unknown} value 0-1 ratio.
     * @returns {string}
     */
    function percent(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return `${(value * 100).toFixed(1)}%`
    }

    /** @returns `MM-DD HH:mm` in the operator's own timezone. */
    function stamp(epochMs) {
      if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return '—'
      const at = new Date(epochMs)
      if (Number.isNaN(at.getTime())) return '—'
      const pad = (value) => String(value).padStart(2, '0')
      return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
    }

    /** @returns `HH:mm:ss`. */
    function clock(epochMs) {
      const at = new Date(epochMs)
      const pad = (value) => String(value).padStart(2, '0')
      return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
    }

    /**
     * @param {unknown} epochMs
     * @param {number} now
     * @returns {string} a coarse remaining time, or '' once it has passed.
     */
    function countdown(epochMs, now) {
      if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return ''
      const remaining = epochMs - now
      if (remaining <= 0) return ''
      const minutes = Math.floor(remaining / 60000)
      const days = Math.floor(minutes / 1440)
      const hours = Math.floor((minutes % 1440) / 60)
      const mins = minutes % 60
      if (days > 0) return `${String(days)} 天 ${String(hours)} 小时`
      if (hours > 0) return `${String(hours)} 小时 ${String(mins)} 分`
      return `${String(Math.max(1, mins))} 分`
    }

    // -----------------------------------------------------------------------
    // Data access
    // -----------------------------------------------------------------------

    /**
     * The routes this section reads, and the one-call route each falls back to.
     *
     * The split exists because the two halves cost wildly different amounts: the
     * local fold answers in tens of milliseconds while a provider round trip
     * takes seconds, so issuing them separately lets the cards paint while the
     * quota section is still filling in.
     *
     * The `legacy` entry covers the one window where the two halves disagree:
     * this bundle is served from disk and can be replaced by HMR the moment its
     * file changes, while the host module behind the routes only reloads on a
     * restart. Without the fallback, an updated page talking to a not-yet-restarted
     * host would show an error card until the restart.
     */
    const ROUTES = {
      usage: {
        path: '/api/usage/usage',
        legacy: '/api/usage/report',
        pick: (body) => ({
          ok: body.ok,
          generatedAt: body.generatedAt,
          timeZone: body.timeZone,
          usage: body.usage,
        }),
      },
      quota: {
        path: '/api/usage/quota',
        legacy: '/api/usage/report',
        pick: (body) => ({ ok: body.ok, generatedAt: body.generatedAt, quota: body.quota }),
      },
    }

    /** First settled answer per route, so leaving and re-entering Settings is instant. */
    const responseCache = new Map()

    /**
     * Fetch one plugin route.
     *
     * The host answers every upstream outcome as HTTP 200 with an `ok`
     * discriminator, so a provider failure is never confused with the `/api`
     * channel's own session authentication.
     *
     * @param {{ path: string, legacy?: string, pick?: (body: any) => any }} route
     * @param {boolean} enabled
     * @param {number} pollMs auto-refresh interval; 0 disables it.
     * @returns {[object, (force?: boolean) => void]}
     */
    function useApi(route, enabled, pollMs) {
      const path = route.path
      const [state, setState] = useState(() => {
        const cached = responseCache.get(path)
        if (cached !== undefined) return cached
        return { status: enabled ? 'loading' : 'idle' }
      })
      const sequence = useRef(0)
      const load = useCallback(
        (force) => {
          if (!enabled) {
            setState({ status: 'idle' })
            return
          }
          const mine = (sequence.current += 1)
          setState((previous) =>
            previous.status === 'ready' && force !== true ? previous : { status: 'loading' },
          )
          const headers = { accept: 'application/json' }
          if (force === true) headers['x-usage-force'] = '1'
          /** One request, parsed; a non-2xx answer is returned, not thrown. */
          const request = async (target) => {
            // The local half folds in tens of milliseconds and the remote half
            // answers from cache, so this deadline only has to cover a cold
            // provider round trip — short enough that a stuck request lands on
            // the error card with its Retry instead of an eternal skeleton.
            const response = await fetch(target, {
              credentials: 'include',
              headers,
              signal: AbortSignal.timeout(20_000),
            })
            const text = await response.text()
            let body
            try {
              body = text === '' ? undefined : JSON.parse(text)
            } catch {
              body = undefined
            }
            return { response, body }
          }
          request(path)
            .then(async (first) => {
              let { response, body } = first
              if (response.status === 404 && route.legacy !== undefined) {
                const fallback = await request(route.legacy)
                if (fallback.response.ok && fallback.body !== undefined && route.pick !== undefined) {
                  response = fallback.response
                  body = route.pick(fallback.body)
                }
              }
              if (mine !== sequence.current) return
              if (!response.ok || body === undefined) {
                const failed = {
                  status: 'error',
                  code: `HTTP_${String(response.status)}`,
                  message: (body && body.message) || `HTTP ${String(response.status)}`,
                }
                responseCache.set(path, failed)
                setState(failed)
                return
              }
              const ready = { status: 'ready', body }
              responseCache.set(path, ready)
              setState(ready)
            })
            .catch((error) => {
              if (mine !== sequence.current) return
              const failed = { status: 'error', code: 'NETWORK', message: String(error?.message ?? error) }
              responseCache.set(path, failed)
              setState(failed)
            })
        },
        [enabled, path, route],
      )
      useEffect(() => {
        if (!enabled) return undefined
        if (responseCache.get(path) === undefined) load(false)
        if (pollMs > 0) {
          // A plain GET: the Host revalidates in the background, so polling only
          // needs to pick the fresh answer up.
          const timer = setInterval(() => load(false), pollMs)
          return () => clearInterval(timer)
        }
        return undefined
      }, [enabled, load, path, pollMs])
      return [state, load]
    }

    // -----------------------------------------------------------------------
    // Calendar helpers
    // -----------------------------------------------------------------------

    /** @returns `YYYY-MM-DD` for the current local date. */
    function todayKey() {
      const at = new Date()
      const pad = (value) => String(value).padStart(2, '0')
      return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
    }

    /**
     * The Monday-first grid for one month: leading blanks then day cells.
     *
     * @param {number} year
     * @param {number} month 1-12
     * @returns {{ key: string, day: number }[]}
     */
    function monthGrid(year, month) {
      const first = new Date(year, month - 1, 1)
      const lead = (first.getDay() + 6) % 7
      const length = new Date(year, month, 0).getDate()
      const cells = []
      for (let index = 0; index < lead; index += 1) cells.push({ key: `pad-${String(index)}`, day: 0 })
      for (let day = 1; day <= length; day += 1) {
        const pad = (value) => String(value).padStart(2, '0')
        cells.push({ key: `${String(year)}-${pad(month)}-${pad(day)}`, day })
      }
      while (cells.length % 7 !== 0) cells.push({ key: `tail-${String(cells.length)}`, day: 0 })
      return cells
    }

    // -----------------------------------------------------------------------
    // Shared chrome
    // -----------------------------------------------------------------------

    /**
     * @param {{ label: string, value: string, hint?: string, accent?: boolean }} props
     */
    function Stat(props) {
      return h(
        'div',
        { className: 'dsu-stat' },
        h('span', { className: 'dsu-statLabel' }, props.label),
        h('span', { className: props.accent === true ? 'dsu-statValue dsu-accent' : 'dsu-statValue' }, props.value),
        props.hint === undefined ? null : h('span', { className: 'dsu-statHint' }, props.hint),
      )
    }

    /**
     * @param {{ label: string, value: string }} props
     */
    function Line(props) {
      return h(
        'div',
        { className: 'dsu-line' },
        h('span', { className: 'dsu-lineLabel' }, props.label),
        h('span', { className: 'dsu-lineValue' }, props.value),
      )
    }

    /**
     * @param {{ value: number|undefined, tone?: string, height?: number }} props
     */
    function Bar(props) {
      const width = typeof props.value === 'number' && Number.isFinite(props.value) ? Math.max(0, Math.min(100, props.value)) : 0
      const over = typeof props.value === 'number' && props.value >= 100
      return h(
        'div',
        { className: 'dsu-bar', style: { height: `${String(props.height ?? 6)}px` } },
        h('i', {
          className: over ? 'dsu-barFill dsu-barOver' : 'dsu-barFill',
          style: { width: `${String(width)}%`, background: props.tone },
        }),
      )
    }

    // -----------------------------------------------------------------------
    // Panels
    // -----------------------------------------------------------------------

    /**
     * The 当日 / 累计 pair.
     *
     * @param {{ today: any, totals: any, available: boolean }} props
     */
    function Summary(props) {
      useLocaleVersion()
      const today = props.today ?? {}
      const totals = props.totals ?? {}
      /** @param {any} bucket */
      const breakdown = (bucket) =>
        `${tr('input')} ${plain(bucket.input)} · ${tr('output')} ${plain(bucket.output)} · ${tr('cacheWrite')} ${plain(bucket.cacheWrite)} · ${tr('requests')} ${plain(bucket.requests)}`
      /** @param {any} bucket */
      const cacheHint = (bucket) => {
        const prompt = (bucket.input ?? 0) + (bucket.cacheRead ?? 0) + (bucket.cacheWrite ?? 0)
        const share = prompt > 0 ? (bucket.cacheRead ?? 0) / prompt : undefined
        return share === undefined ? tr('cacheRead') + ' ' + plain(bucket.cacheRead) : `${tr('cacheRead')} ${plain(bucket.cacheRead)} · ${percent(share)}`
      }
      return h(
        'div',
        { className: 'dsu-grid2' },
        h(
          'div',
          { className: 'dsu-card' },
          h('h3', { className: 'dsu-cardTitle' }, tr('today')),
          h(
            'div',
            { className: 'dsu-statRow' },
            h(Stat, { label: tr('totalUsage'), value: plain(today.total), accent: true }),
            h(Stat, { label: tr('cacheHit'), value: plain(today.cacheRead) }),
          ),
          h('p', { className: 'dsu-hint' }, breakdown(today)),
          h('p', { className: 'dsu-hint' }, cacheHint(today)),
        ),
        h(
          'div',
          { className: 'dsu-card' },
          h('h3', { className: 'dsu-cardTitle' }, tr('allTime')),
          h(
            'div',
            { className: 'dsu-statRow' },
            h(Stat, { label: tr('totalUsage'), value: plain(totals.total), accent: true }),
            h(Stat, { label: tr('cacheHit'), value: plain(totals.cacheRead) }),
          ),
          h('p', { className: 'dsu-hint' }, breakdown(totals)),
          h('p', { className: 'dsu-hint' }, cacheHint(totals)),
          props.available
            ? null
            : h('p', { className: 'dsu-hint dsu-warnText' }, tr('unavailable')),
        ),
      )
    }

    /**
     * The month calendar: one cell per day, each drawing two proportional bars
     * (total usage and cache hits) against the month's own maximum, so the
     * shape of the month is readable without printing eight-digit numbers
     * thirty-one times. Exact digits live in the cell's tooltip and in the
     * detail row underneath.
     *
     * @param {{ days: any[], selected: string, onSelect: (key: string) => void }} props
     */
    function Calendar(props) {
      useLocaleVersion()
      const byDate = useMemo(() => {
        const map = new Map()
        for (const bucket of props.days ?? []) map.set(bucket.date, bucket)
        return map
      }, [props.days])
      const [cursor, setCursor] = useState(() => {
        const at = new Date()
        return { year: at.getFullYear(), month: at.getMonth() + 1 }
      })
      const cells = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor])

      const scoped = useMemo(
        () =>
          cells
            .filter((cell) => cell.day !== 0)
            .map((cell) => byDate.get(cell.key))
            .filter((bucket) => bucket !== undefined),
        [byDate, cells],
      )
      const maxTotal = scoped.reduce((max, bucket) => Math.max(max, bucket.total ?? 0), 0)
      const maxCache = scoped.reduce((max, bucket) => Math.max(max, bucket.cacheRead ?? 0), 0)
      const monthTotal = scoped.reduce((sum, bucket) => sum + (bucket.total ?? 0), 0)
      const monthCache = scoped.reduce((sum, bucket) => sum + (bucket.cacheRead ?? 0), 0)
      const now = todayKey()

      const step = (delta) => {
        setCursor((current) => {
          const next = current.month + delta
          if (next < 1) return { year: current.year - 1, month: 12 }
          if (next > 12) return { year: current.year + 1, month: 1 }
          return { year: current.year, month: next }
        })
      }
      const toThisMonth = () => {
        const at = new Date()
        setCursor({ year: at.getFullYear(), month: at.getMonth() + 1 })
      }

      const weekdays = tr('weekdays').split('')

      return h(
        'div',
        { className: 'dsu-card dsu-calCard' },
        h(
          'div',
          { className: 'dsu-colHead' },
          h(
            'div',
            { className: 'dsu-colTitle' },
            h('h3', { className: 'dsu-cardTitle' }, tr('history')),
            h(
              'div',
              { className: 'dsu-monthTotals' },
              h('span', null, `${tr('monthTotal')} `, h('b', { className: 'dsu-accent' }, plain(monthTotal))),
              h('span', { className: 'dsu-dot' }, '·'),
              h('span', null, `${tr('monthCache')} `, h('b', { className: 'dsu-ok' }, plain(monthCache))),
            ),
          ),
          h(
            'div',
            { className: 'dsu-calNav' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsu-iconBtn',
                onClick: () => step(-1),
                'aria-label': tr('prevMonth'),
                title: tr('prevMonth'),
              },
              '‹',
            ),
            h(
              'button',
              { type: 'button', className: 'dsu-monthBtn', onClick: toThisMonth, title: tr('thisMonth') },
              `${String(cursor.year)}-${String(cursor.month).padStart(2, '0')}`,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsu-iconBtn',
                onClick: () => step(1),
                'aria-label': tr('nextMonth'),
                title: tr('nextMonth'),
              },
              '›',
            ),
          ),
        ),
        h(
          'div',
          { className: 'dsu-weekRow' },
          weekdays.map((name, index) => h('span', { key: `w-${String(index)}`, className: 'dsu-weekday' }, name)),
        ),
        h(
          'div',
          { className: 'dsu-calGrid' },
          cells.map((cell) => {
            if (cell.day === 0) return h('span', { key: cell.key, className: 'dsu-day dsu-dayPad' })
            const bucket = byDate.get(cell.key)
            const total = bucket?.total ?? 0
            const cache = bucket?.cacheRead ?? 0
            const isToday = cell.key === now
            const isSelected = cell.key === props.selected
            const className = [
              'dsu-day',
              bucket === undefined ? 'dsu-dayEmpty' : 'dsu-dayFilled',
              isToday ? 'dsu-dayToday' : '',
              isSelected ? 'dsu-daySelected' : '',
            ]
              .filter((part) => part !== '')
              .join(' ')
            return h(
              'button',
              {
                key: cell.key,
                type: 'button',
                className,
                onClick: () => props.onSelect(cell.key),
                title:
                  bucket === undefined
                    ? `${cell.key}`
                    : `${cell.key}\n${tr('totalUsage')} ${plain(total)}\n${tr('cacheHit')} ${plain(cache)}\n${tr('input')} ${plain(bucket.input)}  ${tr('output')} ${plain(bucket.output)}  ${tr('cacheWrite')} ${plain(bucket.cacheWrite)}`,
              },
              h('span', { className: 'dsu-dayNum' }, String(cell.day)),
              h(
                'span',
                { className: 'dsu-dayBars' },
                h('i', {
                  className: 'dsu-dayBar dsu-dayBarTotal',
                  style: { width: `${String(maxTotal > 0 ? (total / maxTotal) * 100 : 0)}%` },
                }),
                h('i', {
                  className: 'dsu-dayBar dsu-dayBarCache',
                  style: { width: `${String(maxCache > 0 ? (cache / maxCache) * 100 : 0)}%` },
                }),
              ),
            )
          }),
        ),
        h(
          'div',
          { className: 'dsu-legend' },
          h('span', { className: 'dsu-legendItem' }, h('i', { className: 'dsu-swatch dsu-swatchTotal' }), tr('legendTotal')),
          h('span', { className: 'dsu-legendItem' }, h('i', { className: 'dsu-swatch dsu-swatchCache' }), tr('legendCache')),
          scoped.length === 0 ? h('span', { className: 'dsu-hint' }, tr('noData')) : null,
        ),
      )
    }

    /**
     * @param {{ bucket: any|undefined, date: string }} props
     */
    function DayDetail(props) {
      useLocaleVersion()
      if (props.bucket === undefined) {
        return h('div', { className: 'dsu-card' }, h('p', { className: 'dsu-hint' }, tr('pickDay')))
      }
      const bucket = props.bucket
      return h(
        'div',
        { className: 'dsu-card' },
        h(
          'div',
          { className: 'dsu-colHead' },
          h('h3', { className: 'dsu-cardTitle' }, `${tr('dayDetail')} ${props.date}`),
          h('span', { className: 'dsu-pill' }, `${tr('requests')} ${plain(bucket.requests)}`),
        ),
        h(
          'div',
          { className: 'dsu-grid2 dsu-gridTight' },
          h(Stat, { label: tr('totalUsage'), value: plain(bucket.total), accent: true }),
          h(Stat, { label: tr('cacheHit'), value: plain(bucket.cacheRead) }),
        ),
        h(
          'div',
          { className: 'dsu-lines' },
          h(Line, { label: tr('input'), value: plain(bucket.input) }),
          h(Line, { label: tr('output'), value: plain(bucket.output) }),
          h(Line, { label: tr('cacheRead'), value: plain(bucket.cacheRead) }),
          h(Line, { label: tr('cacheWrite'), value: plain(bucket.cacheWrite) }),
        ),
        Object.keys(bucket.providers ?? {}).length === 0
          ? null
          : h(
              'div',
              { className: 'dsu-providers' },
              h('span', { className: 'dsu-providerTitle' }, tr('providerUsage')),
              ...Object.entries(bucket.providers).map(([name, child]) =>
                h(
                  'span',
                  { className: 'dsu-providerRow', key: name },
                  h('b', null, name),
                  h('span', { className: 'dsu-hint' }, `${tr('totalUsage')} ${plain(child.total)} · ${tr('cacheHit')} ${plain(child.cacheRead)}`),
                ),
              ),
            ),
      )
    }

    /**
     * One quota window row: label, exact figures, meter and reset time.
     *
     * @param {{ window: any, now: number }} props
     */
    function QuotaWindow(props) {
      useLocaleVersion()
      const entry = props.window
      const isPercent = entry.unit === 'percent'
      const usedText = isPercent ? percent(entry.used) : decimal(entry.used, 2)
      // A ratio window's "cap" is 100% by definition, so printing it beside the
      // used share would only restate the unit.
      const capText = isPercent ? undefined : entry.cap === undefined || entry.cap === null ? undefined : decimal(entry.cap, 2)
      const filled = isPercent ? (entry.used ?? 0) * 100 : ratio(entry.used, entry.cap)
      const remaining = countdown(entry.resetAt, props.now)
      return h(
        'div',
        { className: 'dsu-window' },
        h(
          'div',
          { className: 'dsu-windowTop' },
          h('span', { className: 'dsu-windowName' }, entry.label),
          h(
            'span',
            { className: entry.exceeded === true ? 'dsu-windowValue dsu-errText' : 'dsu-windowValue' },
            capText === undefined ? usedText : `${usedText} / ${capText}`,
          ),
        ),
        h(Bar, { value: filled, tone: entry.exceeded === true ? 'var(--dsw-alias-state-error-primary, #e5534b)' : undefined }),
        h(
          'div',
          { className: 'dsu-windowFoot' },
          h('span', null, entry.note ?? (isPercent ? tr('used') : `${tr('used')} / ${tr('cap')}`)),
          h(
            'span',
            null,
            entry.resetAt === undefined
              ? tr('noReset')
              : `${tr('reset')} ${stamp(entry.resetAt)}${remaining === '' ? '' : ` (${remaining} ${tr('resetsIn')})`}`,
          ),
        ),
      )
    }

    /**
     * Drop a window that restates another one.
     *
     * Kimi's monthly code allowance is a per-model slice of its monthly total,
     * and on a plan that spends them together both report the same ratio —
     * printed twice they read as two different limits, and the total is the one
     * worth keeping.
     *
     * A provider whose windows are genuinely different money (OpenCode Go's
     * 5-hour / weekly / monthly allowances are three separate caps) keeps all
     * of them even at the same percentage: at 0% on a quiet account, the three
     * windows are three separate limits, not one, and each has its own reset.
     *
     * @param {any[]|undefined} windows
     * @param {string|undefined} id the provider id, for the distinct-allowance case.
     * @returns {any[]}
     */
    function dedupeWindows(windows, id) {
      const list = (Array.isArray(windows) ? windows : []).filter(
        (entry) => entry !== null && typeof entry === 'object',
      )
      const totals = list.filter((entry) => entry.id === 'monthTotal')
      const seen = new Set()
      const kept = []
      for (const entry of list) {
        if (entry.id === 'monthCode' && totals.some((total) => total.used === entry.used)) continue
        if (entry.unit === 'percent' && id !== 'opencode-go') {
          const key = `p:${String(entry.used)}`
          if (seen.has(key)) continue
          seen.add(key)
        }
        kept.push(entry)
      }
      return kept
    }

    /**
     * The status pill for one provider card.
     *
     * `ok` is the only state that reads as healthy. A card whose read just failed
     * but whose numbers were kept from the last good round is labelled as such
     * rather than as a failure, because the numbers above it are still true.
     *
     * @param {any} provider
     * @returns {{ className: string, label: string }}
     */
    function providerPill(provider) {
      if (provider.stale === true) return { className: 'dsu-pill dsu-pillMuted', label: tr('statusStale') }
      if (provider.status === 'ok') return { className: 'dsu-pill dsu-pillOk', label: tr('statusOk') }
      if (provider.status === 'no-key') return { className: 'dsu-pill', label: tr('statusNoKey') }
      return { className: 'dsu-pill dsu-pillErr', label: tr('statusError') }
    }

    /**
     * One provider card.
     *
     * @param {{ provider: any, now: number }} props
     */
    function QuotaCard(props) {
      useLocaleVersion()
      const provider = props.provider
      const ok = provider.status === 'ok'
      const stale = provider.stale === true
      const pill = providerPill(provider)
      return h(
        'div',
        { className: ok ? 'dsu-card' : 'dsu-card dsu-cardWarn' },
        h(
          'div',
          { className: 'dsu-colHead' },
          h(
            'div',
            { className: 'dsu-colTitle' },
            h('h3', { className: 'dsu-cardTitle' }, provider.displayName ?? provider.name),
            h('span', { className: 'dsu-hint' }, provider.name),
          ),
          h('span', { className: pill.className }, pill.label),
        ),
        provider.planName === undefined ? null : h('span', { className: 'dsu-pill dsu-pillPlan' }, provider.planName),
        ok && !stale ? null : h('p', { className: 'dsu-hint' }, stale ? `${tr('staleHint')} ${stamp(provider.fetchedAt)}${provider.message === undefined ? '' : ` · ${provider.message}`}` : (provider.message ?? '')),
        (provider.windows ?? []).map((entry) =>
          h(QuotaWindow, { key: String(entry.id), window: entry, now: props.now }),
        ),
        (provider.extras ?? []).length === 0
          ? null
          : h(
              'div',
              { className: 'dsu-lines' },
              ...(provider.extras ?? []).map((extra) =>
                h(Line, {
                  key: String(extra.label),
                  label: extra.label,
                  value:
                    extra.unit === 'money'
                      ? decimal(extra.value, 2)
                      : extra.unit === 'percent'
                        ? percent(extra.value)
                        : plain(extra.value),
                }),
              ),
            ),
      )
    }

    /**
     * The provider quota section.
     *
     * It owns its own request state, because the provider round trip is seconds
     * while everything above it is milliseconds: the numbers render as soon as
     * the local half arrives, and this section fills in behind them.
     *
     * @param {{ state: any, onReload: (force?: boolean) => void, now: number }} props
     */
    function Quota(props) {
      useLocaleVersion()
      const state = props.state
      const quota = state.status === 'ready' ? state.body?.quota : undefined
      const providers = quota?.providers ?? []
      const refreshing = quota?.refreshing === true
      return h(
        'section',
        { className: 'dsu-section' },
        h(
          'div',
          { className: 'dsu-colHead' },
          h(
            'div',
            { className: 'dsu-colTitle' },
            h('h2', { className: 'dsu-h2' }, tr('quota')),
            h('span', { className: 'dsu-hint' }, tr('quotaHint')),
          ),
          refreshing ? h('span', { className: 'dsu-pill dsu-pillMuted' }, tr('quotaRefreshing')) : null,
        ),
        state.status === 'error'
          ? h(
              'div',
              { className: 'dsu-card dsu-cardWarn' },
              h('p', { className: 'dsu-hint' }, `${tr('loadFailed')} ${state.code ?? ''} ${state.message ?? ''}`.trim()),
              h(
                'div',
                { className: 'dsu-actions' },
                h(
                  'button',
                  { type: 'button', className: 'dsu-button', onClick: () => props.onReload(true) },
                  tr('retry'),
                ),
              ),
            )
          : providers.length === 0
            ? h(
                'div',
                { className: 'dsu-card' },
                h('p', { className: 'dsu-hint' }, tr('quotaLoading')),
                h('div', { className: 'dsu-skel' }),
                h('div', { className: 'dsu-skel dsu-skelShort' }),
              )
            : h(
                'div',
                { className: 'dsu-stack' },
                providers.map((provider) =>
                  h(QuotaCard, {
                    key: String(provider.id),
                    provider: { ...provider, windows: dedupeWindows(provider.windows, provider.id) },
                    now: props.now,
                  }),
                ),
              ),
      )
    }

    // -----------------------------------------------------------------------
    // Section root
    // -----------------------------------------------------------------------

    /**
     * The settings section root.
     *
     * Two requests, on purpose. The Host answers the local fold in tens of
     * milliseconds and a provider quota from cache (revalidating behind the
     * response), so issuing them separately lets the cards and the calendar
     * paint while the quota section is still filling in — the panel used to
     * block its first paint on an 8-second provider round trip.
     */
    function UsageSection() {
      useLocaleVersion()
      const [usageState, reloadUsage] = useApi(ROUTES.usage, true, 60_000)
      const [quotaState, reloadQuota] = useApi(ROUTES.quota, true, 120_000)
      const [busy, setBusy] = useState(false)
      const [selected, setSelected] = useState(todayKey)
      const now = useNow(30_000)

      const refresh = useCallback(() => {
        setBusy(true)
        reloadUsage(true)
        reloadQuota(true)
        setTimeout(() => setBusy(false), 600)
      }, [reloadUsage, reloadQuota])

      // While the Host reports a background revalidation, come back for its
      // answer. The counter caps a provider that never settles.
      const polls = useRef(0)
      useEffect(() => {
        if (quotaState.status !== 'ready' || quotaState.body?.quota?.refreshing !== true) {
          polls.current = 0
          return undefined
        }
        if (polls.current >= 10) return undefined
        polls.current += 1
        const timer = setTimeout(() => reloadQuota(false), 1_500)
        return () => clearTimeout(timer)
      }, [quotaState, reloadQuota])

      const usageReady = usageState.status === 'ready' && usageState.body?.ok === true
      const usage = usageReady ? usageState.body.usage : undefined
      const days = usage?.days ?? []
      const byDate = useMemo(() => {
        const map = new Map()
        for (const bucket of days) map.set(bucket.date, bucket)
        return map
      }, [days])

      const header = h(
        'div',
        { className: 'dsu-colHead' },
        h(
          'div',
          { className: 'dsu-colTitle' },
          h('h2', { className: 'dsu-h2' }, tr('heading')),
          h('span', { className: 'dsu-hint' }, tr('subtitle')),
        ),
        h(
          'div',
          { className: 'dsu-colActions' },
          usageReady ? h('span', { className: 'dsu-hint' }, clock(usageState.body.generatedAt)) : null,
          h(
            'button',
            { type: 'button', className: 'dsu-button', onClick: refresh, disabled: busy },
            busy ? tr('refreshing') : tr('refresh'),
          ),
        ),
      )

      if (usageState.status === 'error') {
        return h(
          'div',
          { className: 'dsu-root' },
          header,
          h(
            'div',
            { className: 'dsu-card dsu-cardWarn' },
            h('h3', { className: 'dsu-cardTitle' }, tr('loadFailed')),
            h('p', { className: 'dsu-hint' }, `${usageState.code ?? ''} ${usageState.message ?? ''}`.trim()),
            h(
              'div',
              { className: 'dsu-actions' },
              h('button', { type: 'button', className: 'dsu-button', onClick: refresh }, tr('retry')),
            ),
          ),
        )
      }

      if (usage === undefined) {
        return h(
          'div',
          { className: 'dsu-root' },
          header,
          h(
            'div',
            { className: 'dsu-card' },
            h('div', { className: 'dsu-skel' }),
            h('div', { className: 'dsu-skel dsu-skelShort' }),
          ),
        )
      }

      if (usageReady && usageState.body.ok !== true) {
        return h(
          'div',
          { className: 'dsu-root' },
          header,
          h(
            'div',
            { className: 'dsu-card dsu-cardWarn' },
            h('p', { className: 'dsu-hint' }, `${usageState.body.code ?? ''} ${usageState.body.message ?? ''}`.trim()),
          ),
        )
      }

      return h(
        'div',
        { className: 'dsu-root' },
        header,
        h(Summary, { today: usage.today, totals: usage.totals, available: usage.available === true }),
        h(Calendar, { days, selected, onSelect: setSelected }),
        h(DayDetail, { bucket: byDate.get(selected), date: selected }),
        h(Quota, { state: quotaState, onReload: reloadQuota, now }),
        h(
          'p',
          { className: 'dsu-foot' },
          `${tr('note')} ${tr('generatedAt')} ${stamp(usageState.body.generatedAt)} · ${tr('timeZone')} ${String(usageState.body.timeZone ?? '—')} · ${tr('sessions')} ${plain(usage.scan?.sessions)}`,
        ),
        (usage.scan?.warnings ?? []).length === 0
          ? null
          : h(
              'p',
              { className: 'dsu-foot dsu-warnText' },
              (usage.scan.warnings ?? []).join(' / '),
            ),
      )
    }

    // -----------------------------------------------------------------------
    // Navigation chrome
    // -----------------------------------------------------------------------

    /**
     * The settings-nav row for this section.
     *
     * The shell picks a nav glyph from the section id (`account`, `models`,
     * `agent-presets`, `plugins`, and a settings gear for anything else) and a
     * `settings.section` registration carries no icon option, so an unknown id
     * can only ever draw that gear. The one verbatim seat is the registered
     * label, which the shell renders inside the nav row, so the glyph rides
     * here instead and the stylesheet retires the fallback beside it.
     *
     * The glyph is inlined rather than shipped as a file: the browser half is
     * not built, so nothing carries an `.svg` to the page. `currentColor` makes
     * it follow the rail's own text colour in either theme.
     *
     * @returns {ReturnType<typeof h>}
     */
    function navLabel() {
      const glyph = h(
        'svg',
        {
          className: 'dsu-navIcon',
          viewBox: '0 0 16 16',
          width: 16,
          height: 16,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('rect', { x: 2.3, y: 9.1, width: 2.7, height: 4.5, rx: 1.2 }),
        h('rect', { x: 6.65, y: 6.1, width: 2.7, height: 7.5, rx: 1.2 }),
        h('rect', { x: 11.0, y: 2.9, width: 2.7, height: 10.7, rx: 1.2 }),
      )
      return h('span', { className: 'dsu-navItem' }, glyph, h('span', { className: 'dsu-navText' }, tr('nav')))
    }

    // -----------------------------------------------------------------------
    // Plugin
    // -----------------------------------------------------------------------

    /** The client locale service, when this composition exposes it. */
    const localeRef = { current: undefined }

    const CSS = `
.dsu-root{display:flex;flex-direction:column;gap:14px;padding:2px 0 18px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,currentColor)}
.dsu-h2{margin:0;font-size:17px;font-weight:600;line-height:24px}
.dsu-cardTitle{margin:0;font-size:13px;font-weight:600;line-height:20px}
.dsu-colHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.dsu-colTitle{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsu-colActions{display:flex;align-items:center;gap:8px;flex:none}
.dsu-stack{display:flex;flex-direction:column;gap:12px}
.dsu-section{display:flex;flex-direction:column;gap:12px}
.dsu-card{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));border-radius:12px;padding:13px 15px;background:var(--dsw-alias-bg-layer-2,transparent);display:flex;flex-direction:column;gap:8px;min-width:0}
.dsu-cardWarn{border-color:var(--dsw-alias-state-warn-primary,rgba(210,153,34,.5))}
.dsu-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.dsu-gridTight{gap:10px}
.dsu-statRow{display:flex;gap:18px;min-width:0}
.dsu-stat{display:flex;flex-direction:column;gap:1px;min-width:0}
.dsu-statLabel{font-size:11px;color:var(--dsw-alias-label-secondary,currentColor);opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsu-statValue{font-size:20px;font-weight:600;line-height:26px;font-variant-numeric:tabular-nums;letter-spacing:.2px;overflow-wrap:anywhere}
.dsu-statHint{font-size:11px;color:var(--dsw-alias-label-secondary,currentColor);opacity:.75}
.dsu-accent{color:var(--dsw-alias-brand-primary,currentColor)}
.dsu-ok{color:var(--dsw-alias-state-success-primary,currentColor)}
.dsu-errText{color:var(--dsw-alias-state-error-primary,currentColor)}
.dsu-warnText{color:var(--dsw-alias-state-warn-primary,currentColor)}
.dsu-hint{margin:0;font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary,currentColor);opacity:.85}
.dsu-lines{display:flex;flex-direction:column;gap:3px}
.dsu-line{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-size:12px}
.dsu-lineLabel{color:var(--dsw-alias-label-secondary,currentColor);opacity:.85}
.dsu-lineValue{font-variant-numeric:tabular-nums}
.dsu-actions{display:flex;gap:8px;margin-top:2px}
.dsu-button{box-sizing:border-box;height:28px;padding:0 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
.dsu-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.12))}
.dsu-button:disabled{opacity:.5;cursor:default}
.dsu-iconBtn{box-sizing:border-box;width:24px;height:24px;padding:0;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:transparent;color:inherit;font:inherit;font-size:14px;line-height:1;cursor:pointer}
.dsu-iconBtn:hover{background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.12))}
.dsu-monthBtn{box-sizing:border-box;height:24px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:transparent;color:inherit;font:inherit;font-size:12px;font-variant-numeric:tabular-nums;cursor:pointer}
.dsu-monthBtn:hover{background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.12))}
.dsu-calCard{gap:10px}
.dsu-calNav{display:flex;align-items:center;gap:6px;flex:none}
.dsu-monthTotals{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary,currentColor);opacity:.9}
.dsu-monthTotals b{font-variant-numeric:tabular-nums;font-weight:600;font-size:12px}
.dsu-dot{opacity:.5}
.dsu-weekRow{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;padding:0 1px}
.dsu-weekday{text-align:center;font-size:10px;color:var(--dsw-alias-label-secondary,currentColor);opacity:.7}
.dsu-calGrid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
.dsu-day{box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;gap:4px;min-height:42px;padding:5px 6px;border-radius:9px;border:1px solid transparent;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.06));color:inherit;font:inherit;text-align:left;cursor:pointer;overflow:hidden}
.dsu-dayPad{background:transparent;cursor:default;border-color:transparent}
.dsu-dayEmpty{opacity:.55}
.dsu-dayFilled:hover{border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.4))}
.dsu-dayToday{box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary,rgba(59,110,245,.55))}
.dsu-daySelected{border-color:var(--dsw-alias-brand-primary,currentColor)}
.dsu-dayNum{font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,currentColor);opacity:.9}
.dsu-dayFilled .dsu-dayNum{color:var(--dsw-alias-label-primary,currentColor);opacity:1}
.dsu-dayBars{display:flex;flex-direction:column;gap:3px}
.dsu-dayBar{display:block;height:4px;border-radius:999px;min-width:0}
.dsu-dayBarTotal{background:var(--dsw-alias-brand-primary,#3b6ef5);opacity:.85}
.dsu-dayBarCache{background:var(--dsw-alias-state-success-primary,#3fb950);opacity:.8}
.dsu-legend{display:flex;flex-wrap:wrap;align-items:center;gap:14px;font-size:11px;color:var(--dsw-alias-label-secondary,currentColor)}
.dsu-legendItem{display:inline-flex;align-items:center;gap:6px}
.dsu-swatch{display:inline-block;width:12px;height:4px;border-radius:999px}
.dsu-swatchTotal{background:var(--dsw-alias-brand-primary,#3b6ef5)}
.dsu-swatchCache{background:var(--dsw-alias-state-success-primary,#3fb950)}
.dsu-bar{width:100%;border-radius:999px;background:var(--dsw-alias-border-l1,rgba(128,128,128,.22));overflow:hidden}
.dsu-barFill{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary,#3b6ef5);opacity:.85}
.dsu-barOver{background:var(--dsw-alias-state-error-primary,#e5534b);opacity:.95}
.dsu-window{display:flex;flex-direction:column;gap:5px}
.dsu-windowTop{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.dsu-windowName{font-weight:600;font-size:12px}
.dsu-windowValue{font-variant-numeric:tabular-nums;font-size:12px}
.dsu-windowFoot{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-size:11px;color:var(--dsw-alias-label-secondary,currentColor);opacity:.85}
.dsu-pill{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));font-size:11px;white-space:nowrap}
/* Outline, never a filled chip: these tokens carry one state colour each, so a
   filled pill would paint its own label in the same colour it fills with. */
.dsu-pillOk{border-color:var(--dsw-alias-state-success-primary,#22c55e);color:var(--dsw-alias-state-success-primary,#22c55e);font-weight:600}
.dsu-pillErr{border-color:var(--dsw-alias-state-error-primary,#e5534b);color:var(--dsw-alias-state-error-primary,#e5534b);font-weight:600}
.dsu-pillPlan{border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.35));font-weight:600;align-self:flex-start}
.dsu-pillMuted{color:var(--dsw-alias-label-secondary,currentColor);opacity:.85}
.dsu-providers{display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));padding-top:8px}
.dsu-providerTitle{font-size:11px;color:var(--dsw-alias-label-secondary,currentColor);opacity:.8}
.dsu-providerRow{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-size:11px}
.dsu-foot{margin:0;font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary,currentColor);opacity:.75}
.dsu-skel{height:16px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.16))}
.dsu-skelShort{width:55%}
.dsu-navItem{display:inline-flex;align-items:center;gap:8px;min-width:0}
.dsu-navText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsu-navIcon{flex:none;width:16px;height:16px}
/* The nav row belongs to the shell, which draws its own fallback glyph from the
   section id; it steps aside while the label beside it carries ours. */
button:has(.dsu-navItem)>svg{display:none}
`

    /** Stylesheet identity used to install the plugin's CSS exactly once. */
    const STYLE_ID = '@local/dsh-usage/client.css'

    /** Install the plugin stylesheet into the document head once. */
    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = '@local/dsh-usage'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /** Namespaces this client half needs; both are core to the web shell. */
    const inject = ['slots']

    /**
     * Register the plugin's dictionary (routing visible text through the Client
     * locale service) and its one settings section.
     *
     * @param {any} ctx client plugin context.
     */
    function apply(ctx) {
      ensureStyle()
      const locale = ctx.get('locale')
      localeRef.current = locale
      if (locale !== undefined) {
        ctx.effect(() => {
          const offZh = locale.register(LOCALE_NS, 'zh', DICT.zh)
          const offEn = locale.register(LOCALE_NS, 'en', DICT.en)
          try {
            translate = locale.bind(LOCALE_NS)
          } catch {
            translate = undefined
          }
          return () => {
            translate = undefined
            offZh()
            offEn()
          }
        }, 'dsh-usage: locale dictionaries')
      }
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          // 25 keeps the row directly below Agent 预设 (20) and above nothing else.
          { name: 'settings.section', id: SECTION_ID, order: 25, label: navLabel },
          UsageSection,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
