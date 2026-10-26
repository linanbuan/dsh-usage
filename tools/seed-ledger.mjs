#!/usr/bin/env node
/**
 * Seed or advance the usage ledger from a directory of session logs.
 *
 * The Host half does this on its own, once per \`syncIntervalMs\`. This tool does
 * the same fold without the Host running, for two jobs the panel cannot do:
 *
 *   - **Backfill.** Credit sessions that were deleted from this machine but still
 *     exist in a backup: they are added to the ledger as already-gone rows, so
 *     their usage counts while nothing is restored to disk. No session file is
 *     copied, moved or recreated.
 *   - **Warm start.** Build the ledger from the live root before the Host's first
 *     sync, so the panel shows the finished number on its first open instead of
 *     after a few seconds of folding.
 *
 * Usage:
 *
 *   node tools/seed-ledger.mjs [--from <dir>] [--ledger <file>] [--dry-run]
 *   node tools/seed-ledger.mjs --backfill --from <dir> [--gone-at <iso|ms>] [--dry-run]
 *
 * \`--from\` defaults to \`$DSH_HOME/sessions\`, then \`~/.dsh/sessions\`.
 * \`--backfill\` only ever ADDS rows: an id already in the ledger is left exactly
 * as the Host left it, so running it twice changes nothing.
 *
 * The reader understands the current on-disk shape (zstd-compressed JSONL, one
 * zstd frame per append, plus plain JSONL). It exists because the Host service
 * that normally reads these logs (\`sessionPersistence\`) is not reachable from a
 * script; the fold itself is \`lib/ledger.js\`, the same code the panel runs.
 *
 * @module @local/dsh-usage/tools/seed-ledger
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

import {
  emptyLedger,
  foldEventsInto,
  ledgerView,
  loadLedgerFile,
  resolveLedgerPath,
  saveLedgerMerged,
  syncLedger,
} from '../lib/ledger.js'

/** Zstd frame magic, used to cut a concatenated append-log into frames. */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * Split a zstd append-log into decoded frames.
 *
 * @param {Buffer} buffer
 * @returns {string[]} decoded payloads, in file order.
 */
function decodeZstdFrames(buffer) {
  const starts = []
  let index = 0
  while ((index = buffer.indexOf(ZSTD_MAGIC, index)) !== -1) {
    starts.push(index)
    index += ZSTD_MAGIC.length
  }
  const payloads = []
  for (let frame = 0; frame < starts.length; frame += 1) {
    const end = frame + 1 < starts.length ? starts[frame + 1] : buffer.length
    try {
      payloads.push(zstdDecompressSync(buffer.subarray(starts[frame], end)).toString('utf8'))
    } catch {
      /* a torn frame is skipped, exactly as the Host's own reader would */
    }
  }
  return payloads
}

/**
 * @param {Buffer} buffer
 * @returns {any[]} the log's events, header record excluded.
 */
function decodeLog(buffer) {
  const looksCompressed = buffer.length > 4 && buffer.subarray(0, 4).equals(ZSTD_MAGIC)
  const payloads = looksCompressed ? decodeZstdFrames(buffer) : [buffer.toString('utf8')]
  const events = []
  for (const payload of payloads) {
    for (const line of payload.split('\n')) {
      if (line === '') continue
      let record
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      // The header record is the log's first line and carries the session id;
      // it is not an event, and \`read()\` never returns it.
      if (record?.type === 'session') continue
      events.push(record)
    }
  }
  return events
}

/**
 * List one sessions root the way \`sessionPersistence.list()\` would.
 *
 * @param {string} root
 * @returns {{ id: string, project: string, file: string, sizeBytes: number, revision: string }[]}
 */
/**
 * The Host's change token for one stored log.
 *
 * `dsh-session-persistence-jsonl` builds a snapshot revision as
 * `[dev, ino, size, mtimeNs, ctimeNs].join(':')` of a bigint stat, so writing the
 * same string here lets the Host skip every log this tool has already folded
 * instead of re-reading all of them once on its first sync.
 *
 * @param {import('node:fs').BigIntStats} identity
 * @returns {string}
 */
function fileRevision(identity) {
  return [identity.dev, identity.ino, identity.size, identity.mtimeNs, identity.ctimeNs].join(':')
}

