/**
 * 用量 (Usage) — host half.
 *
 * Three authenticated read-only routes on the connection's shared `/api`
 * channel, all answered as HTTP 200 with an `ok` discriminator so a provider
 * failure can never be mistaken for the channel's own session authentication:
 *
 *   GET /api/usage/usage    — token usage folds alone (local, milliseconds).
 *   GET /api/usage/quota    — provider quota snapshot alone (remote, seconds).
 *   GET /api/usage/report   — both, for a single-call consumer.
 *
 * The split exists because the two halves have wildly different costs: folding
 * this machine's session logs measures in tens of milliseconds, while one
 * provider round trip measures in seconds. The panel therefore never waits for
 * the network to show the numbers it already has, and a stale quota answer is
 * served immediately and revalidated in the background.
 *
 * Everything privileged stays on this side: session logs are read through the
 * Host's own `sessionPersistence` service (never by re-implementing the
 * compressed on-disk format), and provider API keys are resolved from the
 * harness credential store and never cross to the browser — only the upstream
 * response bodies do.
 *
 * Token accounting mirrors `@deepseek-ai/dsh-token-meter`: a billed attempt's
 * `inputTokens` is its UNCACHED prompt, so the total is
 * `input + cacheRead + cacheWrite + output`.
 *
 * @module @local/dsh-usage
 */

/** Cordis plugin name. */
export const name = 'dsh-usage'

/**
 * The connection service owns the `/api` channel these routes register on, so
 * trust checks and browser-session authentication are applied by that channel
 * before any handler here runs.
 */
export const inject = ['connection']

/**
 * Upstream deadline for one provider attempt.
 *
 * This machine's path to api.commandcode.ai is normally 230-900 ms, but it was
 * measured at 10.5 s (a connect timeout) and 9.4 s in the same afternoon — both
 * past the 8 s this used to allow, which is what turned the card into 读取失败.
 * The panel is off the critical path (it paints from cache and revalidates
 * behind the response), so a longer deadline costs the reader nothing.
 */
const UPSTREAM_TIMEOUT_MS = 20_000

/** Attempts per provider read: a timeout or a dropped socket gets one retry. */
const UPSTREAM_ATTEMPTS = 2

/** How long a folded usage answer is reused before the session logs are re-read. */
const USAGE_TTL_MS = 15_000

/**
 * How long a provider quota answer is served without revalidating.
 *
 * Quota numbers are minute-scale facts while a provider round trip from this
 * machine measures in seconds, so a cached answer is always preferred and
 * refreshed in the background rather than waited on.
 */
const QUOTA_FRESH_MS = 90_000

/** Background revalidation cadence, which keeps the panel warm after boot. */
const QUOTA_BACKGROUND_MS = 5 * 60_000

/** Delay before the activation warm-up runs, so it never competes with boot. */
const WARMUP_DELAY_MS = 2_500

/** Session-log events read per page while folding one session. */
const READ_PAGE = 512

/** Hard stop on one session's fold, so a pathological log cannot stall a request. */
const MAX_EVENTS_PER_SESSION = 400_000

/** Kimi for Coding (managed) usage endpoint — the one its own CLI reads. */
const KIMI_USAGE_URL = 'https://api.kimi.com/coding/v1/usages'

/** Command Code public API origin. */
const COMMANDCODE_BASE = 'https://api.commandcode.ai'

/**
 * OpenCode Go usage endpoint — the one its own web console reads.
 *
 * The plan meters every model in dollars against that model's own monthly
 * limit, so the ratio the endpoint reports is account-wide; the three windows
 * it returns (the rolling 5-hour one, the weekly one and the billing month)
 * are the ones shown as 额度.
 */
const OPENCODE_GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'

/** Credential references resolved from the harness credential store. */
const KIMI_KEY_REF = 'KIMI_CODING_API_KEY'
const COMMANDCODE_KEY_REF = 'COMMANDCODE_API_KEY'
const OPENCODE_GO_KEY_REF = 'OPENCODEGO_API_KEY'

/** Monthly credit allowance per Command Code plan id (public pricing table). */
const COMMANDCODE_PLAN_TOTALS = {
  'individual-go': 10,
  'individual-goat': 70,
  'individual-pro': 30,
  'individual-pro-v1': 80,
  'individual-provider': 15,
  'individual-max': 150,
  'individual-ultra': 300,
  'teams-pro': 40,
}

/** Display name per Command Code plan id. */
const COMMANDCODE_PLAN_LABELS = {
  'individual-go': 'Go',
  'individual-goat': 'GOAT',
  'individual-pro': 'Pro',
  'individual-pro-v1': 'Pro',
  'individual-provider': 'Provider',
  'individual-max': 'Max',
  'individual-ultra': 'Ultra',
  'teams-pro': 'Teams Pro',
}

