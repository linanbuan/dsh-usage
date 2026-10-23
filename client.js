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
        todayUsage: '当日用量',
        todayCache: '当日缓存命中',
        allUsage: '累计用量',
        allCache: '累计缓存命中',
        totalUsage: '总用量',
        cacheHit: '缓存命中',
        input: '输入',
        output: '输出',
        cacheRead: '缓存读取',
        cacheWrite: '缓存写入',
        requests: '计费次数',
        activity: 'Token 活动',
        activityHint: '每格一天或一周，颜色越深用量越多；把指针放上去看那一段的数字。',
        grainDay: '每日',
        grainWeek: '每周',
        less: '少',
        more: '多',
        peakDay: '峰值单日',
        streak: '连续使用',
        streakHint: '最长 {n} 天',
        dayUnit: '天',
        cacheShare: '缓存占提示词',
        windowTotal: '区间用量',
        windowCache: '区间缓存命中',
        prevWindow: '往前一年',
        nextWindow: '往后一年',
        noRecord: '没有记录',
        noData: '区间内没有记录。',
        dayDetail: '选中日期',
        weekDetail: '选中周',
        weekWord: '第 {n} 周',
        pickDay: '在上方的热力图里选一格，查看那一段的精确数字。',
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
        unavailable: '本组合未挂载会话持久化，无法统计用量。',
        generatedAt: '统计时间',
        timeZone: '时区',
        sessions: '会话',
        note: '总用量 = 输入 + 缓存读取 + 缓存写入 + 输出；缓存命中为其中的缓存读取部分。',
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
        todayUsage: 'Today',
        todayCache: 'Cache hits today',
        allUsage: 'All time',
        allCache: 'Cache hits all time',
        totalUsage: 'Total',
        cacheHit: 'Cache hits',
        input: 'Input',
        output: 'Output',
        cacheRead: 'Cache read',
        cacheWrite: 'Cache write',
        requests: 'Billed calls',
        activity: 'Token activity',
        activityHint: 'One cell per day or per week; darker means more usage. Hover a cell for its figures.',
        grainDay: 'Daily',
        grainWeek: 'Weekly',
        less: 'Less',
        more: 'More',
        peakDay: 'Peak day',
        streak: 'Streak',
        streakHint: 'longest {n} days',
        dayUnit: 'days',
        cacheShare: 'Cache share of prompt',
        windowTotal: 'Window total',
        windowCache: 'Window cache hits',
        prevWindow: 'One year back',
        nextWindow: 'One year forward',
        noRecord: 'No records',
        noData: 'No records in this window.',
        dayDetail: 'Selected day',
        weekDetail: 'Selected week',
        weekWord: 'Week {n}',
        pickDay: 'Pick a cell in the heatmap above to see that stretch\u2019s exact figures.',
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
        unavailable: 'This composition mounts no session persistence, so usage cannot be counted.',
        generatedAt: 'Read at',
        timeZone: 'Time zone',
        sessions: 'Sessions',
        note: 'Total = input + cache read + cache write + output; cache hits are the cache-read share of it.',
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

    /**
     * `tr` for the handful of strings with a `{n}` slot.
     *
     * @param {string} key
     * @param {string|number} value
     * @returns {string}
     */
    function trn(key, value) {
      return tr(key).replace('{n}', String(value))
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
    // Calendar helpers — local dates, Monday-first weeks, and the shading scale
    // -----------------------------------------------------------------------

    /** Window width of the heatmap, in whole months. */
    const WINDOW_MONTHS = 12

    /** @param {number} value @returns {string} at least two digits. */
    function pad2(value) {
      return String(value).padStart(2, '0')
    }

    /**
     * @param {Date} date
     * @returns {string} `YYYY-MM-DD` in the operator's own timezone.
     */
    function dateKey(date) {
      return `${String(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    }

    /** @returns {string} `YYYY-MM-DD` for the current local date. */
    function todayKey() {
      return dateKey(new Date())
    }

    /**
     * @param {string} key `YYYY-MM-DD`
     * @returns {Date} local midnight of that day; an unparsable key falls back to today.
     */
    function parseKey(key) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key))
      if (match === null) return new Date()
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    }

    /**
     * Date arithmetic on calendar parts, never on milliseconds: a day is a day
     * across a DST switch, and midnight + 24h is not.
     *
     * @param {Date} date
     * @param {number} delta days
     * @returns {Date}
     */
    function addDays(date, delta) {
      return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta)
    }

    /** @returns {Date} the Monday of the week containing `date`. */
    function startOfWeek(date) {
      return addDays(date, -((date.getDay() + 6) % 7))
    }

    /** @returns {Date} the Sunday of the week containing `date`. */
    function endOfWeek(date) {
      return addDays(startOfWeek(date), 6)
    }

    /** @returns {string} the Monday key identifying the week a day belongs to. */
    function weekKeyOf(key) {
      return dateKey(startOfWeek(parseKey(key)))
    }

    /**
     * @param {Date} date
     * @returns {number} ISO-8601 week number (1-53).
     */
    function isoWeek(date) {
      const thursday = addDays(startOfWeek(date), 3)
      const firstThursday = addDays(startOfWeek(new Date(thursday.getFullYear(), 0, 4)), 3)
      return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604_800_000)
    }

    /**
     * @param {number} year
     * @param {number} month 1-12
     * @param {number} delta months
     * @returns {{ year: number, month: number }}
     */
    function shiftMonth(year, month, delta) {
      const at = new Date(year, month - 1 + delta, 1)
      return { year: at.getFullYear(), month: at.getMonth() + 1 }
    }

    /**
     * The window the heatmap draws: whole months, ending with the anchor month.
     *
     * Whole months (not "today minus 364 days") keep the month labels honest and
     * stop the grid from re-flowing every single day.
     *
     * @param {{ year: number, month: number }} anchor
     * @returns {{ startKey: string, endKey: string }}
     */
    function windowRange(anchor) {
      const from = shiftMonth(anchor.year, anchor.month, -(WINDOW_MONTHS - 1))
      return {
        startKey: dateKey(new Date(from.year, from.month - 1, 1)),
        endKey: dateKey(new Date(anchor.year, anchor.month, 0)),
      }
    }

    /**
     * Day-mode columns: one per week, seven cells each, Monday first.
     *
     * Cells outside the window are returned as well — the grid needs its
     * rectangle — but flagged `inRange: false` so they draw as inert padding
     * instead of as days with no usage.
     *
     * @param {string} startKey
     * @param {string} endKey
     * @returns {{ key: string, date: Date, inRange: boolean }[][]}
     */
    function dayColumns(startKey, endKey) {
      const columns = []
      const last = endOfWeek(parseKey(endKey))
      for (let cursor = startOfWeek(parseKey(startKey)); cursor <= last; cursor = addDays(cursor, 7)) {
        const week = []
        for (let index = 0; index < 7; index += 1) {
          const date = addDays(cursor, index)
          const key = dateKey(date)
          week.push({ key, date, inRange: key >= startKey && key <= endKey })
        }
        columns.push(week)
      }
      return columns
    }

    /**
     * Week-mode columns: one cell per whole week, clipped to the window.
     *
     * @param {string} startKey
     * @param {string} endKey
     * @returns {{ key: string, startKey: string, endKey: string, days: string[] }[]}
     */
    function weekColumns(startKey, endKey) {
      const columns = []
      for (let cursor = startOfWeek(parseKey(startKey)); cursor <= parseKey(endKey); cursor = addDays(cursor, 7)) {
        const days = []
        for (let index = 0; index < 7; index += 1) {
          const key = dateKey(addDays(cursor, index))
          if (key >= startKey && key <= endKey) days.push(key)
        }
        columns.push({
          key: dateKey(cursor),
          startKey: dateKey(cursor),
          endKey: dateKey(addDays(cursor, 6)),
          days,
        })
      }
      return columns
    }

    /**
     * Month labels under the grid.
     *
     * A label rides the first column of its month; one that would sit on top of
     * the previous label (short month, narrow panel) is dropped rather than
     * overprinted.
     *
     * @param {{ inRange: boolean, date: Date }[][]} columns day-mode columns
     * @returns {{ column: number, label: string }[]} `column` is 1-based.
     */
    function monthTicks(columns) {
      const ticks = []
      let lastMonth = ''
      let lastColumn = -99
      columns.forEach((week, index) => {
        const first = week.find((cell) => cell.inRange)
        if (first === undefined) return
        const month = first.key.slice(0, 7)
        if (month === lastMonth) return
        lastMonth = month
        if (index - lastColumn < 2) return
        ticks.push({ column: index + 1, label: monthLabel(first.date) })
        lastColumn = index
      })
      return ticks
    }

    /** English short month names; Chinese months are built as `${n}月`. */
    const MONTH_NAMES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    /** Weekday names, indexed by `Date#getDay()` (0 = Sunday). */
    const WEEKDAY_NAMES = {
      zh: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
      en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    }

    /**
     * @param {Date} date
     * @returns {string} the month label under the grid.
     */
    function monthLabel(date) {
      return langOf() === 'zh' ? `${String(date.getMonth() + 1)}月` : MONTH_NAMES_EN[date.getMonth()]
    }

    /**
     * @param {Date} date
     * @returns {string} `2026年8月8日` / `Aug 8, 2026`.
     */
    function dateLabel(date) {
      return langOf() === 'zh'
        ? `${String(date.getFullYear())}年${String(date.getMonth() + 1)}月${String(date.getDate())}日`
        : `${MONTH_NAMES_EN[date.getMonth()]} ${String(date.getDate())}, ${String(date.getFullYear())}`
    }

    /**
     * @param {string} key `YYYY-MM-DD`
     * @returns {string} `2026年8月8日 周六` / `Sat, Aug 8, 2026`.
     */
    function dayLabel(key) {
      const date = parseKey(key)
      return langOf() === 'zh'
        ? `${dateLabel(date)} ${WEEKDAY_NAMES.zh[date.getDay()]}`
        : `${WEEKDAY_NAMES.en[date.getDay()]}, ${dateLabel(date)}`
    }

    /**
     * @param {string} startKey
     * @param {string} endKey
     * @returns {string} `8月3日 → 8月9日` (same year) or `2025年12月29日 → 2026年1月4日`.
     */
    function spanLabel(startKey, endKey) {
      const from = parseKey(startKey)
      const to = parseKey(endKey)
      const tail = dateLabel(to)
      const head =
        from.getFullYear() === to.getFullYear() && langOf() === 'zh'
          ? `${String(from.getMonth() + 1)}月${String(from.getDate())}日`
          : dateLabel(from)
      return `${head} → ${tail}`
    }

    /**
     * @param {string} startKey
     * @param {string} endKey
     * @returns {string} `2025年11月 → 2026年10月` / `Nov 2025 → Oct 2026`.
     */
    function monthSpanLabel(startKey, endKey) {
      /** @param {Date} date */
      const name = (date) =>
        langOf() === 'zh'
          ? `${String(date.getFullYear())}年${String(date.getMonth() + 1)}月`
          : `${MONTH_NAMES_EN[date.getMonth()]} ${String(date.getFullYear())}`
      return `${name(parseKey(startKey))} → ${name(parseKey(endKey))}`
    }

    /**
     * @param {any|undefined} bucket
     * @param {'total'|'cache'} metric
     * @returns {number} the figure the cell is shaded by.
     */
    function metricOf(bucket, metric) {
      if (bucket === undefined || bucket === null) return 0
      return metric === 'cache' ? (bucket.cacheRead ?? 0) : (bucket.total ?? 0)
    }

    /**
     * Quartile thresholds over the window's non-zero values.
     *
     * Fixed cut-offs would paint a quiet account entirely empty and a busy one
     * entirely darkest; quartiles keep four visible steps at any scale. Ties are
     * collapsed, so a window where every day is equal renders as one shade
     * instead of pretending to have four.
     *
     * @param {number[]} values
     * @returns {number[]} ascending, at most three entries.
     */
    function thresholdsOf(values) {
      const sorted = values.filter((value) => value > 0).sort((left, right) => left - right)
      if (sorted.length === 0) return []
      const at = (share) => sorted[Math.min(sorted.length - 1, Math.floor(share * (sorted.length - 1)))]
      const ascending = []
      for (const value of [at(0.4), at(0.65), at(0.85)]) {
        if (!ascending.includes(value)) ascending.push(value)
      }
      return ascending
    }

    /**
     * @param {number} value
     * @param {number[]} thresholds
     * @returns {0|1|2|3|4} 0 means "nothing to shade".
     */
    function levelOf(value, thresholds) {
      if (value <= 0) return 0
      let level = 1
      for (let index = 0; index < thresholds.length; index += 1) {
        if (value > thresholds[index]) level = index + 2
      }
      return Math.min(4, level)
    }

    /**
     * Sum day buckets into one, provider split included.
     *
     * @param {Iterable<any|undefined>} buckets
     * @param {string} date label for the result.
     * @returns {any|undefined} `undefined` when none of the days has a record.
     */
    function aggregateBuckets(buckets, date) {
      const empty = () => ({
        date,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
        requests: 0,
        providers: {},
      })
      const sum = empty()
      let found = false
      for (const bucket of buckets) {
        if (bucket === undefined || bucket === null) continue
        found = true
        sum.input += bucket.input ?? 0
        sum.output += bucket.output ?? 0
        sum.cacheRead += bucket.cacheRead ?? 0
        sum.cacheWrite += bucket.cacheWrite ?? 0
        sum.total += bucket.total ?? 0
        sum.requests += bucket.requests ?? 0
        for (const [name, child] of Object.entries(bucket.providers ?? {})) {
          const into = sum.providers[name] ?? empty()
          into.input += child.input ?? 0
          into.output += child.output ?? 0
          into.cacheRead += child.cacheRead ?? 0
          into.cacheWrite += child.cacheWrite ?? 0
          into.total += child.total ?? 0
          into.requests += child.requests ?? 0
          sum.providers[name] = into
        }
      }
      return found ? sum : undefined
    }

    /**
     * @param {string[]} dayKeys every day that has records
     * @param {string} today
     * @returns {{ current: number, longest: number }} in days.
     */
    function streaks(dayKeys, today) {
      const set = new Set(dayKeys)
      let longest = 0
      let run = 0
      let previous
      for (const key of [...set].sort()) {
        if (previous !== undefined && dateKey(addDays(parseKey(previous), 1)) === key) run += 1
        else run = 1
        if (run > longest) longest = run
        previous = key
      }
      // A streak that ran to yesterday survives until today is over; only a gap
      // of a whole day ends it.
      let cursor = parseKey(today)
      if (!set.has(today)) cursor = addDays(cursor, -1)
      let current = 0
      while (set.has(dateKey(cursor))) {
        current += 1
        cursor = addDays(cursor, -1)
      }
      return { current, longest }
    }

    // -----------------------------------------------------------------------
    // Shared chrome
    // -----------------------------------------------------------------------

    /**
     * @param {{ label: string, value: string, hint?: string }} props
     */
    function Stat(props) {
      return h(
        'div',
        { className: 'dsu-stat' },
        h('span', { className: 'dsu-statLabel' }, props.label),
        h('span', { className: 'dsu-statValue' }, props.value),
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
     * The headline strip: today, all time, the busiest day and the streak.
     *
     * One card, because the two cards this replaces were read as two different
     * seasons; the cache figures ride as the hint under the usage they belong to,
     * which keeps them just as visible without a third card.
     *
     * @param {{ today: any, totals: any, days: any[], available: boolean }} props
     */
    function StatStrip(props) {
      useLocaleVersion()
      const today = props.today ?? {}
      const totals = props.totals ?? {}
      const days = props.days ?? []
      const derived = useMemo(() => {
        let busiest
        for (const bucket of days) {
          if (busiest === undefined || (bucket.total ?? 0) > (busiest.total ?? 0)) busiest = bucket
        }
        const streak = streaks(
          days.map((bucket) => bucket.date),
          todayKey(),
        )
        return { peak: busiest, current: streak.current, longest: streak.longest }
      }, [days])

      /** @param {any} bucket @returns {string} the cache-read share of the prompt. */
      const share = (bucket) => {
        const prompt = (bucket.input ?? 0) + (bucket.cacheRead ?? 0) + (bucket.cacheWrite ?? 0)
        return prompt > 0 ? percent((bucket.cacheRead ?? 0) / prompt) : '—'
      }
      /** @param {any} bucket @returns {string} */
      const breakdown = (bucket) =>
        `${tr('input')} ${plain(bucket.input)} · ${tr('output')} ${plain(bucket.output)} · ${tr('cacheWrite')} ${plain(bucket.cacheWrite)} · ${tr('requests')} ${plain(bucket.requests)}`

      /**
       * @param {string} key
       * @param {string} label
       * @param {string} value
       * @param {string|undefined} hint
       */
      const stat = (key, label, value, hint) =>
        h(
          'div',
          { className: 'dsu-stat', key },
          h('span', { className: 'dsu-statLabel' }, label),
          h('span', { className: 'dsu-statValue' }, value),
          hint === undefined ? null : h('span', { className: 'dsu-statHint' }, hint),
        )

      return h(
        'div',
        { className: 'dsu-card dsu-stripCard' },
        h(
          'div',
          { className: 'dsu-strip' },
          stat('todayUsage', tr('todayUsage'), plain(today.total)),
          stat('todayCache', tr('todayCache'), plain(today.cacheRead), `${tr('cacheShare')} ${share(today)}`),
          stat('allUsage', tr('allUsage'), plain(totals.total)),
          stat('allCache', tr('allCache'), plain(totals.cacheRead), `${tr('cacheShare')} ${share(totals)}`),
          stat('peak', tr('peakDay'), plain(derived.peak?.total), derived.peak === undefined ? undefined : dayLabel(derived.peak.date)),
          stat('streak', tr('streak'), `${String(derived.current)} ${tr('dayUnit')}`, trn('streakHint', derived.longest)),
        ),
        h(
          'div',
          { className: 'dsu-stripFoot' },
          h('span', null, `${tr('today')} ${breakdown(today)}`),
          h('span', null, `${tr('allTime')} ${breakdown(totals)}`),
        ),
        props.available ? null : h('p', { className: 'dsu-hint dsu-warnText' }, tr('unavailable')),
      )
    }

    /**
     * The activity heatmap: one cell per day (每日) or per week (每周), shaded by
     * the chosen metric against the window's own quartiles.
     *
     * Why a heatmap rather than the month calendar this replaces: a month grid
     * re-flows with every month and can only compare 31 days against each other.
     * A rolling year keeps one shape, and a four-step scale shows the shape of a
     * heavy stretch without printing eight-digit numbers inside a 15px cell.
     *
     * @param {{
     *   days: any[],
     *   grain: 'day'|'week',
     *   onGrain: (grain: 'day'|'week') => void,
     *   selected: { grain: 'day'|'week', key: string },
     *   onSelect: (key: string) => void,
     * }} props
     */
    function Activity(props) {
      useLocaleVersion()
      const [metric, setMetric] = useState('total')
      const [anchor, setAnchor] = useState(() => {
        const at = new Date()
        return { year: at.getFullYear(), month: at.getMonth() + 1 }
      })
      const [hover, setHover] = useState(undefined)
      const plotRef = useRef(undefined)

      const byDate = useMemo(() => {
        const map = new Map()
        for (const bucket of props.days ?? []) map.set(bucket.date, bucket)
        return map
      }, [props.days])

      const range = useMemo(() => windowRange(anchor), [anchor])
      const columns = useMemo(
        () =>
          props.grain === 'week'
            ? weekColumns(range.startKey, range.endKey)
            : dayColumns(range.startKey, range.endKey),
        [props.grain, range],
      )

      const today = todayKey()

      /** Every cell of the current mode, with the figure it is shaded by. */
      const cells = useMemo(() => {
        if (props.grain === 'week') {
          return columns.map((week, index) => {
            const bucket = aggregateBuckets(
              week.days.map((key) => byDate.get(key)),
              week.startKey,
            )
            return { key: week.key, column: index + 1, row: 1, week, bucket, value: metricOf(bucket, metric) }
          })
        }
        const list = []
        columns.forEach((week, column) => {
          week.forEach((cell, row) => {
            if (!cell.inRange) return
            const bucket = byDate.get(cell.key)
            list.push({
              key: cell.key,
              column: column + 1,
              row: row + 1,
              bucket,
              value: metricOf(bucket, metric),
              future: cell.key > today,
            })
          })
        })
        return list
      }, [byDate, columns, metric, props.grain, today])

      const thresholds = useMemo(() => thresholdsOf(cells.map((cell) => cell.value)), [cells])
      const windowUsage = cells.reduce((sum, cell) => sum + (cell.bucket?.total ?? 0), 0)
      const windowCache = cells.reduce((sum, cell) => sum + (cell.bucket?.cacheRead ?? 0), 0)

      const ticks = useMemo(() => {
        if (props.grain !== 'week') return monthTicks(columns)
        const list = []
        let lastMonth = ''
        let lastColumn = -99
        columns.forEach((week, index) => {
          // The first week usually reaches back into the month before the window;
          // labelling it with that month would date the window wrongly.
          const anchorKey = week.startKey < range.startKey ? range.startKey : week.startKey
          const month = anchorKey.slice(0, 7)
          if (month === lastMonth) return
          lastMonth = month
          if (index - lastColumn < 2) return
          list.push({ column: index + 1, label: monthLabel(parseKey(anchorKey)) })
          lastColumn = index
        })
        return list
      }, [columns, props.grain])

      // The window never runs past the current month: a future month has nothing
      // to shade, and twelve empty columns read as a broken panel.
      const now = new Date()
      const anchorIndex = anchor.year * 12 + (anchor.month - 1)
      const currentIndex = now.getFullYear() * 12 + now.getMonth()
      const move = (delta) => {
        const next = shiftMonth(anchor.year, anchor.month, delta * WINDOW_MONTHS)
        if (next.year * 12 + (next.month - 1) > currentIndex) return
        setAnchor(next)
        setHover(undefined)
      }

      /**
       * Place the read-out above the hovered cell.
       *
       * It is absolutely positioned inside the plot rather than fixed to the
       * viewport, so a transformed ancestor in the settings shell cannot shift
       * it, and it is clamped to the plot's width so it never leaves the panel.
       */
      const showTip = (event, cell) => {
        const plot = plotRef.current
        if (plot === undefined || typeof plot.getBoundingClientRect !== 'function') return
        const rect = event.currentTarget.getBoundingClientRect()
        const base = plot.getBoundingClientRect()
        const width = 236
        const center = rect.left + rect.width / 2 - base.left
        const left = Math.max(4, Math.min(center - width / 2, Math.max(4, base.width - width - 4)))
        const above = rect.top - base.top
        const below = above < 160
        setHover({ cell, left, below, top: below ? rect.bottom - base.top + 8 : above - 8 })
      }
      const hideTip = () => setHover(undefined)

      /** @param {any} cell @returns {string} the read-out heading. */
      const cellTitle = (cell) =>
        props.grain === 'week'
          ? `${trn('weekWord', isoWeek(parseKey(cell.key)))} · ${spanLabel(cell.week.startKey, cell.week.endKey)}`
          : dayLabel(cell.key)

      /** @param {any} cell @returns {string} the accessible name of the cell. */
      const cellAria = (cell) => {
        const name = cellTitle(cell)
        return cell.bucket === undefined
          ? `${name}: ${tr('noRecord')}`
          : `${name}: ${tr('totalUsage')} ${plain(cell.bucket.total)}, ${tr('cacheHit')} ${plain(cell.bucket.cacheRead)}`
      }

      /** @param {any} cell */
      const renderCell = (cell) => {
        const level = levelOf(cell.value, thresholds)
        const classes = [
          'dsu-cell',
          `dsu-cellL${String(level)}`,
          metric === 'cache' ? 'dsu-cellCache' : 'dsu-cellTotal',
          cell.key === today ? 'dsu-cellToday' : '',
          props.selected.grain === props.grain && props.selected.key === cell.key ? 'dsu-cellSelected' : '',
          cell.future === true ? 'dsu-cellFuture' : '',
        ]
        return h('button', {
          key: `${props.grain}-${cell.key}`,
          type: 'button',
          className: classes.filter((part) => part !== '').join(' '),
          style: { gridColumn: String(cell.column), gridRow: String(cell.row) },
          'aria-label': cellAria(cell),
          disabled: cell.future === true,
          onClick: () => props.onSelect(cell.key),
          onMouseEnter: (event) => showTip(event, cell),
          onFocus: (event) => showTip(event, cell),
          onMouseLeave: hideTip,
          onBlur: hideTip,
        })
      }

      /** @param {any} cell */
      const renderTip = (cell) => {
        const lines =
          cell.bucket === undefined
            ? [h('p', { className: 'dsu-tipEmpty', key: 'empty' }, tr('noRecord'))]
            : [
                h(
                  'div',
                  { className: 'dsu-tipRow', key: 'total' },
                  h('span', null, tr('totalUsage')),
                  h('b', null, plain(cell.bucket.total)),
                ),
                h(
                  'div',
                  { className: 'dsu-tipRow', key: 'cache' },
                  h('span', null, tr('cacheHit')),
                  h('b', { className: 'dsu-ok' }, plain(cell.bucket.cacheRead)),
                ),
                h(
                  'p',
                  { className: 'dsu-tipFoot', key: 'breakdown' },
                  `${tr('input')} ${plain(cell.bucket.input)} · ${tr('output')} ${plain(cell.bucket.output)} · ${tr('cacheWrite')} ${plain(cell.bucket.cacheWrite)} · ${tr('requests')} ${plain(cell.bucket.requests)}`,
                ),
              ]
        return h(
          'div',
          {
            className: hover.below === true ? 'dsu-tip dsu-tipBelow' : 'dsu-tip',
            style: { left: `${String(hover.left)}px`, top: `${String(hover.top)}px` },
            role: 'tooltip',
          },
          h('div', { className: 'dsu-tipTitle' }, cellTitle(cell)),
          cell.key === today ? h('span', { className: 'dsu-tipBadge' }, tr('todayBadge')) : null,
          h('div', { className: 'dsu-tipBody' }, lines),
        )
      }

      /** @param {{ id: string, label: string }[]} options */
      const segmented = (options, current, onPick, label) =>
        h(
          'div',
          { className: 'dsu-seg', role: 'tablist', 'aria-label': label },
          options.map((option) =>
            h(
              'button',
              {
                key: option.id,
                type: 'button',
                role: 'tab',
                className: option.id === current ? 'dsu-segBtn dsu-segOn' : 'dsu-segBtn',
                'aria-selected': option.id === current,
                onClick: () => onPick(option.id),
              },
              option.label,
            ),
          ),
        )

      const rail = tr('weekdays').split('')

      return h(
        'div',
        { className: 'dsu-card dsu-heatCard' },
        h(
          'div',
          { className: 'dsu-colHead' },
          h(
            'div',
            { className: 'dsu-colTitle' },
            h('h3', { className: 'dsu-cardTitle' }, tr('activity')),
            h('span', { className: 'dsu-hint' }, tr('activityHint')),
          ),
          segmented(
            [
              { id: 'day', label: tr('grainDay') },
              { id: 'week', label: tr('grainWeek') },
            ],
            props.grain,
            (next) => props.onGrain(next === 'week' ? 'week' : 'day'),
            tr('activity'),
          ),
        ),
        h(
          'div',
          { className: 'dsu-heatBody' },
          props.grain === 'day'
            ? h(
                'div',
                { className: 'dsu-heatRail', 'aria-hidden': 'true' },
                rail.map((name, index) =>
                  h('span', { key: `r-${String(index)}`, className: 'dsu-heatRailCell' }, name),
                ),
              )
            : null,
          h(
            'div',
            { className: 'dsu-heatPlot', ref: plotRef },
            h(
              'div',
              {
                className: 'dsu-heatMonths',
                style: { gridTemplateColumns: `repeat(${String(columns.length)}, minmax(0, 1fr))` },
              },
              ticks.map((tick) =>
                h(
                  'span',
                  {
                    key: `t-${tick.label}-${String(tick.column)}`,
                    className: 'dsu-heatMonth',
                    style: { gridColumn: String(tick.column) },
                  },
                  tick.label,
                ),
              ),
            ),
            h(
              'div',
              {
                className: props.grain === 'week' ? 'dsu-heatGrid dsu-heatGridWeek' : 'dsu-heatGrid',
                style: { gridTemplateColumns: `repeat(${String(columns.length)}, minmax(0, 1fr))` },
              },
              cells.map(renderCell),
            ),
            hover === undefined ? null : renderTip(hover.cell),
          ),
        ),
        h(
          'div',
          { className: 'dsu-heatFoot' },
          h(
            'div',
            { className: 'dsu-heatFootLeft' },
            segmented(
              [
                { id: 'total', label: tr('totalUsage') },
                { id: 'cache', label: tr('cacheHit') },
              ],
              metric,
              (next) => {
                setMetric(next === 'cache' ? 'cache' : 'total')
                setHover(undefined)
              },
              tr('totalUsage'),
            ),
            h(
              'div',
              { className: 'dsu-legend' },
              h('span', null, tr('less')),
              [0, 1, 2, 3, 4].map((level) =>
                h('i', {
                  key: `l-${String(level)}`,
                  className: `dsu-swatch dsu-swatchL${String(level)} ${metric === 'cache' ? 'dsu-swatchCache' : 'dsu-swatchTotal'}`,
                }),
              ),
              h('span', null, tr('more')),
            ),
          ),
          h(
            'div',
            { className: 'dsu-heatNav' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsu-iconBtn',
                onClick: () => move(-1),
                'aria-label': tr('prevWindow'),
                title: tr('prevWindow'),
              },
              '‹',
            ),
            h('span', { className: 'dsu-range' }, monthSpanLabel(range.startKey, range.endKey)),
            h(
              'button',
              {
                type: 'button',
                className: 'dsu-iconBtn',
                onClick: () => move(1),
                'aria-label': tr('nextWindow'),
                title: tr('nextWindow'),
                disabled: anchorIndex >= currentIndex,
              },
              '›',
            ),
          ),
        ),
        h(
          'p',
          { className: 'dsu-hint dsu-heatTotal' },
          `${tr('windowTotal')} ${plain(windowUsage)} · ${tr('windowCache')} ${plain(windowCache)}${
            cells.every((cell) => cell.bucket === undefined) ? ` · ${tr('noData')}` : ''
          }`,
        ),
      )
    }

    /**
     * The card under the heatmap: exact figures for the selected day or week.
     *
     * A week arrives already summed from its days, so both grains print the same
     * rows — the point of this card is the digits, not the shape.
     *
     * @param {{ grain: 'day'|'week', point: string, bucket: any|undefined }} props
     */
    function SelectionDetail(props) {
      useLocaleVersion()
      if (props.bucket === undefined) {
        return h('div', { className: 'dsu-card' }, h('p', { className: 'dsu-hint' }, tr('pickDay')))
      }
      const bucket = props.bucket
      const title =
        props.grain === 'week'
          ? `${tr('weekDetail')} ${spanLabel(props.point, dateKey(addDays(parseKey(props.point), 6)))} · ${trn('weekWord', isoWeek(parseKey(props.point)))}`
          : `${tr('dayDetail')} ${dayLabel(props.point)}`
      return h(
        'div',
        { className: 'dsu-card dsu-detail' },
        h(
          'div',
          { className: 'dsu-colHead' },
          h('h3', { className: 'dsu-cardTitle' }, title),
          h('span', { className: 'dsu-pill' }, `${tr('requests')} ${plain(bucket.requests)}`),
        ),
        h(
          'div',
          { className: 'dsu-detailBody' },
          h(
            'div',
            { className: 'dsu-statRow' },
            h(Stat, { label: tr('totalUsage'), value: plain(bucket.total) }),
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
                { className: 'dsu-providerGrid' },
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
      const [grain, setGrain] = useState('day')
      const [selected, setSelected] = useState(todayKey)
      const now = useNow(30_000)

      const refresh = useCallback(() => {
        setBusy(true)
        reloadUsage(true)
        reloadQuota(true)
        setTimeout(() => setBusy(false), 600)
      }, [reloadUsage, reloadQuota])

      // Switching the grain moves the selection with it, so the detail card never
      // shows a week while the grid is drawing days.
      const changeGrain = useCallback((next) => {
        setGrain(next)
        setSelected(next === 'week' ? weekKeyOf(todayKey()) : todayKey())
      }, [])

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

      /** The selected day, or the seven selected days summed for a week. */
      const selectedBucket = useMemo(() => {
        if (grain !== 'week') return byDate.get(selected)
        const week = []
        for (let index = 0; index < 7; index += 1) week.push(byDate.get(dateKey(addDays(parseKey(selected), index))))
        return aggregateBuckets(week, selected)
      }, [byDate, grain, selected])

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
        h(StatStrip, { today: usage.today, totals: usage.totals, days, available: usage.available === true }),
        h(Activity, {
          days,
          grain,
          onGrain: changeGrain,
          selected: { grain, key: selected },
          onSelect: setSelected,
        }),
        h(SelectionDetail, { grain, point: selected, bucket: selectedBucket }),
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
.dsu-section{display:flex;flex-direction:column;gap:12px}
.dsu-card{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));border-radius:12px;padding:13px 15px;background:var(--dsw-alias-bg-layer-2,transparent);display:flex;flex-direction:column;gap:8px;min-width:0}
.dsu-cardWarn{border-color:var(--dsw-alias-state-warn-primary,rgba(210,153,34,.5))}

.dsu-ok{color:var(--dsw-alias-state-success-primary,currentColor)}
.dsu-errText{color:var(--dsw-alias-state-error-primary,currentColor)}
.dsu-warnText{color:var(--dsw-alias-state-warn-primary,currentColor)}
.dsu-hint{margin:0;font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary,currentColor);opacity:.85}
.dsu-lines{display:flex;flex-direction:column;gap:3px;flex:1 1 200px;min-width:0}
.dsu-line{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-size:12px}
.dsu-lineLabel{color:var(--dsw-alias-label-secondary,currentColor);opacity:.85}
.dsu-lineValue{font-variant-numeric:tabular-nums}
.dsu-actions{display:flex;gap:8px;margin-top:2px}
.dsu-button{box-sizing:border-box;height:28px;padding:0 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
.dsu-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.12))}
.dsu-button:disabled{opacity:.5;cursor:default}
.dsu-iconBtn{box-sizing:border-box;width:24px;height:24px;padding:0;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:transparent;color:inherit;font:inherit;font-size:14px;line-height:1;cursor:pointer}
.dsu-iconBtn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.12))}
.dsu-iconBtn:disabled{opacity:.4;cursor:default}
/* ── headline strip ──────────────────────────────────────────────────────── */
.dsu-stripCard{gap:10px}
.dsu-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(124px,1fr));gap:4px 0}
.dsu-stat{display:flex;flex-direction:column;gap:1px;min-width:0;padding:2px 10px}
.dsu-strip .dsu-stat:first-child{padding-left:0}
.dsu-strip .dsu-stat{border-left:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18))}
.dsu-strip .dsu-stat:first-child{border-left:0}
.dsu-statRow{display:flex;flex-wrap:wrap;gap:8px 26px;min-width:0}
.dsu-statLabel{font-size:11px;color:var(--dsw-alias-label-secondary,currentColor);opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsu-statValue{font-size:19px;font-weight:600;line-height:26px;font-variant-numeric:tabular-nums;letter-spacing:.2px;white-space:nowrap}
.dsu-statHint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,currentColor);opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsu-stripFoot{display:flex;flex-direction:column;gap:2px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));padding-top:8px;font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary,currentColor);opacity:.85}
/* ── activity heatmap ────────────────────────────────────────────────────── */
.dsu-heatCard{gap:10px}
.dsu-heatBody{display:flex;align-items:stretch;gap:6px;min-width:0}
.dsu-heatRail{display:grid;grid-template-rows:repeat(7,1fr);gap:3px;padding-top:16px;flex:none}
.dsu-heatRailCell{display:flex;align-items:center;justify-content:flex-end;width:12px;font-size:9px;line-height:1;color:var(--dsw-alias-label-secondary,currentColor);opacity:.7}
.dsu-heatPlot{position:relative;display:flex;flex-direction:column;gap:3px;flex:1 1 auto;min-width:0}
.dsu-heatMonths{display:grid;gap:3px;height:13px}
.dsu-heatMonth{font-size:10px;line-height:13px;white-space:nowrap;color:var(--dsw-alias-label-secondary,currentColor);opacity:.75}
.dsu-heatGrid{display:grid;grid-template-rows:repeat(7,auto);align-content:start;gap:3px}
.dsu-heatGridWeek{grid-template-rows:auto}
.dsu-cell{box-sizing:border-box;width:100%;height:auto;aspect-ratio:1/1;align-self:start;padding:0;border:0;border-radius:3px;font:inherit;background:transparent;cursor:pointer}
.dsu-cell:hover{filter:brightness(1.12)}
.dsu-cell:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3b6ef5);outline-offset:1px}
.dsu-cellL0{background:transparent;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1,rgba(128,128,128,.28))}
/* The only hard-coded colours in this sheet: a heat scale has to be a scale, and
   the theme tokens carry one shade each. Three blues and three greens, from
   "barely there" to "saturated", both readable on light and dark cards. */
