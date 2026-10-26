/**
 * The incremental token ledger.
 *
 * The panel used to re-derive its "all time" figures from the session logs on
 * every read, which meant a number that could only ever describe what is on disk
 * right now: deleting a session silently rewound the total. This module keeps the
 * accounting instead — one row per session, the day buckets it has contributed,
 * and how far into its log that contribution has been consumed — so a later sync
 * reads only what is new, and a session that disappears from disk keeps its
 * numbers.
 *
 * Three invariants hold by construction, and the tests assert them:
 *
 *   1. Credit only ever grows. Every anomaly (a shorter log, a rewritten log, an
 *      unreadable one) is reported as a warning and the row is left as it was.
 *   2. An unchanged session is never opened. The snapshot's revision is the
 *      change token, so an equal revision means "nothing to do".
 *   3. A session that vanishes is marked, not subtracted — `goneAt` records when,
 *      and its day buckets stay in the totals forever.
 *
 * The ledger is plain JSON so the panel's own read stays a merge in memory
 * (measured at 0.08 ms for 149 sessions on this machine).
 *
 * @module @local/dsh-usage/lib/ledger
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Ledger file format version. */
export const LEDGER_VERSION = 1

/** Environment variable that overrides the ledger path (tests, alternate homes). */
export const LEDGER_ENV = 'DSH_USAGE_LEDGER'

/** Environment variable that relocates the Harness home directory. */
export const DSH_HOME_ENV = 'DSH_HOME'

/** Directory under the Harness home that holds the ledger. */
export const LEDGER_DIR_NAME = 'usage-ledger'

/** Ledger file name inside that directory. */
export const LEDGER_FILE_NAME = 'ledger.json'

/** Session-log events read per page while advancing one session. */
export const LEDGER_PAGE = 512

/**
 * Hard stop on one session's catch-up, so a pathological log cannot stall a sync.
 *
 * A log past it keeps its consumed offset and is advanced on the next sync
 * instead of being read in one go.
 */
export const MAX_EVENTS_PER_SESSION = 400_000

// ---------------------------------------------------------------------------
// Usage folding primitives
// ---------------------------------------------------------------------------

/**
 * Folded per-day usage for one session, keyed by local date.
 *
 * @typedef {object} DayBucket
 * @property {string} date            local YYYY-MM-DD
 * @property {number} input           uncached prompt tokens
 * @property {number} output          completion tokens
 * @property {number} cacheRead       cache-hit (cache read) tokens
 * @property {number} cacheWrite      cache write tokens
 * @property {number} total           input + cacheRead + cacheWrite + output
 * @property {number} requests        billed attempts observed
 * @property {Record<string, DayBucket>} providers per-provider split
 */

/**
 * One session's ledger row.
 *
 * @typedef {object} LedgerRow
 * @property {string} [project]        project segment the log lived under
 * @property {number} offset          events consumed so far (next read index)
 * @property {number} lastSeq         seq of the last consumed event, or -1
 * @property {unknown} revision       the snapshot's change token when last read
 * @property {number|undefined} sizeBytes log size when last read
 * @property {number} firstSeenAt     when this row was first credited
 * @property {number} lastSeenAt      when this row was last advanced
 * @property {number|null} goneAt     when the log disappeared, or null while present
 * @property {string} [source]        where the credit came from (a backfill)
 * @property {Record<string, DayBucket>} days this session's own contribution
 */

/**
 * The ledger document.
 *
 * @typedef {object} Ledger
 * @property {number} version
 * @property {number} createdAt  when the ledger was first created
 * @property {number} updatedAt  when it was last synced (0 = never)
 * @property {Record<string, LedgerRow>} sessions
 */

/**
 * @param {unknown} value
 * @returns {number} a finite non-negative integer, or 0.
 */