function listRoot(root) {
  const artifacts = []
  let projects
  try {
    projects = readdirSync(root)
  } catch {
    return artifacts
  }
  for (const project of projects) {
    let names
    try {
      names = readdirSync(join(root, project))
    } catch {
      continue
    }
    for (const name of names) {
      const directory = join(root, project, name)
      let entries
      try {
        if (!statSync(directory).isDirectory()) continue
        entries = readdirSync(directory)
      } catch {
        continue
      }
      /** Highest format generation wins, which is the Host's own rule. */
      let chosen
      let version = -1
      for (const entry of entries) {
        const match = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/.exec(entry)
        if (match === null) continue
        const generation = match[1] === undefined ? 0 : Number(match[1])
        if (generation > version) {
          version = generation
          chosen = entry
        }
      }
      if (chosen === undefined) continue
      const file = join(directory, chosen)
      const identity = statSync(file, { bigint: true })
      artifacts.push({
        // The session id is the directory name, verbatim: `list()` reports that
        // name in `header.id`. Both vintages exist on this machine (`<uuid>` and
        // `session-<uuid>`), so there is nothing to normalise — a key the Host
        // never uses would make its first sync credit the same log twice.
        id: name,
        project,
        file,
        sizeBytes: Number(identity.size),
        revision: fileRevision(identity),
      })
    }
  }
  return artifacts
}

/**
 * A \`sessionPersistence\` stand-in over one directory.
 *
 * @param {string} root
 * @returns {any}
 */
export function directoryPersistence(root) {
  const artifacts = new Map(listRoot(root).map((artifact) => [artifact.id, artifact]))
  const cache = new Map()
  return {
    artifacts,
    async list() {
      return [...artifacts.values()].map((artifact) => ({
        header: { id: artifact.id, cwd: artifact.project },
        revision: artifact.revision,
        sizeBytes: artifact.sizeBytes,
      }))
    },
    async open(id) {
      const artifact = artifacts.get(id)
      if (artifact === undefined) throw new Error('no such session: ' + id)
      const events = () => {
        const hit = cache.get(id)
        if (hit !== undefined && hit.sizeBytes === artifact.sizeBytes) return hit.events
        const decoded = decodeLog(readFileSync(artifact.file))
        cache.set(id, { sizeBytes: artifact.sizeBytes, events: decoded })
        return decoded
      }
      return {
        async read(offset, length) {
          return { events: events().slice(offset, offset + length) }
        },
        async close() {},
      }
    },
  }
}

/**
 * Read one flag's value.
 *
 * @param {string[]} argv
 * @param {string} flag
 * @returns {string|undefined}
 */
function flagValue(argv, flag) {
  const index = argv.indexOf(flag)
  return index === -1 ? undefined : argv[index + 1]
}

/**
 * @param {number} value
 * @returns {string}
 */
function grouped(value) {
  return Math.round(value).toLocaleString('en-US')
}

/**
 * The default sessions root: \`$DSH_HOME/sessions\`, then \`~/.dsh/sessions\`.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {string}
 */
export function defaultSessionsRoot(env = process.env) {
  const fromEnv = env?.DSH_HOME
  const home = typeof fromEnv === 'string' && fromEnv.trim() !== '' ? fromEnv : join(homedir(), '.dsh')
  return join(home, 'sessions')
}

/**
 * Credit every session of a backup root that the ledger has never seen.
 *
 * @param {{ root: string, ledgerPath: string, dryRun: boolean, goneAt: number }} options
 * @returns {Promise<{ added: number, skipped: number, tokens: number, before: number, after: number, ledger: any }>}
 */