.dsu-cellTotal.dsu-cellL1{background:rgba(59,110,245,.22)}
.dsu-cellTotal.dsu-cellL2{background:rgba(59,110,245,.42)}
.dsu-cellTotal.dsu-cellL3{background:rgba(59,110,245,.64)}
.dsu-cellTotal.dsu-cellL4{background:rgba(59,110,245,.88)}
.dsu-cellCache.dsu-cellL1{background:rgba(35,148,74,.22)}
.dsu-cellCache.dsu-cellL2{background:rgba(35,148,74,.42)}
.dsu-cellCache.dsu-cellL3{background:rgba(35,148,74,.64)}
.dsu-cellCache.dsu-cellL4{background:rgba(35,148,74,.88)}
.dsu-cellToday{box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary,#3b6ef5)}
.dsu-cellSelected{outline:2px solid var(--dsw-alias-brand-primary,#3b6ef5);outline-offset:1px}
.dsu-cellFuture{opacity:.3;cursor:default;pointer-events:none}
.dsu-heatFoot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));padding-top:8px}
.dsu-heatFootLeft{display:flex;flex-wrap:wrap;align-items:center;gap:12px;min-width:0}
.dsu-heatNav{display:flex;align-items:center;gap:6px;flex:none}
.dsu-range{font-size:11px;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,currentColor);opacity:.9}
.dsu-heatTotal{border-top:0}
.dsu-seg{display:inline-flex;gap:2px;padding:2px;border-radius:9px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.10))}
.dsu-segBtn{box-sizing:border-box;height:22px;padding:0 10px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,currentColor);font:inherit;font-size:11px;line-height:22px;cursor:pointer}
.dsu-segBtn:hover{color:var(--dsw-alias-label-primary,currentColor)}
/* Ring, not just a fill: the card and a raised layer are the same token on some
   themes, so the selected segment needs a border to read as selected at all. */