export function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/**
 * The local calendar date of an instant, as YYYY-MM-DD.
 *
 * Usage is bucketed in the operator's own timezone, which is what a calendar
 * view of "今天" has to mean.
 *
 * @param {number} epochMs
 * @returns {string}
 */
export function localDateKey(epochMs) {
  const at = new Date(typeof epochMs === 'number' && Number.isFinite(epochMs) ? epochMs : Date.now())
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return String(at.getFullYear()) + '-' + month + '-' + day
}

/**
 * @param {string} date
 * @returns {DayBucket}
 */
export function emptyBucket(date) {
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
 * @param {any} usage
 * @param {string} provider
 */
export function addUsage(bucket, usage, provider) {
  const input = count(usage?.inputTokens)
  const output = count(usage?.outputTokens)
  const cacheRead = count(usage?.cacheReadTokens)
  const cacheWrite = count(usage?.cacheWriteTokens)
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
 * Merge one day map into another, in place, over Maps.
 *
 * @param {Map<string, DayBucket>} into
 * @param {Map<string, DayBucket>} from
 */
export function mergeDayMaps(into, from) {
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
 * Add one bucket's figures into another bucket, in place.
 *
 * @param {DayBucket} target
 * @param {DayBucket} bucket
 */
export function addBucket(target, bucket) {
  target.input += count(bucket.input)
  target.output += count(bucket.output)
  target.cacheRead += count(bucket.cacheRead)
  target.cacheWrite += count(bucket.cacheWrite)
  target.total += count(bucket.total)
  target.requests += count(bucket.requests)
  for (const [provider, child] of Object.entries(bucket.providers ?? {})) {
    const existing = target.providers[provider] ?? emptyBucket(target.date)
    addBucket(existing, child)
    target.providers[provider] = existing
  }
}

/**
 * Merge one day map into another, in place, over plain objects.
 *
 * The ledger stores day maps as objects because that is what JSON is; the live
 * fold keeps Maps because its bucket is also its label.
 *
 * @param {Record<string, DayBucket>} into
 * @param {Record<string, DayBucket>} from
 */
export function mergeInto(into, from) {
  for (const [date, bucket] of Object.entries(from ?? {})) {
    if (bucket === null || typeof bucket !== 'object') continue
    const target = into[date] ?? emptyBucket(date)
    addBucket(target, bucket)
    into[date] = target
  }
}

/**
 * Fold one session-log page into a day map, in place.
 *
 * Only assistant/message events carry usage, which is the rule the live fold has
 * always applied: a compaction or a retry attempt records token numbers but no
 * billable usage, and counting those would double-count the turn.
 *
 * @param {Record<string, DayBucket>} days
 * @param {any[]} events
 * @returns {number} the highest seq seen, or -1.
 */
export function foldEventsInto(days, events) {
  let lastSeq = -1
  for (const event of events) {
    if (typeof event?.seq === 'number' && event.seq > lastSeq) lastSeq = event.seq
    if (event?.type !== 'assistant/message') continue
    const usage = event?.data?.usage
    if (usage === undefined || usage === null) continue
    const date = localDateKey(event.time)
    const bucket = days[date] ?? emptyBucket(date)
    addUsage(bucket, usage, String(event?.data?.message?.source?.provider ?? ''))
    days[date] = bucket
  }
  return lastSeq
}

/**
 * The two spellings a stored session id has ever had on this machine.
 *
 * Harness ids carry a `session-` prefix from some version onwards, so a log that
 * was seeded under the older spelling must still be recognised under the newer
 * one. Renaming the row keeps one session as one row; treating the second
 * spelling as a new session would credit its whole history a second time.
 *
 * @param {string} id
 * @returns {string}
 */
function otherSpelling(id) {
  return id.startsWith('session-') ? id.slice('session-'.length) : 'session-' + id
}

/**
 * Move a row filed under the other spelling to `id`, if that is where it lives.
 *
 * The move is in place: the ledger ends up with one row for the session, still
 * holding everything it had credited under the old key.
 *
 * @param {Ledger} ledger
 * @param {string} id
 * @returns {SessionRow|undefined}
 */
function adoptOtherSpelling(ledger, id) {
  const alt = otherSpelling(id)
  const row = ledger.sessions[alt]
  if (row === undefined) return undefined
  delete ledger.sessions[alt]
  ledger.sessions[id] = row
  return row
}

// ---------------------------------------------------------------------------
// The ledger document
// ---------------------------------------------------------------------------

/**
 * @returns {Ledger}
 */
export function emptyLedger() {
  return { version: LEDGER_VERSION, createdAt: 0, updatedAt: 0, sessions: {} }
}

/**
 * Coerce a parsed file (or undefined) into a usable ledger.
 *
 * A hand-edited, truncated or foreign file must never throw on the read path:
 * whatever survives validation is kept and the rest is dropped, because a ledger
 * that refuses to load would report zero usage — the one outcome this module
 * exists to prevent.
 *
 * @param {unknown} raw
 * @returns {Ledger}
 */
export function normalizeLedger(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const sessions = {}
  const rows = source.sessions !== null && typeof source.sessions === 'object' ? source.sessions : {}
  for (const [id, row] of Object.entries(rows)) {
    if (row === null || typeof row !== 'object') continue
    const days = {}
    for (const [date, bucket] of Object.entries(row.days ?? {})) {
      if (bucket === null || typeof bucket !== 'object') continue
      const target = emptyBucket(date)
      target.input = count(bucket.input)
      target.output = count(bucket.output)
      target.cacheRead = count(bucket.cacheRead)
      target.cacheWrite = count(bucket.cacheWrite)
      target.total = count(bucket.total)
      target.requests = count(bucket.requests)
      for (const [provider, child] of Object.entries(bucket.providers ?? {})) {
        const into = emptyBucket(date)
        if (child !== null && typeof child === 'object') addBucket(into, child)
        target.providers[provider] = into
      }
      days[date] = target
    }
    sessions[id] = {
      project: typeof row.project === 'string' ? row.project : undefined,
      offset: count(row.offset),
      lastSeq: typeof row.lastSeq === 'number' && Number.isFinite(row.lastSeq) ? row.lastSeq : -1,
      revision: row.revision,
      sizeBytes: typeof row.sizeBytes === 'number' && Number.isFinite(row.sizeBytes) ? row.sizeBytes : undefined,
      firstSeenAt: count(row.firstSeenAt),
      lastSeenAt: count(row.lastSeenAt),
      goneAt: typeof row.goneAt === 'number' && Number.isFinite(row.goneAt) ? row.goneAt : null,
      source: typeof row.source === 'string' ? row.source : undefined,
      days,
    }
  }
  return {
    version: LEDGER_VERSION,
    createdAt: count(source.createdAt),
    updatedAt: count(source.updatedAt),
    sessions,
  }
}

/**
 * Merge two ledgers, keeping the more advanced row per session.
 *
 * This is what makes two Host processes sharing one home safe: each writes its
 * own view, and the merge keeps the row that consumed more events (which by
 * construction already contains the other one's events). Replaying a shorter row
 * would re-credit events and inflate the total, so the longer row always wins.
 *
 * Two rows at the same offset hold the same credit but may describe it with
 * different metadata — and the fresher description has to win, or the merge
 * becomes a time machine. The revision is exactly that metadata: keep the older
 * one and every following sync sees "revision changed", re-opens all the logs it
 * just finished reading, and pays the full scan again on every tick.
 *
 * @param {Ledger} base
 * @param {Ledger} incoming
 * @returns {Ledger}
 */
export function mergeLedgers(base, incoming) {
  const merged = normalizeLedger(base)
  const other = normalizeLedger(incoming)
  for (const [id, row] of Object.entries(other.sessions)) {
    const mine = merged.sessions[id]
    if (mine === undefined) {
      merged.sessions[id] = row
      continue
    }
    if (row.offset > mine.offset) {
      merged.sessions[id] = row
      continue
    }
    if (row.offset === mine.offset) {
      // Same credit, so take whichever observation of it is newer: the revision
      // records what the log looked like when that offset was reached, and a
      // stale revision would make the next sync re-read a log it already knows.
      if (row.lastSeenAt > mine.lastSeenAt) {
        mine.lastSeenAt = row.lastSeenAt
        mine.revision = row.revision
        mine.sizeBytes = row.sizeBytes
        mine.goneAt = row.goneAt
        if (row.project !== undefined) mine.project = row.project
      }
      if (row.firstSeenAt > 0 && (mine.firstSeenAt === 0 || row.firstSeenAt < mine.firstSeenAt)) {
        mine.firstSeenAt = row.firstSeenAt
      }
    }
  }
  // One session, two spellings. `syncLedger` renames a row when the session turns
  // up under the other id generation, but the copy on disk still holds the old
  // key, and a plain merge would resurrect it — leaving two rows for one session
  // and crediting its whole history twice. Collapse such pairs here, so every
  // save path is protected rather than just the sync that noticed.
  for (const [id, row] of Object.entries(merged.sessions)) {
    if (!id.startsWith('session-')) continue
    const alt = otherSpelling(id)
    const twin = merged.sessions[alt]
    if (twin === undefined) continue
    if (twin.offset > row.offset) merged.sessions[id] = twin
    delete merged.sessions[alt]
  }
  const created = [merged.createdAt, other.createdAt].filter((value) => value > 0)
  merged.createdAt = created.length === 0 ? 0 : Math.min.apply(null, created)
  merged.updatedAt = Math.max(merged.updatedAt, other.updatedAt)
  return merged
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * Advance the ledger by one sync.
 *
 * The snapshot decides everything: an unchanged revision is skipped without
 * opening the log, a grown log is read from its recorded offset, and anything
 * that cannot be squared with what was recorded (a shorter log, a rewritten one,
 * a read failure) is skipped with a warning and its credit left untouched.
 *
 * The page loop folds into a private delta that is merged into the row only
 * after the whole log has been read: a run that aborts halfway must not leave
 * half a page credited behind an offset that still points at those events,
 * because the next sync would then credit them a second time.
 *
 * Ids are opaque and used verbatim — but the same session can be reported under
 * two spellings, because Harness ids grew a `session-` prefix partway through
 * 2026 and this machine has directories of both vintages. A row filed under the
 * other spelling is adopted (renamed, credit kept) rather than treated as a new
 * session, which is the only thing standing between an id-prefix change and a
 * doubled total.
 *
 * @param {any} persistence the sessionPersistence service.
 * @param {Ledger} ledger the ledger to advance in place.
 * @param {{ page?: number, maxEventsPerSession?: number, now?: number }} [options]
 * @returns {Promise<{ sessions: number, read: number, skipped: number, gone: number, adopted: number, tookMs: number, warnings: string[] }>}
 */
export async function syncLedger(persistence, ledger, options = {}) {
  const startedAt = Date.now()
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const page = count(options.page) || LEDGER_PAGE
  const ceiling = count(options.maxEventsPerSession) || MAX_EVENTS_PER_SESSION
  const warnings = []
  let snapshots = []
  try {
    snapshots = await persistence.list()
  } catch (error) {
    warnings.push('list failed: ' + String(error?.message ?? error))
  }
  const live = new Set()
  let adopted = 0
  let read = 0
  let skipped = 0
  for (const snapshot of snapshots) {
    const id = String(snapshot?.header?.id ?? '')
    if (id === '') continue
    live.add(id)
    const known = ledger.sessions[id] !== undefined
    const prev = known ? ledger.sessions[id] : adoptOtherSpelling(ledger, id)
    if (!known && prev !== undefined) adopted += 1
    const sizeBytes =
      typeof snapshot?.sizeBytes === 'number' && Number.isFinite(snapshot.sizeBytes) ? snapshot.sizeBytes : undefined
    // 1) Nothing moved since the last sync: never open the log.
    if (prev !== undefined && prev.goneAt === null && prev.revision === snapshot.revision) {
      skipped += 1
      continue
    }
    // 2) The log got shorter. That is a rewrite, a migration or an external
    //    truncation — never a reason to hand credit back.
    if (
      prev !== undefined &&
      sizeBytes !== undefined &&
      typeof prev.sizeBytes === 'number' &&
      sizeBytes < prev.sizeBytes
    ) {
      warnings.push(id + ': 日志变短（' + String(sizeBytes) + ' < ' + String(prev.sizeBytes) + '），保留已记用量')
      continue
    }
    read += 1
    const delta = {}
    let offset = prev?.offset ?? 0
    let lastSeq = prev?.lastSeq ?? -1
    let failure
    let handle
    try {
      handle = await persistence.open(id, 'read')
      while (offset < ceiling) {
        const pageResult = await handle.read(offset, page)
        const events = Array.isArray(pageResult?.events) ? pageResult.events : []
        if (events.length === 0) break
        // 3) Continuity: the first unread event must be the one right after the
        //    last consumed one. Anything else means the log was reordered, and
        //    guessing which events are new would risk double counting.
        const firstSeq = events.find((event) => typeof event?.seq === 'number')?.seq
        if (lastSeq >= 0 && typeof firstSeq === 'number' && firstSeq !== lastSeq + 1) {
          failure = 'seq 不连续（期望 ' + String(lastSeq + 1) + '，读到 ' + String(firstSeq) + '）'
          break
        }
        const highest = foldEventsInto(delta, events)
        if (highest > lastSeq) lastSeq = highest
        offset += events.length
        if (events.length < page) break
      }
    } catch (error) {
      failure = String(error?.message ?? error)
    } finally {
      if (handle !== undefined) {
        try {
          await handle.close()
        } catch {
          /* a close failure does not invalidate the read */
        }
      }
    }
    if (failure !== undefined) {
      warnings.push(id + ': ' + failure)
      continue
    }
    const days = prev?.days ?? {}
    mergeInto(days, delta)
    ledger.sessions[id] = {
      project: typeof prev?.project === 'string' ? prev.project : String(snapshot?.header?.cwd ?? ''),
      offset,
      lastSeq,
      revision: snapshot.revision,
      sizeBytes,
      firstSeenAt: prev?.firstSeenAt !== undefined && prev.firstSeenAt > 0 ? prev.firstSeenAt : now,
      lastSeenAt: now,
      goneAt: null,
      source: prev?.source,
      days,
    }
  }
  // 4) Gone from disk: marked, never subtracted.
  let gone = 0
  for (const [id, row] of Object.entries(ledger.sessions)) {
    if (!live.has(id) && row.goneAt === null) {
      row.goneAt = now
      gone += 1
    }
  }
  if (ledger.createdAt === 0) ledger.createdAt = now
  ledger.updatedAt = now
  return {
    sessions: snapshots.length,
    read,
    skipped,
    gone,
    adopted,
    tookMs: Date.now() - startedAt,
    warnings,
  }
}

/**
 * The panel's view of a ledger: every day ever credited, plus today and totals.
 *
 * live is the same merge restricted to sessions still on disk, which is the
 * 本机现存日志 figure the panel shows next to the ledger total. Both come from
 * one merge, so they can never disagree about a session that is on both sides.
 *
 * @param {Ledger} ledger
 * @param {number} [now]
 * @returns {{ days: DayBucket[], today: DayBucket, totals: DayBucket, live: { sessions: number, total: number, cacheRead: number, requests: number } }}
 */
export function ledgerView(ledger, now = Date.now()) {
  const merged = {}
  const stillThere = {}
  const sessions = ledger?.sessions ?? {}
  for (const row of Object.values(sessions)) {
    mergeInto(merged, row.days)
    if (row.goneAt === null) mergeInto(stillThere, row.days)
  }
  const days = Object.values(merged).sort((left, right) => (left.date < right.date ? -1 : 1))
  const totals = emptyBucket('total')
  for (const bucket of days) addBucket(totals, bucket)
  const todayKey = localDateKey(now)
  const today = merged[todayKey] ?? emptyBucket(todayKey)
  let liveTotal = 0
  let liveCacheRead = 0
  let liveRequests = 0
  for (const bucket of Object.values(stillThere)) {
    liveTotal += bucket.total
    liveCacheRead += bucket.cacheRead
    liveRequests += bucket.requests
  }
  const liveSessions = Object.values(sessions).filter((row) => row.goneAt === null).length
  return {
    days,
    today,
    totals,
    live: { sessions: liveSessions, total: liveTotal, cacheRead: liveCacheRead, requests: liveRequests },
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * Resolve the ledger file path.
 *
 * $DSH_USAGE_LEDGER wins outright (the tests and a second home use it), then
 * $DSH_HOME, then ~/.dsh — the precedence the rest of the Harness uses.
 *
 * @param {Record<string, string|undefined>} [env]
 * @param {string} [home]
 * @returns {string}
 */
export function resolveLedgerPath(env = process.env, home = homedir()) {
  const override = env?.[LEDGER_ENV]
  if (typeof override === 'string' && override.trim() !== '') return override
  const fromEnv = env?.[DSH_HOME_ENV]
  const dshHome = typeof fromEnv === 'string' && fromEnv.trim() !== '' ? fromEnv : join(home, '.dsh')
  return join(dshHome, LEDGER_DIR_NAME, LEDGER_FILE_NAME)
}

/**
 * Read one ledger file, falling back to the .bak copy of a damaged file.
 *
 * @param {string} path
 * @returns {{ ledger: Ledger, warnings: string[] }}
 */
export function loadLedgerFile(path) {
  const warnings = []
  for (const candidate of [path, path + '.bak']) {
    if (!existsSync(candidate)) continue
    try {
      const raw = JSON.parse(readFileSync(candidate, 'utf8'))
      if (candidate !== path) warnings.push('账本 ' + path + ' 无法解析，已改用 ' + candidate + '。')
      return { ledger: normalizeLedger(raw), warnings }
    } catch (error) {
      warnings.push(candidate + ': ' + String(error?.message ?? error))
    }
  }
  return { ledger: emptyLedger(), warnings }
}

/**
 * Write the ledger atomically, keeping the previous file as .bak.
 *
 * A sync writes a few hundred kilobytes at most, so write-temp-plus-rename is
 * both cheaper and safer than a lock: a crash leaves either the old file or the
 * new one, never a half-written ledger.
 *
 * @param {string} path
 * @param {Ledger} ledger
 * @returns {void}
 */
export function saveLedgerFile(path, ledger) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = path + '.tmp'
  writeFileSync(temporary, JSON.stringify(ledger), 'utf8')
  if (existsSync(path)) {
    try {
      copyFileSync(path, path + '.bak')
    } catch {
      /* a missing backup must not block the write */
    }
  }
  renameSync(temporary, path)
}

/**
 * Save, first merging whatever another process wrote since this one loaded.
 *
 * @param {string} path
 * @param {Ledger} ledger
 * @returns {Ledger} the merged ledger that was written (what the caller should keep in memory).
 */
export function saveLedgerMerged(path, ledger) {
  const onDisk = existsSync(path) ? loadLedgerFile(path).ledger : emptyLedger()
  const merged = mergeLedgers(onDisk, ledger)
  saveLedgerFile(path, merged)
  return merged
}