// ---------------------------------------------------------------------------
// Usage folding
// ---------------------------------------------------------------------------

/**
 * Folded per-day usage for one session, keyed by local date.
 *
 * @typedef {object} DayBucket
 * @property {string} date            local `YYYY-MM-DD`
 * @property {number} input           uncached prompt tokens
 * @property {number} output          completion tokens
 * @property {number} cacheRead       cache-hit (cache read) tokens
 * @property {number} cacheWrite      cache write tokens
 * @property {number} total           input + cacheRead + cacheWrite + output
 * @property {number} requests        billed attempts observed
 * @property {Record<string, DayBucket>} providers per-provider split
 */

/**
 * One session's fold, plus the log position it has consumed.
 *
 * `offset` is what makes the fold incremental: events are contiguous from seq 0
 * and are never rewritten, so a log that changed can be advanced from where the
 * last fold stopped instead of being re-read in full. The revision is an opaque
 * per-process change token, so an equal revision means "nothing to do".
 *
 * @typedef {object} SessionFold
 * @property {unknown} revision
 * @property {number} offset next unread seq
 * @property {Map<string, DayBucket>} days
 */

/**
 * Session-id keyed fold cache.
 *
 * @type {Map<string, SessionFold>}
 */
const folds = new Map()

/** Last folded usage report and the instant it was produced. */
let usageCache = { at: 0, value: undefined }

/** Last provider quota snapshot, the instant it was produced, and its in-flight revalidation. */
let quotaCache = { at: 0, value: undefined, inFlight: undefined }

/**
 * @param {unknown} value
 * @returns {number} a finite non-negative integer, or 0.
 */
function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/**
 * The local calendar date of an instant, as `YYYY-MM-DD`.
 *
 * Usage is bucketed in the operator's own timezone, which is what a calendar
 * view of "今天" has to mean.
 *
 * @param {number} epochMs
 * @returns {string}
 */