export async function backfill(options) {
  const onDisk = loadLedgerFile(options.ledgerPath).ledger
  const ledger = structuredClone(onDisk)
  const before = ledgerView(ledger).totals.total
  const persistence = directoryPersistence(options.root)
  let added = 0
  let skipped = 0
  let tokens = 0
  for (const artifact of persistence.artifacts.values()) {
    if (ledger.sessions[artifact.id] !== undefined) {
      skipped += 1
      continue
    }
    const events = await (await persistence.open(artifact.id)).read(0, Number.MAX_SAFE_INTEGER)
    const days = {}
    const lastSeq = foldEventsInto(days, events.events)
    let firstSeenAt = options.goneAt
    for (const event of events.events) {
      if (typeof event?.time === 'number' && Number.isFinite(event.time) && event.time < firstSeenAt) firstSeenAt = event.time
    }
    let credited = 0
    for (const bucket of Object.values(days)) credited += bucket.total
    tokens += credited
    added += 1
    ledger.sessions[artifact.id] = {
      project: artifact.project,
      offset: events.events.length,
      lastSeq,
      revision: null,
      sizeBytes: artifact.sizeBytes,
      firstSeenAt,
      lastSeenAt: Math.max(options.goneAt, artifact.mtimeMs),
      goneAt: options.goneAt,
      source: 'backfill:' + options.root,
      days,
    }
  }
  if (!options.dryRun && added > 0) saveLedgerMerged(options.ledgerPath, ledger)
  return {
    added,
    skipped,
    tokens,
    before,
    after: ledgerView(ledger).totals.total,
    ledger,
  }
}

/**
 * Run the tool.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const backfillMode = argv.includes('--backfill')
  const root = flagValue(argv, '--from') ?? defaultSessionsRoot()
  const ledgerPath = flagValue(argv, '--ledger') ?? resolveLedgerPath()
  const goneAtRaw = flagValue(argv, '--gone-at')
  const parsedGoneAt = goneAtRaw === undefined ? Number.NaN : goneAtRaw.includes('-') ? Date.parse(goneAtRaw) : Number(goneAtRaw)
  const goneAt = Number.isFinite(parsedGoneAt) ? parsedGoneAt : Date.now()

  console.log('ledger : ' + ledgerPath)
  console.log('root   : ' + root)
  console.log('mode   : ' + (backfillMode ? 'backfill (add only)' : 'sync (advance, mark gone)') + (dryRun ? ' [dry run]' : ''))
  if (backfillMode && flagValue(argv, '--from') === undefined) {
    console.error('\n--backfill needs an explicit --from <dir>: the live root is what the Host already syncs.')
    process.exitCode = 2
    return
  }

  if (backfillMode) {
    const result = await backfill({ root, ledgerPath, dryRun, goneAt })
    console.log('\ncredited : ' + String(result.added) + ' session(s), ' + grouped(result.tokens) + ' tokens')
    console.log('already  : ' + String(result.skipped) + ' session(s) left untouched')
    console.log('ledger   : ' + grouped(result.before) + ' -> ' + grouped(result.after) + ' tokens')
    if (dryRun) console.log('\ndry run: nothing was written.')
    return
  }

  const loaded = loadLedgerFile(ledgerPath)
  const ledger = loaded.ledger
  const before = ledgerView(ledger)
  const persistence = directoryPersistence(root)
  const result = await syncLedger(persistence, ledger)
  // Report the ledger that will actually be on disk. Saving merges into the file
  // (and collapses two spellings of one session into a single row), so the
  // in-memory view alone can be a couple of rows — and their whole credit — larger
  // than what the panel will read.
  const after = dryRun ? ledgerView(ledger) : ledgerView(saveLedgerMerged(ledgerPath, ledger))
  console.log('\nfolded   : ' + String(result.read) + ' read, ' + String(result.skipped) + ' unchanged, ' + String(result.gone) + ' gone')
  if (result.adopted > 0) console.log('adopted  : ' + String(result.adopted) + ' row(s) filed under the other id spelling')
  console.log('took     : ' + String(result.tookMs) + ' ms')
  console.log('ledger   : ' + grouped(before.totals.total) + ' -> ' + grouped(after.totals.total) + ' tokens')
  console.log('on disk  : ' + grouped(after.live.total) + ' tokens in ' + String(after.live.sessions) + ' session(s)')
  if (loaded.warnings.length > 0) console.log('warnings :\n  ' + loaded.warnings.join('\n  '))
  if (result.warnings.length > 0) console.log('warnings :\n  ' + result.warnings.join('\n  '))
  if (dryRun) {
    console.log('\ndry run: nothing was written.')
    return
  }
  console.log('\nwrote    : ' + ledgerPath)
}

if (process.argv[1] !== undefined && import.meta.url === new URL('file://' + process.argv[1].replace(/\\/g, '/')).href) {
  await main()
}