.dsu-segOn{background:var(--dsw-alias-bg-layer-2,transparent);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2,rgba(128,128,128,.38));color:var(--dsw-alias-label-primary,currentColor);font-weight:600}
/* ── hover read-out ─────────────────────────────────────────────────────── */
.dsu-tip{position:absolute;z-index:30;transform:translateY(-100%);box-sizing:border-box;width:236px;padding:9px 11px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:0 12px 28px rgba(0,0,0,.22);pointer-events:none;display:flex;flex-direction:column;gap:4px;color:var(--dsw-alias-label-primary,currentColor)}
.dsu-tipBelow{transform:none}
.dsu-tipTitle{font-size:11px;font-weight:600;line-height:15px}
.dsu-tipBadge{align-self:flex-start;padding:0 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));font-size:10px;line-height:15px;color:var(--dsw-alias-label-secondary,currentColor)}
.dsu-tipBody{display:flex;flex-direction:column;gap:2px}
.dsu-tipRow{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-size:12px;line-height:18px}
.dsu-tipRow b{font-weight:600;font-variant-numeric:tabular-nums}
.dsu-tipFoot{margin:4px 0 0;font-size:10px;line-height:15px;color:var(--dsw-alias-label-secondary,currentColor);opacity:.85}
.dsu-tipEmpty{margin:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,currentColor)}
.dsu-legend{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--dsw-alias-label-secondary,currentColor);opacity:.9}
.dsu-swatch{display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.1))}
.dsu-swatchTotal.dsu-swatchL1{background:rgba(59,110,245,.22)}
.dsu-swatchTotal.dsu-swatchL2{background:rgba(59,110,245,.42)}
.dsu-swatchTotal.dsu-swatchL3{background:rgba(59,110,245,.64)}
.dsu-swatchTotal.dsu-swatchL4{background:rgba(59,110,245,.88)}
.dsu-swatchCache.dsu-swatchL1{background:rgba(35,148,74,.22)}
.dsu-swatchCache.dsu-swatchL2{background:rgba(35,148,74,.42)}
.dsu-swatchCache.dsu-swatchL3{background:rgba(35,148,74,.64)}
.dsu-swatchCache.dsu-swatchL4{background:rgba(35,148,74,.88)}
/* ── selected stretch ───────────────────────────────────────────────────── */
.dsu-detailBody{display:flex;flex-wrap:wrap;align-items:flex-start;gap:12px 26px}
/* ── provider quotas ────────────────────────────────────────────────────── */
.dsu-providerGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(258px,1fr));gap:12px;align-items:start}
.dsu-bar{width:100%;height:6px;border-radius:999px;background:var(--dsw-alias-border-l1,rgba(128,128,128,.22));overflow:hidden}
.dsu-barFill{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary,#3b6ef5);opacity:.85}
.dsu-barOver{background:var(--dsw-alias-state-error-primary,#e5534b);opacity:.95}
.dsu-window{display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16));padding-top:7px}
.dsu-window:first-of-type{border-top:0;padding-top:0}
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

    /**
     * Pure helpers, exposed for `test/selfcheck.mjs` only — not a public API.
     *
     * These are the parts of the panel that fail silently: a heatmap stuck in one
     * shade still renders, a week fold that sums the wrong seven days still
     * prints digits. Asserting them directly is the only cheap way to notice.
     */
    exports.__internals = {
      Activity,
      SelectionDetail,
      StatStrip,
      addDays,
      aggregateBuckets,
      dateKey,
      dayColumns,
      isoWeek,
      levelOf,
      metricOf,
      monthTicks,
      streaks,
      thresholdsOf,
      weekColumns,
      weekKeyOf,
      windowRange,
    }

    return module.exports
  },
})