function localDateKey(epochMs) {
  const at = new Date(typeof epochMs === 'number' && Number.isFinite(epochMs) ? epochMs : Date.now())
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${String(at.getFullYear())}-${month}-${day}`
}

/**
 * @param {string} date
 * @returns {DayBucket}
 */
function emptyBucket(date) {
  return {
    date,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    requests: 0,
    providers: {},
  }
}

/**
 * Add one billed attempt into a bucket, in place.
 *
 * @param {DayBucket} bucket
 * @param {import('@deepseek-ai/dsh-session').TokenUsage} usage
 * @param {string} provider
 */
function addUsage(bucket, usage, provider) {
  const input = count(usage.inputTokens)
  const output = count(usage.outputTokens)
  const cacheRead = count(usage.cacheReadTokens)
  const cacheWrite = count(usage.cacheWriteTokens)
  const total = input + cacheRead + cacheWrite + output
  bucket.input += input
  bucket.output += output
  bucket.cacheRead += cacheRead
  bucket.cacheWrite += cacheWrite
  bucket.total += total
  bucket.requests += 1
  const key = provider === '' ? 'unknown' : provider
  const child = bucket.providers[key] ?? emptyBucket(bucket.date)
  child.input += input
  child.output += output
  child.cacheRead += cacheRead
  child.cacheWrite += cacheWrite
  child.total += total
  child.requests += 1
  bucket.providers[key] = child
}

/**
 * Advance one stored session's fold.
 *
 * When `previous` is given the read resumes at the seq that fold stopped on and
 * merges into its day map, so a log that merely grew costs one tail read instead
 * of a full re-read. `snapshot.eventCount`, when the backend reports it, is the
 * cheap guard against resuming past a log whose length went down (which the
 * append-only contract says cannot happen, but a truncated physical tail could
 * look like).
 *
 * @param {any} persistence the sessionPersistence service.
 * @param {string} id stored session id.
 * @param {SessionFold|undefined} previous the fold to advance, when resuming.
 * @param {number|undefined} eventCount the snapshot's own event count, when known.
 * @returns {Promise<SessionFold>}
 */
async function foldSession(persistence, id, previous, eventCount) {
  const stale = typeof eventCount === 'number' && previous !== undefined && eventCount < previous.offset
  const resume = previous !== undefined && previous.offset > 0 && !stale
  const days = resume ? previous.days : new Map()
  let offset = resume ? previous.offset : 0
  const handle = await persistence.open(id, 'read')
  try {
    while (offset < MAX_EVENTS_PER_SESSION) {
      const page = await handle.read(offset, READ_PAGE)
      const events = Array.isArray(page?.events) ? page.events : []
      if (events.length === 0) break
      for (const event of events) {
        if (event?.type !== 'assistant/message') continue
        const usage = event?.data?.usage
        if (usage === undefined || usage === null) continue
        const date = localDateKey(event.time)
        const bucket = days.get(date) ?? emptyBucket(date)
        addUsage(bucket, usage, String(event?.data?.message?.source?.provider ?? ''))
        days.set(date, bucket)
      }
      const last = events[events.length - 1]
      const next = typeof last?.seq === 'number' ? last.seq + 1 : offset + events.length
      if (next <= offset) break
      // Advance first, then stop: the recorded offset is always the next unread
      // seq, which is what a later incremental read resumes from.
      offset = next
      if (events.length < READ_PAGE) break
    }
  } finally {
    await handle.close()
  }
  return { revision: undefined, offset, days }
}

/**
 * Merge one fold's days into the running totals.
 *
 * @param {Map<string, DayBucket>} into
 * @param {Map<string, DayBucket>} from
 */
function mergeDays(into, from) {
  for (const [date, bucket] of from) {
    const target = into.get(date) ?? emptyBucket(date)
    target.input += bucket.input
    target.output += bucket.output
    target.cacheRead += bucket.cacheRead
    target.cacheWrite += bucket.cacheWrite
    target.total += bucket.total
    target.requests += bucket.requests
    for (const [provider, child] of Object.entries(bucket.providers)) {
      const existing = target.providers[provider] ?? emptyBucket(date)
      existing.input += child.input
      existing.output += child.output
      existing.cacheRead += child.cacheRead
      existing.cacheWrite += child.cacheWrite
      existing.total += child.total
      existing.requests += child.requests
      target.providers[provider] = existing
    }
    into.set(date, target)
  }
}

/**
 * Fold every stored session visible to this Host into per-day buckets.
 *
 * Only sessions whose change token moved are touched, and those are advanced
 * from where their previous fold stopped rather than re-read.
 *
 * @param {any} persistence
 * @returns {Promise<{ days: DayBucket[], today: DayBucket, totals: DayBucket, scan: object }>}
 */
async function collectUsage(persistence) {
  const startedAt = Date.now()
  const warnings = []
  let snapshots = []
  try {
    snapshots = await persistence.list()
  } catch (error) {
    warnings.push(`list failed: ${String(error?.message ?? error)}`)
  }
  const live = new Set()
  let rescanned = 0
  for (const snapshot of snapshots) {
    const id = String(snapshot?.header?.id ?? '')
    if (id === '') continue
    live.add(id)
    const cached = folds.get(id)
    if (cached !== undefined && cached.revision === snapshot.revision) continue
    rescanned += 1
    try {
      const advanced = await foldSession(persistence, id, cached, snapshot.eventCount)
      folds.set(id, { ...advanced, revision: snapshot.revision })
    } catch (error) {
      warnings.push(`${id}: ${String(error?.message ?? error)}`)
      // Keep whatever was folded before rather than dropping the session.
      if (cached === undefined) folds.set(id, { revision: snapshot.revision, offset: 0, days: new Map() })
    }
  }
  for (const id of [...folds.keys()]) if (!live.has(id)) folds.delete(id)

  const merged = new Map()
  for (const entry of folds.values()) mergeDays(merged, entry.days)

  const days = [...merged.values()].sort((left, right) => (left.date < right.date ? -1 : 1))
  const today = merged.get(localDateKey(Date.now())) ?? emptyBucket(localDateKey(Date.now()))
  const totals = emptyBucket('total')
  for (const bucket of days) {
    totals.input += bucket.input
    totals.output += bucket.output
    totals.cacheRead += bucket.cacheRead
    totals.cacheWrite += bucket.cacheWrite
    totals.total += bucket.total
    totals.requests += bucket.requests
    for (const [provider, child] of Object.entries(bucket.providers)) {
      const existing = totals.providers[provider] ?? emptyBucket('total')
      existing.input += child.input
      existing.output += child.output
      existing.cacheRead += child.cacheRead
      existing.cacheWrite += child.cacheWrite
      existing.total += child.total
      existing.requests += child.requests
      totals.providers[provider] = existing
    }
  }
  return {
    days,
    today,
    totals,
    scan: {
      sessions: folds.size,
      rescanned,
      tookMs: Date.now() - startedAt,
      firstDay: days.length > 0 ? days[0].date : undefined,
      lastDay: days.length > 0 ? days[days.length - 1].date : undefined,
      warnings,
    },
  }
}

// ---------------------------------------------------------------------------
// Provider quotas
// ---------------------------------------------------------------------------

/**
 * Read one API key from the harness credential store.
 *
 * Resolution runs per request, so a key saved through the GUI or written into
 * `~/.dsh/.credentials.yaml` takes effect without a restart.
 *
 * @param {any} ctx host plugin context.
 * @param {string} ref credential reference.
 * @returns {Promise<string|undefined>}
 */
async function resolveKey(ctx, ref) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) return undefined
  try {
    const resolved = await credentials.resolve(ref)
    const value = resolved?.value
    return typeof value === 'string' && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * One authenticated JSON GET against a provider API.
 *
 * @param {string} url
 * @param {string} key
 * @param {AbortSignal} signal
 * @returns {Promise<{ ok: true, body: any } | { ok: false, code: string, message: string }>}
 */
async function getJson(url, key, signal) {
  let response
  try {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal,
    })
  } catch (error) {
    const name = error?.name
    if (name === 'AbortError' || name === 'TimeoutError') {
      return { ok: false, code: 'TIMEOUT', message: '提供方未在时限内应答。' }
    }
    return { ok: false, code: 'NETWORK', message: String(error?.message ?? error) }
  }
  const text = await response.text().catch(() => '')
  let body
  try {
    body = text === '' ? undefined : JSON.parse(text)
  } catch {
    body = undefined
  }
  if (!response.ok) {
    const detail = body?.error?.message ?? body?.message ?? text.slice(0, 200)
    const code =
      response.status === 401 || response.status === 403
        ? 'AUTH'
        : response.status === 429
          ? 'RATE_LIMIT'
          : response.status >= 500
            ? 'SERVER'
            : 'UPSTREAM'
    return { ok: false, code, message: `HTTP ${String(response.status)} ${String(detail)}`.trim() }
  }
  if (body === undefined) return { ok: false, code: 'UPSTREAM', message: '提供方返回了非 JSON 响应。' }
  return { ok: true, body }
}

/**
 * @param {unknown} value
 * @returns {number|undefined}
 */
function finite(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/**
 * The spent share of a metered window, as a 0-1 ratio.
 *
 * Command Code meters its windows in money, but the balance it reports is not
 * comparable across models: each model is capped at its own dollar figure, so
 * the same "US$48 left" buys a different amount of work per model, and the
 * window caps the API returns are account-wide sums of those per-model limits.
 * The share already spent is the invariant, so that is what gets reported.
 *
 * @param {unknown} used
 * @param {unknown} cap
 * @returns {number|undefined} 0-1, or undefined when no ratio is derivable.
 */
function share(used, cap) {
  if (used === undefined || cap === undefined || cap <= 0) return undefined
  return Math.max(0, used / cap)
}

/**
 * @param {unknown} value an ISO timestamp.
 * @returns {number|undefined} epoch milliseconds.
 */
function instant(value) {
  if (typeof value !== 'string' || value === '') return undefined
  const at = Date.parse(value)
  return Number.isNaN(at) ? undefined : at
}

/**
 * Map a Kimi `TIME_UNIT_*` window onto a label.
 *
 * @param {any} window
 * @returns {{ id: string, label: string }}
 */
function kimiWindowLabel(window) {
  const duration = finite(window?.duration) ?? 0
  const unit = String(window?.timeUnit ?? '')
  if (unit === 'TIME_UNIT_MINUTE') {
    if (duration === 300) return { id: '5h', label: '五小时窗口' }
    if (duration === 10080) return { id: '7d', label: '每周窗口' }
    if (duration <= 60) return { id: `m${String(duration)}`, label: `${String(duration)} 分钟窗口` }
    return { id: `m${String(duration)}`, label: `${String(Math.round(duration / 60))} 小时窗口` }
  }
  if (unit === 'TIME_UNIT_HOUR') return { id: `h${String(duration)}`, label: `${String(duration)} 小时窗口` }
  if (unit === 'TIME_UNIT_DAY') return { id: `d${String(duration)}`, label: `${String(duration)} 天窗口` }
  return { id: 'window', label: '额度窗口' }
}

/**
 * Parse the Kimi for Coding `/usages` payload.
 *
 * The `usages.limit_*` block is what the vendor CLI's own `/usage` meters read;
 * the sibling `limits[]` array is only a fallback for a plan that reports no
 * ratio entry.
 *
 * @param {any} body
 * @returns {{ windows: any[], extras: any[] }}
 */
function parseKimiUsage(body) {
  const usages = body?.usages ?? {}
  const windows = []
  /**
   * @param {string} key
   * @param {string} id
   * @param {string} label
   * @param {string} [note]
   */
  const ratioWindow = (key, id, label, note) => {
    const entry = usages[key]
    const used = finite(entry?.used_ratio)
    if (used === undefined) return
    windows.push({
      id,
      label,
      note,
      unit: 'percent',
      used,
      cap: 1,
      resetAt: instant(entry?.reset_time),
    })
  }
  ratioWindow('limit_5h', '5h', '五小时窗口')
  ratioWindow('limit_7d', '7d', '每周窗口')
  // The monthly code allowance is a per-model slice of the monthly total, and
  // the two report the same ratio on a plan that spends them together: shown
  // twice it reads as two different limits, so it is kept only when it differs.
  ratioWindow('limit_month_code', 'monthCode', '月度 Code 额度', '按模型分档')
  ratioWindow('limit_month_total', 'monthTotal', '总额度（本计费周期）')
  const codeWindow = windows.find((entry) => entry.id === 'monthCode')
  const totalWindow = windows.find((entry) => entry.id === 'monthTotal')
  if (codeWindow !== undefined && totalWindow !== undefined && codeWindow.used === totalWindow.used) {
    windows.splice(windows.indexOf(codeWindow), 1)
  }

  if (windows.length === 0 && Array.isArray(body?.limits)) {
    for (const entry of body.limits) {
      const { id, label } = kimiWindowLabel(entry?.window)
      const cap = finite(entry?.detail?.limit)
      const remaining = finite(entry?.detail?.remaining)
      if (cap === undefined || remaining === undefined) continue
      windows.push({
        id,
        label,
        note: '剩余请求数',
        unit: 'count',
        used: Math.max(0, cap - remaining),
        cap,
        resetAt: instant(entry?.detail?.resetTime),
      })
    }
  }

  const extras = []
  const wallet = body?.booster_wallet
  const balance = finite(wallet?.balance?.amountLeft) ?? finite(wallet?.balance?.amount)
  if (wallet !== undefined && balance !== undefined) {
    extras.push({ label: '加量包余额', value: balance / 100, unit: 'money' })
  }
  return { windows, extras }
}

/**
 * Parse the Command Code billing + subscription + usage-summary payloads.
 *
 * @param {any} credits `/alpha/billing/credits`
 * @param {any} subscription `/alpha/billing/subscriptions`
 * @param {any} summary `/alpha/usage/summary`
 * @returns {{ windows: any[], extras: any[], plan: string|undefined, planName: string|undefined }}
 */
function parseCommandCode(credits, subscription, summary) {
  const limits = credits?.windowLimits ?? {}
  const windows = []
  /**
   * @param {any} entry
   * @param {string} id
   * @param {string} label
   */
  const window = (entry, id, label) => {
    const used = finite(entry?.used)
    const cap = finite(entry?.cap)
    const spent = share(used, cap)
    if (spent === undefined) return
    windows.push({
      id,
      label,
      unit: 'percent',
      used: spent,
      cap: 1,
      resetAt: finite(entry?.resetAt),
      exceeded: entry?.exceeded === true,
    })
  }
  window(limits.fiveHour, '5h', '五小时窗口')
  window(limits.weekly, '7d', '每周窗口')

  const planId = typeof subscription?.planId === 'string' ? subscription.planId : undefined
  const planCap = planId === undefined ? undefined : COMMANDCODE_PLAN_TOTALS[planId]
  const periodUsed = finite(summary?.totalMonthlyCredits)
  const remaining = finite(credits?.credits?.monthlyCredits)
  // The plan's own allowance is whatever has been spent plus whatever is left of
  // it, which holds for every plan and needs no price table; the published total
  // is only a fallback for a payload that withholds the remaining figure.
  const allowance =
    periodUsed !== undefined && remaining !== undefined ? periodUsed + remaining : planCap
  const spent = periodUsed ?? (allowance === undefined || remaining === undefined ? undefined : allowance - remaining)
  const spentShare = share(spent, allowance)
  if (spentShare !== undefined) {
    windows.push({
      id: 'monthTotal',
      label: '总额度（本计费周期）',
      unit: 'percent',
      used: spentShare,
      cap: 1,
      resetAt: instant(subscription?.currentPeriodEnd),
      exceeded: credits?.credits?.belowThreshold === true && remaining === 0,
    })
  }

  const extras = []
  const leftShare = share(remaining, allowance)
  if (leftShare !== undefined) extras.push({ label: '本周期剩余', value: leftShare, unit: 'percent' })
  const purchased = finite(credits?.credits?.purchasedCredits)
  if (purchased !== undefined) {
    const purchasedShare = share(purchased, allowance)
    if (purchasedShare !== undefined) extras.push({ label: '加量额度', value: purchasedShare, unit: 'percent' })
  }
  if (finite(summary?.totalTokensIn) !== undefined) {
    extras.push({ label: '输入 token', value: finite(summary.totalTokensIn), unit: 'tokens' })
  }
  if (finite(summary?.totalTokensOut) !== undefined) {
    extras.push({ label: '输出 token', value: finite(summary.totalTokensOut), unit: 'tokens' })
  }
  if (finite(summary?.totalCount) !== undefined) {
    extras.push({ label: '请求数', value: finite(summary.totalCount), unit: 'count' })
  }

  return {
    windows,
    extras,
    plan: planId,
    planName: planId === undefined ? undefined : (COMMANDCODE_PLAN_LABELS[planId] ?? planId),
  }
}

/**
 * Parse the OpenCode Go `/zen/go/v1/usage` payload.
 *
 * The answer is `usage.{rolling,weekly,monthly}`, each a window with the share
 * already spent (`percent`, 0-100) and an ISO `resetsAt`. The plan's own split
 * is five-hour = 20% of the monthly limit, weekly = 50%, monthly = 100%, so the
 * ids here line up with the cards beside it and the reported shares are used
 * as they come.
 *
 * @param {any} body `/zen/go/v1/usage`
 * @returns {{ windows: any[], plan: string|undefined }}
 */
function parseOpenCodeGo(body) {
  const usage = body?.usage ?? {}
  /** @param {string} key @param {string} id @param {string} label */
  const window = (key, id, label) => {
    const entry = usage[key]
    if (entry === undefined || entry === null) return
    const percent = finite(entry?.percent)
    if (percent === undefined) return
    // `status` is "ok" on a healthy window; a non-ok status means the window is
    // at its limit, which is the state the commandcode card calls `exceeded`.
    const status = typeof entry?.status === 'string' ? entry.status : 'ok'
    return {
      id,
      label,
      unit: 'percent',
      used: share(percent, 100),
      cap: 1,
      resetAt: instant(entry?.resetsAt),
      exceeded: status !== 'ok',
    }
  }
  const windows = [
    window('rolling', '5h', '五小时窗口'),
    window('weekly', '7d', '每周窗口'),
    window('monthly', 'monthTotal', '总额度（本计费周期）'),
  ].filter((entry) => entry !== undefined)
  return { windows, plan: undefined }
}

/**
 * One provider read, retried once when the attempt timed out or the socket died.
 *
 * Each attempt gets its own deadline: sharing one signal would spend the second
 * attempt on an already-expired signal. Every read here is a plain GET (or a
 * body-less POST), so repeating one cannot double-count anything.
 *
 * @param {() => Promise<any>} read
 * @returns {Promise<any>}
 */
async function readWithRetry(read) {
  let result
  for (let attempt = 1; attempt <= UPSTREAM_ATTEMPTS; attempt += 1) {
    result = await read()
    if (result === undefined || result.ok === true) break
    if (result.code !== 'TIMEOUT' && result.code !== 'NETWORK') break
  }
  return result
}

/**
 * One authenticated read with a fresh deadline per attempt.
 *
 * @param {string} url
 * @param {string} key
 * @returns {Promise<any>}
 */
function readJson(url, key) {
  return readWithRetry(() => getJson(url, key, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)))
}

/**
 * Ask every provider, all in flight at once.
 *
 * The calls used to be two serialized groups (kimi, then command code's three),
 * which on this machine meant paying the provider round-trip latency twice —
 * measured at 8s cold for one panel open. One `Promise.all` over all five
 * requests pays it once, and the three command-code reads of one account share
 * that single round trip.
 *
 * @param {any} ctx
 * @returns {Promise<{ providers: any[], fetchedAt: number, durationMs: number }>}
 */
async function fetchQuota(ctx) {
  const startedAt = Date.now()
  const [kimiKey, commandCodeKey, openCodeGoKey] = await Promise.all([
    resolveKey(ctx, KIMI_KEY_REF),
    resolveKey(ctx, COMMANDCODE_KEY_REF),
    resolveKey(ctx, OPENCODE_GO_KEY_REF),
  ])
  const [kimiResult, credits, subscription, summary, openCodeGoResult] = await Promise.all([
    kimiKey === undefined ? undefined : readJson(KIMI_USAGE_URL, kimiKey),
    commandCodeKey === undefined ? undefined : readJson(`${COMMANDCODE_BASE}/alpha/billing/credits`, commandCodeKey),
    commandCodeKey === undefined ? undefined : readJson(`${COMMANDCODE_BASE}/alpha/billing/subscriptions`, commandCodeKey),
    commandCodeKey === undefined ? undefined : readJson(`${COMMANDCODE_BASE}/alpha/usage/summary`, commandCodeKey),
    openCodeGoKey === undefined ? undefined : readJson(OPENCODE_GO_USAGE_URL, openCodeGoKey),
  ])
  const providers = []

  if (kimiResult === undefined) {
    providers.push({
      id: 'kimi-coding',
      name: 'kimi-coding',
      displayName: 'Kimi for Coding',
      status: 'no-key',
      message: '未在凭据库中找到 KIMI_CODING_API_KEY。',
      windows: [],
      extras: [],
    })
  } else if (kimiResult.ok) {
    const parsed = parseKimiUsage(kimiResult.body)
    providers.push({
      id: 'kimi-coding',
      name: 'kimi-coding',
      displayName: 'Kimi for Coding',
      status: 'ok',
      windows: parsed.windows,
      extras: parsed.extras,
      fetchedAt: Date.now(),
    })
  } else {
    providers.push({
      id: 'kimi-coding',
      name: 'kimi-coding',
      displayName: 'Kimi for Coding',
      status: 'error',
      message: kimiResult.message,
      code: kimiResult.code,
      windows: [],
      extras: [],
    })
  }

  if (credits === undefined) {
    providers.push({
      id: 'commandcode',
      name: 'commandcode',
      displayName: 'Command Code',
      status: 'no-key',
      message: '未在凭据库中找到 COMMANDCODE_API_KEY。',
      windows: [],
      extras: [],
    })
  } else {
    const failed = [credits, subscription, summary].find((entry) => entry !== undefined && !entry.ok)
    if (failed !== undefined && failed.ok === false) {
      providers.push({
        id: 'commandcode',
        name: 'commandcode',
        displayName: 'Command Code',
        status: 'error',
        message: failed.message,
        code: failed.code,
        windows: [],
        extras: [],
      })
    } else {
      const parsed = parseCommandCode(
        credits.ok ? credits.body : undefined,
        subscription?.ok === true ? subscription.body?.data : undefined,
        summary?.ok === true ? summary.body : undefined,
      )
      providers.push({
        id: 'commandcode',
        name: 'commandcode',
        displayName: 'Command Code',
        status: 'ok',
        plan: parsed.plan,
        planName: parsed.planName,
        windows: parsed.windows,
        extras: parsed.extras,
        fetchedAt: Date.now(),
      })
    }
  }

  if (openCodeGoResult === undefined) {
    providers.push({
      id: 'opencode-go',
      name: 'opencode-go',
      displayName: 'OpenCode Go',
      status: 'no-key',
      message: '未在凭据库中找到 OPENCODEGO_API_KEY。',
      windows: [],
      extras: [],
    })
  } else if (openCodeGoResult.ok) {
    const parsed = parseOpenCodeGo(openCodeGoResult.body)
    providers.push({
      id: 'opencode-go',
      name: 'opencode-go',
      displayName: 'OpenCode Go',
      status: 'ok',
      windows: parsed.windows,
      extras: [],
      fetchedAt: Date.now(),
    })
  } else {
    providers.push({
      id: 'opencode-go',
      name: 'opencode-go',
      displayName: 'OpenCode Go',
      status: 'error',
      message: openCodeGoResult.message,
      code: openCodeGoResult.code,
      windows: [],
      extras: [],
    })
  }

  // A provider blip must not blank a card that already has numbers in it. When a
  // read fails and the previous round had a good answer, the last good windows are
  // kept and labelled `stale`, with this round's failure message alongside them,
  // so the reader sees "slightly old numbers, and why" instead of an empty card.
  // Configuration states (no key, wrong key) are deliberately not carried over.
  const previous = quotaCache.value?.providers ?? []
  for (const [index, provider] of providers.entries()) {
    if (provider.status !== 'error') continue
    const before = previous.find((entry) => entry.id === provider.id)
    if (before === undefined || before.status !== 'ok') continue
    providers[index] = { ...before, stale: true, message: provider.message, code: provider.code }
  }

  return { providers, fetchedAt: Date.now(), durationMs: Date.now() - startedAt }
}

/**
 * Start (or join) one background revalidation.
 *
 * @param {any} ctx
 * @returns {Promise<any>|undefined} the in-flight promise, for a waiting caller.
 */
function revalidateQuota(ctx) {
  if (quotaCache.inFlight !== undefined) return quotaCache.inFlight
  const pending = fetchQuota(ctx)
    .then((value) => {
      quotaCache = { at: Date.now(), value, inFlight: undefined }
      return value
    })
    .catch(() => {
      quotaCache = { ...quotaCache, inFlight: undefined }
      return quotaCache.value
    })
  quotaCache = { ...quotaCache, inFlight: pending }
  return pending
}

/**
 * The provider quota snapshot.
 *
 * The contract is "answer now": a cached snapshot is always returned as-is
 * (`refreshing` says whether a fresh one is on the way), and only a caller that
 * asks to wait pays the provider round trip. That is what keeps a panel open
 * instant once anything has been fetched — including right after boot, because
 * activation warms this cache.
 *
 * @param {any} ctx
 * @param {{ force?: boolean, wait?: boolean }} [options]
 *   `force` ignores freshness, `wait` blocks until the providers answer.
 * @returns {Promise<{ providers: any[], fetchedAt: number, durationMs?: number, refreshing: boolean }>}
 */
async function collectQuota(ctx, options = {}) {
  const age = Date.now() - quotaCache.at
  const fresh = quotaCache.value !== undefined && age < QUOTA_FRESH_MS
  if (!options.force && fresh) return { ...quotaCache.value, refreshing: false }
  if (quotaCache.value === undefined || options.wait === true) {
    // Nothing to show yet, or the caller asked to wait: pay the round trip.
    const pending = revalidateQuota(ctx)
    if (pending !== undefined) await pending
    const value = quotaCache.value ?? { providers: [], fetchedAt: Date.now(), durationMs: 0 }
    return { ...value, refreshing: quotaCache.inFlight !== undefined }
  }
  // Stale but usable: hand back what we have and refresh behind the response.
  revalidateQuota(ctx)
  return { ...quotaCache.value, refreshing: true }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * @param {unknown} payload
 * @param {number} [status]
 * @returns {Response}
 */
function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Fold usage, reusing the last answer for a short window unless forced.
 *
 * @param {any} ctx
 * @param {boolean} force
 * @returns {Promise<any>}
 */
async function usageReport(ctx, force) {
  if (!force && usageCache.value !== undefined && Date.now() - usageCache.at < USAGE_TTL_MS) {
    return usageCache.value
  }
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) {
    const unavailable = {
      available: false,
      today: emptyBucket(localDateKey(Date.now())),
      totals: emptyBucket('total'),
      days: [],
      scan: { sessions: 0, rescanned: 0, tookMs: 0, warnings: ['本组合未挂载 sessionPersistence。'] },
    }
    return unavailable
  }
  const folded = await collectUsage(persistence)
  const value = { available: true, ...folded }
  usageCache = { at: Date.now(), value }
  return value
}

/**
 * Handler for `GET /api/usage/report`.
 *
 * Kept as the one-call shape for an external consumer: it blocks for a provider
 * round trip when asked to force, and otherwise answers from cache while the
 * providers are revalidated behind the response. The panel itself uses the two
 * split routes so its local half never waits on the remote one.
 *
 * @param {any} ctx
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function handleReport(ctx, request) {
  const force = request.headers.get('x-usage-force') === '1'
  try {
    const usage = await usageReport(ctx, force)
    const quota = await collectQuota(ctx, { force, wait: force })
    return json({
      ok: true,
      generatedAt: Date.now(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      usage,
      quota,
    })
  } catch (error) {
    return json({ ok: false, code: 'INTERNAL', message: String(error?.message ?? error) })
  }
}

/**
 * Handler for `GET /api/usage/usage` — the local half.
 *
 * @param {any} ctx
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function handleUsage(ctx, request) {
  const force = request.headers.get('x-usage-force') === '1'
  try {
    const usage = await usageReport(ctx, force)
    return json({
      ok: true,
      generatedAt: Date.now(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      usage,
    })
  } catch (error) {
    return json({ ok: false, code: 'INTERNAL', message: String(error?.message ?? error) })
  }
}

/**
 * Handler for `GET /api/usage/quota` — the remote half.
 *
 * `x-usage-force: 1` revalidates synchronously (the panel's Refresh button);
 * a plain GET answers from cache and revalidates in the background.
 *
 * @param {any} ctx
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function handleQuota(ctx, request) {
  const force = request.headers.get('x-usage-force') === '1'
  try {
    const quota = await collectQuota(ctx, { force, wait: force })
    return json({ ok: true, generatedAt: Date.now(), quota })
  } catch (error) {
    return json({ ok: false, code: 'INTERNAL', message: String(error?.message ?? error) })
  }
}

/**
 * Register the plugin's three routes on the shared `/api` channel, and warm the
 * caches so the panel's first open is a cache hit.
 *
 * The warm-up is why opening Settings → 用量 is instant even on a fresh boot:
 * the panel's own numbers are folded here, and the provider round trip that used
 * to block the first render has already happened by the time a human clicks.
 * The interval keeps that true without hammering the providers.
 *
 * @param {any} ctx
 */
export function apply(ctx) {
  for (const [path, handler, label] of [
    ['/api/usage/usage', handleUsage, 'usage route'],
    ['/api/usage/quota', handleQuota, 'quota route'],
    ['/api/usage/report', handleReport, 'report route'],
  ]) {
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: (request) => handler(ctx, request),
        }),
      `dsh-usage: ${label}`,
    )
  }

  ctx.effect(() => {
    let stopped = false
    const warm = async () => {
      try {
        await usageReport(ctx, true)
      } catch {
        /* a warm-up failure is not a request failure */
      }
      try {
        await collectQuota(ctx, { force: true, wait: true })
      } catch {
        /* ditto */
      }
    }
    const initial = setTimeout(() => {
      if (!stopped) void warm()
    }, WARMUP_DELAY_MS)
    // Neither timer may hold the Host process open on its own.
    if (typeof initial.unref === 'function') initial.unref()
    const interval = setInterval(() => {
      if (!stopped) void revalidateQuota(ctx)
    }, QUOTA_BACKGROUND_MS)
    if (typeof interval.unref === 'function') interval.unref()
    return () => {
      stopped = true
      clearTimeout(initial)
      clearInterval(interval)
    }
  }, 'dsh-usage: cache warm-up')
}
