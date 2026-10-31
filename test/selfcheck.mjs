// Activation self-check for the 用量 bundle: load both halves exactly as the
// Host/Client plugin systems do, apply them against stub contexts, and exercise
// both routes offline (no credentials, no session persistence).
//
//   node test/selfcheck.mjs
import { pathToFileURL } from 'node:url';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUNDLE = dirname(dirname(fileURLToPath(import.meta.url)));

// The ledger is durable state, so the self-check must never write into the
// operator's own home: point it at a throwaway directory before the host half
// is ever loaded.
const LEDGER_DIR = join(tmpdir(), `dsh-usage-selfcheck-${String(process.pid)}`);
rmSync(LEDGER_DIR, { recursive: true, force: true });
// The host's first load inherits pre-1.6 ledgers from $DSH_HOME and ~/.dsh, so
// every home this process can resolve is pointed at the throwaway directory
// first: a self-check must never read the operator's real usage history.
process.env.DSH_HOME = join(LEDGER_DIR, 'dsh-home');
process.env.HOME = join(LEDGER_DIR, 'home');
process.env.USERPROFILE = process.env.HOME;
process.env.APPDATA = join(LEDGER_DIR, 'appdata');
process.env.LOCALAPPDATA = join(LEDGER_DIR, 'localappdata');
process.env.XDG_DATA_HOME = join(LEDGER_DIR, 'xdg');
process.env.DSH_USAGE_LEDGER = join(LEDGER_DIR, 'ledger.json');
void join;
let failures = 0;
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` :: ${detail}`}`);
  }
};

// ---------------------------------------------------------------------------
// A. Host half
// ---------------------------------------------------------------------------
console.log('A. host half (index.js)');

const host = await import(pathToFileURL(`${BUNDLE}/index.js`).href);
check('exports apply()', typeof host.apply === 'function');
check("exports inject ['connection']", Array.isArray(host.inject) && host.inject.includes('connection'));
check('exports a name', typeof host.name === 'string' && host.name.length > 0);
check('no Config export (nothing to validate)', host.Config === undefined);

const routes = [];
const effects = [];
const services = {
  // No credentials service and no sessionPersistence: the degraded path.
};
const hostCtx = {
  effect(factory, label) {
    effects.push(label);
    const disposer = factory();
    return disposer;
  },
  get(name) {
    return services[name];
  },
  connection: {
    fetch: {
      register(route) {
        routes.push(route);
        return async () => {};
      },
    },
  },
};

let applyThrew;
try {
  host.apply(hostCtx);
} catch (error) {
  applyThrew = error;
}
check('apply() does not throw', applyThrew === undefined, applyThrew?.stack);
check('registered exactly 3 routes', routes.length === 3, `got ${String(routes.length)}`);
check(
  'route paths are the split usage/quota pair plus report',
  routes.map((route) => route.path).sort().join(',') === '/api/usage/quota,/api/usage/report,/api/usage/usage',
  routes.map((route) => route.path).join(','),
);
check(
  'every route path is unique (a duplicate throws on mount)',
  new Set(routes.map((route) => route.path)).size === routes.length,
);
check(
  'every route: GET + buffered + fetch fn',
  routes.every(
    (route) =>
      Array.isArray(route.methods) &&
      route.methods.length === 1 &&
      route.methods[0] === 'GET' &&
      route.requestBody === 'buffered' &&
      typeof route.fetch === 'function',
  ),
);
check(
  'three route effects plus the cache warm-up are all named',
  effects.length === 4 && effects.every((label) => typeof label === 'string'),
  effects.join(','),
);

// Degraded path: no credentials, no persistence — must still answer 200 JSON.
const reportRoute = routes.find((route) => route.path === '/api/usage/report');
const request = new Request('http://127.0.0.1/api/usage/report', { headers: { accept: 'application/json' } });
const response = await reportRoute.fetch(request);
const payload = await response.json();
check('report answers 200', response.status === 200, String(response.status));
check('report is JSON with ok:true', payload.ok === true, JSON.stringify(payload).slice(0, 200));
check('usage degrades to available:false', payload.usage?.available === false);
check('all-time totals are numeric zeros', payload.usage?.totals?.total === 0 && payload.usage?.totals?.cacheRead === 0);
check('today bucket exists', typeof payload.usage?.today?.date === 'string');
check(
  'all three providers report no-key (never throw)',
  (payload.quota?.providers ?? []).length === 3 &&
    (payload.quota?.providers ?? []).every((provider) => provider.status === 'no-key'),
);
check('a time zone is reported', typeof payload.timeZone === 'string' && payload.timeZone.length > 0);
check(
  'no-cache header set',
  response.headers.get('cache-control') === 'no-store',
  String(response.headers.get('cache-control')),
);

// Happy path: a fake persistence and a fake credential store exercise the fold,
// the provider parsers and the windows without touching the network.
const sessionEvents = [
  { type: 'assistant/message', seq: 0, time: Date.now(), data: { usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 400, cacheWriteTokens: 5 }, message: { source: { provider: 'commandcode' } } } },
  { type: 'tool/call', seq: 1, time: Date.now(), data: {} },
  { type: 'assistant/message', seq: 2, time: Date.now(), data: { usage: { inputTokens: 7, outputTokens: 1, cacheReadTokens: 100 }, message: { source: { provider: 'kimi-coding' } } } },
  { type: 'assistant/message', seq: 3, time: Date.now(), data: {} },
];
const opened = [];
services.sessionPersistence = {
  async list() {
    return [{ header: { id: 'session-a' }, revision: 'r1' }];
  },
  async open(id, access) {
    opened.push(`${id}:${access}`);
    return {
      id,
      async read(offset, length) {
        const events = sessionEvents.filter((event) => event.seq >= offset).slice(0, length);
        return { eventState: 'detached', events };
      },
      async close() {},
    };
  },
};
services.credentials = {
  async resolve(ref) {
    return ref === 'KIMI_CODING_API_KEY'
      ? { value: 'kimi-key' }
      : ref === 'COMMANDCODE_API_KEY'
        ? { value: 'cc-key' }
        : ref === 'OPENCODEGO_API_KEY'
          ? { value: 'oc-key' }
          : undefined;
  },
};
// The providers are unreachable offline, so the parsers are exercised directly
// through a stubbed fetch that answers the real payload shapes. Each call also
// sleeps, which is what lets the checks below prove the five requests overlap:
// on this machine one provider round trip is seconds, so paying it once instead
// of twice is the whole point of the parallel rewrite.
const DELAY_MS = 200;
const providerCalls = [];
const realFetch = globalThis.fetch;
const timeoutError = () => Object.assign(new Error('the operation was aborted due to timeout'), { name: 'TimeoutError' });
/** 'ok' | 'retry-once' | 'always-timeout': how the kimi read answers this round. */
let kimiMode = 'ok';
const kimiCalls = [];
globalThis.fetch = async (url) => {
  const target = String(url);
  providerCalls.push(target);
  await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  if (target.includes('/alpha/billing/credits')) {
    return new Response(
      JSON.stringify({
        credits: { monthlyCredits: 48.04, purchasedCredits: 0, freeCredits: 0, belowThreshold: false },
        windowLimits: { fiveHour: { used: 0.44, cap: 14, exceeded: false, resetAt: Date.now() + 3_600_000 }, weekly: { used: 9.5, cap: 35, exceeded: false, resetAt: Date.now() + 86_400_000 } },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (target.includes('/alpha/billing/subscriptions')) {
    return new Response(JSON.stringify({ success: true, data: { planId: 'individual-goat', status: 'active', currentPeriodEnd: new Date(Date.now() + 16 * 86_400_000).toISOString() } }), { status: 200 });
  }
  if (target.includes('/alpha/usage/summary')) {
    return new Response(JSON.stringify({ totalCount: 11, totalTokensIn: 100, totalTokensOut: 20, totalMonthlyCredits: 22.05 }), { status: 200 });
  }
  if (target.includes('/coding/v1/usages')) {
    kimiCalls.push(target);
    if (kimiMode === 'always-timeout') throw timeoutError();
    if (kimiMode === 'retry-once' && kimiCalls.length === 1) throw timeoutError();
    return new Response(JSON.stringify({ usages: { limit_5h: { used_ratio: 0, reset_time: new Date(Date.now() + 3_600_000).toISOString() }, limit_month_code: { used_ratio: 0.1255, reset_time: new Date(Date.now() + 86_400_000).toISOString() }, limit_month_total: { used_ratio: 0.1255, reset_time: new Date(Date.now() + 86_400_000).toISOString() } } }), { status: 200 });
  }
  if (target === 'https://opencode.ai/zen/go/v1/usage') {
    return new Response(
      JSON.stringify({
        usage: {
          rolling: { status: 'ok', percent: 5, resetsAt: new Date(Date.now() + 3_600_000).toISOString() },
          weekly: { status: 'ok', percent: 25, resetsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() },
          monthly: { status: 'ok', percent: 63.5, resetsAt: new Date(Date.now() + 30 * 86_400_000).toISOString() },
        },
      }),
      { status: 200 },
    );
  }
  throw new Error(`unexpected fetch: ${target}`);
};

const usageStarted = Date.now();
const second = await reportRoute.fetch(
  new Request('http://127.0.0.1/api/usage/report', { headers: { accept: 'application/json', 'x-usage-force': '1' } }),
);
const secondPayload = await second.json();
const quotaElapsed = Date.now() - usageStarted;

check(
  'all five provider reads overlap (one round trip, not two serialized groups)',
  providerCalls.length === 5 && quotaElapsed < DELAY_MS * 3,
  `${String(providerCalls.length)} calls in ${String(quotaElapsed)}ms (serialized groups would need ${String(DELAY_MS * 4)}ms+)`,
);

// The local half must stay millisecond-cheap even while the providers are slow.
const usageRoute = routes.find((route) => route.path === '/api/usage/usage');
const quotaRoute = routes.find((route) => route.path === '/api/usage/quota');
const localStarted = Date.now();
const local = await usageRoute.fetch(
  new Request('http://127.0.0.1/api/usage/usage', { headers: { accept: 'application/json', 'x-usage-force': '1' } }),
);
const localPayload = await local.json();
const localElapsed = Date.now() - localStarted;
check(
  'the split usage route answers without touching a provider',
  localPayload.ok === true && localPayload.usage?.available === true && localPayload.quota === undefined,
  JSON.stringify(Object.keys(localPayload)),
);
check(
  'the split usage route is fast (< one provider delay)',
  localElapsed < DELAY_MS,
  `${String(localElapsed)}ms`,
);
// The panel's caption names the file to back up, so the payload has to carry the
// path the ledger was actually read from — which 1.6.0 moved out of $DSH_HOME.
check(
  'ledger: the usage payload names the ledger file it reads',
  localPayload.usage?.scan?.source === 'ledger' &&
    typeof localPayload.usage?.scan?.ledgerPath === 'string' &&
    localPayload.usage.scan.ledgerPath === process.env.DSH_USAGE_LEDGER,
  JSON.stringify({
    source: localPayload.usage?.scan?.source,
    ledgerPath: localPayload.usage?.scan?.ledgerPath,
  }),
);

// A cached quota answer is served as-is with `refreshing:false`.
const cachedResponse = await quotaRoute.fetch(new Request('http://127.0.0.1/api/usage/quota'));
const cachedPayload = await cachedResponse.json();
check(
  'a warm quota GET is a cache hit that does not block',
  cachedPayload.quota?.providers?.length === 3 && cachedPayload.quota?.refreshing === false,
  JSON.stringify({ providers: cachedPayload.quota?.providers?.length, refreshing: cachedPayload.quota?.refreshing }),
);
// Resilience on a flaky path. Measured on this machine: api.commandcode.ai
// normally answers in 230-900 ms, but produced a 10.5 s connect timeout and a
// 9.4 s response in one afternoon — both past the old 8 s deadline, which is
// what turned the card into 读取失败. So: one retry with a fresh deadline, and a
// provider that stays down keeps its last good numbers instead of blanking.
const quotaNow = async () => {
  const response = await quotaRoute.fetch(
    new Request('http://127.0.0.1/api/usage/quota', { headers: { accept: 'application/json', 'x-usage-force': '1' } }),
  );
  return (await response.json()).quota;
};
const kimiNow = (quota) => (quota.providers ?? []).find((provider) => provider.id === 'kimi-coding');

kimiMode = 'retry-once';
kimiCalls.length = 0;
const retried = kimiNow(await quotaNow());
check(
  'a timed-out provider read is retried once with a fresh deadline',
  kimiCalls.length === 2 && retried?.status === 'ok' && retried?.stale !== true,
  `${String(kimiCalls.length)} attempt(s), status ${String(retried?.status)}`,
);

const goodFetchedAt = retried.fetchedAt;
kimiMode = 'always-timeout';
kimiCalls.length = 0;
const staleQuota = await quotaNow();
const staleKimi = kimiNow(staleQuota);
check(
  'a provider that stays down keeps its last good windows',
  kimiCalls.length === 2 && staleKimi?.stale === true && staleKimi?.windows?.length === 2,
  `${String(kimiCalls.length)} attempts, stale=${String(staleKimi?.stale)}, windows=${String(staleKimi?.windows?.length)}`,
);
check(
  'the kept numbers are the previous round\u2019s, not silently recomputed',
  staleKimi?.fetchedAt === goodFetchedAt,
  `${String(staleKimi?.fetchedAt)} vs ${String(goodFetchedAt)}`,
);
check('the kept card still carries the failure reason', String(staleKimi?.message).includes('时限内'), String(staleKimi?.message));
check(
  'a failing provider does not stop the others from refreshing',
  (staleQuota.providers ?? []).find((provider) => provider.id === 'commandcode')?.status === 'ok',
  JSON.stringify((staleQuota.providers ?? []).map((provider) => [provider.id, provider.status])),
);

kimiMode = 'ok';
const recovered = kimiNow(await quotaNow());
check(
  'the next successful round clears the stale flag',
  recovered?.status === 'ok' && recovered?.stale !== true,
  JSON.stringify({ status: recovered?.status, stale: recovered?.stale }),
);

// A configuration state must never be papered over with old numbers.
const configured = services.credentials;
services.credentials = { async resolve() { return undefined; } };
const unconfigured = kimiNow(await quotaNow());
services.credentials = configured;
check(
  'a removed key reports no-key instead of the last good numbers',
  unconfigured?.status === 'no-key' && (unconfigured?.windows ?? []).length === 0,
  JSON.stringify({ status: unconfigured?.status, windows: unconfigured?.windows?.length }),
);

globalThis.fetch = realFetch;
void quotaElapsed;

check('sessions opened read-only', opened.every((entry) => entry.endsWith(':read')), opened.join(','));
check('usage becomes available', secondPayload.usage?.available === true);
check(
  'token fold matches input+cacheRead+cacheWrite+output (418+108=526)',
  secondPayload.usage?.today?.total === 526,
  String(secondPayload.usage?.today?.total),
);
check('cache hit is the cache-read share (500)', secondPayload.usage?.today?.cacheRead === 500, String(secondPayload.usage?.today?.cacheRead));
check('requests counted (2)', secondPayload.usage?.today?.requests === 2, String(secondPayload.usage?.today?.requests));
check(
  'per-provider split present',
  Object.keys(secondPayload.usage?.today?.providers ?? {}).sort().join(',') === 'commandcode,kimi-coding',
  Object.keys(secondPayload.usage?.today?.providers ?? {}).join(','),
);
const providers = secondPayload.quota?.providers ?? [];
const kimi = providers.find((provider) => provider.id === 'kimi-coding');
const commandcode = providers.find((provider) => provider.id === 'commandcode');
const opencodeGo = providers.find((provider) => provider.id === 'opencode-go');
// The host drops kimi's monthCode when it restates monthTotal, so the plan's
// own shape arrives as 五小时 + 总额度.
check(
  'kimi parses 5h + monthTotal (monthCode deduped)',
  kimi?.status === 'ok' && kimi.windows.map((w) => w.id).join(',') === '5h,monthTotal',
  JSON.stringify(kimi?.windows?.map((w) => w.id)),
);
check('commandcode parses 5h / weekly / monthly', commandcode?.status === 'ok' && commandcode.windows.map((w) => w.id).join(',') === '5h,7d,monthTotal', JSON.stringify(commandcode?.windows?.map((w) => w.id)));
check('commandcode plan resolved', commandcode?.planName === 'GOAT', String(commandcode?.planName));
check(
  'every window carries a reset instant',
  [...(kimi?.windows ?? []), ...(commandcode?.windows ?? []), ...(opencodeGo?.windows ?? [])].every((w) => typeof w.resetAt === 'number'),
);

// Command Code meters in money, but its per-model money caps differ, so the panel
// reports the spent share instead: no commandcode figure may be a currency amount.
const ccWindows = commandcode?.windows ?? [];
check(
  'commandcode windows are quota shares, not money',
  ccWindows.length === 3 && ccWindows.every((w) => w.unit === 'percent' && w.used >= 0 && w.used <= 1),
  JSON.stringify(ccWindows.map((w) => [w.id, w.unit, w.used])),
);
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-6;
const ccWindow = (id) => ccWindows.find((w) => w.id === id);
check('commandcode 5h share = 0.44 / 14', near(ccWindow('5h')?.used, 0.44 / 14), String(ccWindow('5h')?.used));
check('commandcode weekly share = 9.5 / 35', near(ccWindow('7d')?.used, 9.5 / 35), String(ccWindow('7d')?.used));
// The allowance is spent + remaining (22.05 + 48.04 = 70.09), which is exact for
// any plan; the published 70 would skew the share, so it must not be used here.
check(
  'commandcode monthly share is derived from spent + remaining (70.09)',
  near(ccWindow('monthTotal')?.used, 22.05 / 70.09),
  String(ccWindow('monthTotal')?.used),
);
const ccExtras = commandcode?.extras ?? [];
check(
  'commandcode extras are shares, not money',
  ccExtras.every((e) => e.unit !== 'money') &&
    ccExtras.some((e) => e.label === '本周期剩余' && e.unit === 'percent' && near(e.value, 48.04 / 70.09)) &&
    ccExtras.some((e) => e.label === '加量额度' && e.unit === 'percent' && near(e.value, 0)),
  JSON.stringify(ccExtras),
);
check(
  'kimi keeps its money balance (only commandcode is share-based)',
  (kimi?.extras ?? []).every((e) => e.unit !== 'percent'),
  JSON.stringify(kimi?.extras),
);

// OpenCode Go answers with each window's percent as-is, so the card shows the
// three separate caps the plan's own accounting defines (5h / weekly / month).
check(
  'opencode-go parses rolling / weekly / monthly',
  opencodeGo?.status === 'ok' && opencodeGo.windows.map((w) => w.id).join(',') === '5h,7d,monthTotal',
  JSON.stringify(opencodeGo?.windows?.map((w) => w.id)),
);
const ocWindows = opencodeGo?.windows ?? [];
check(
  'opencode-go percent becomes a 0-1 ratio, with no currency extras',
  ocWindows.length === 3 &&
    ocWindows.every((w) => w.unit === 'percent' && w.used >= 0 && w.used <= 1) &&
    (opencodeGo?.extras ?? []).length === 0 &&
    opencodeGo?.plan === undefined,
  JSON.stringify(ocWindows.map((w) => [w.id, w.unit, w.used])),
);
check('opencode-go rolling share = 5%', ocWindows.find((w) => w.id === '5h')?.used === 0.05, String(ocWindows.find((w) => w.id === '5h')?.used));
check('opencode-go weekly share = 25%', ocWindows.find((w) => w.id === '7d')?.used === 0.25, String(ocWindows.find((w) => w.id === '7d')?.used));
check('opencode-go monthly share = 63.5%', ocWindows.find((w) => w.id === 'monthTotal')?.used === 0.635, String(ocWindows.find((w) => w.id === 'monthTotal')?.used));

// ---------------------------------------------------------------------------
// A2. Incremental ledger
//
// The ledger is the only source of the panel's cumulative figures, so its
// invariants are asserted directly: credit only grows, an unchanged session is
// never opened, and a session that disappears keeps its numbers.
// ---------------------------------------------------------------------------
console.log('\nA2. incremental ledger');

const ledgerModule = await import(pathToFileURL(`${BUNDLE}/lib/ledger.js`).href);
const {
  emptyBucket,
  emptyLedger,
  ledgerView,
  loadLedgerFile,
  loadLedgerWithInheritance,
  localDateKey,
  mergeLedgers,
  normalizeLedger,
  resolveImportRecordPath,
  resolveLegacyLedgerPaths,
  resolveLedgerPath,
  saveLedgerFile,
  saveLedgerMerged,
  syncLedger,
} = ledgerModule;

/** One billed attempt, shaped like an assistant/message event. */
const attempt = (seq, input, token = 'x') => ({
  type: 'assistant/message',
  seq,
  time: Date.now(),
  data: {
    usage: { inputTokens: input, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    message: { source: { provider: 'test-' + token } },
  },
});

/**
 * A fake persistence whose sessions can be added, appended to, truncated and
 * removed, and which counts every log it opens.
 */
function fakePersistence() {
  const sessions = new Map();
  const opened = [];
  return {
    opened,
    sessions,
    /** @param {string} id @param {any[]} events */
    put(id, events) {
      sessions.set(id, { events: events.slice(), revision: `${id}-${String(Math.random())}` });
      return this;
    },
    /** @param {string} id @param {any[]} events */
    append(id, events) {
      const entry = sessions.get(id);
      entry.events = entry.events.concat(events);
      entry.revision = `${id}-${String(Math.random())}`;
      return this;
    },
    /** @param {string} id */
    drop(id) {
      sessions.delete(id);
      return this;
    },
    async list() {
      return [...sessions.entries()].map(([id, entry]) => ({
        header: { id },
        revision: entry.revision,
        sizeBytes: entry.events.length * 100,
      }));
    },
    async open(id) {
      opened.push(id);
      const entry = sessions.get(id);
      if (entry === undefined) throw new Error('no such session: ' + id);
      return {
        async read(offset, length) {
          return { events: entry.events.filter((event) => event.seq >= offset).slice(0, length) };
        },
        async close() {},
      };
    },
  };
}

const storeA = fakePersistence().put('session-1', [attempt(0, 10), attempt(1, 20), attempt(2, 30)]);
storeA.put('session-2', [attempt(0, 100)]);
const firstLedger = emptyLedger();
const firstSync = await syncLedger(storeA, firstLedger);
const firstView = ledgerView(firstLedger);
check('ledger: bootstrap folds every session once', firstView.totals.total === 160, String(firstView.totals.total));
check('ledger: rows are keyed by session id', Object.keys(firstLedger.sessions).sort().join(',') === 'session-1,session-2');
check('ledger: bootstrap leaves nothing gone', firstView.live.sessions === 2 && firstSync.gone === 0, JSON.stringify(firstSync));
check('ledger: createdAt and updatedAt are stamped', firstLedger.createdAt > 0 && firstLedger.updatedAt > 0);

const opensAfterBootstrap = storeA.opened.length;
const idleSync = await syncLedger(storeA, firstLedger);
check(
  'ledger: an unchanged session is never opened',
  storeA.opened.length === opensAfterBootstrap && idleSync.read === 0 && idleSync.skipped === 2,
  JSON.stringify({ opened: storeA.opened.length, idleSync }),
);
check('ledger: an idle sync leaves the total alone', ledgerView(firstLedger).totals.total === 160);

storeA.append('session-1', [attempt(3, 40), attempt(4, 50)]);
const growthSync = await syncLedger(storeA, firstLedger);
const grownView = ledgerView(firstLedger);
check(
  'ledger: growth is credited exactly once (160 + 90)',
  grownView.totals.total === 250,
  String(grownView.totals.total),
);
check('ledger: growth reads only the session that moved', growthSync.read === 1 && growthSync.skipped === 1, JSON.stringify(growthSync));
check('ledger: the offset advances past the new events', firstLedger.sessions['session-1'].offset === 5, String(firstLedger.sessions['session-1']?.offset));

// A plain re-sync must be idempotent, which is what makes the timer safe.
await syncLedger(storeA, firstLedger);
check('ledger: a second sync does not double count', ledgerView(firstLedger).totals.total === 250, String(ledgerView(firstLedger).totals.total));

storeA.drop('session-2');
const deleteSync = await syncLedger(storeA, firstLedger);
const afterDelete = ledgerView(firstLedger);
check(
  'ledger: deleting a session never lowers the total',
  afterDelete.totals.total === 250 && deleteSync.gone === 1,
  JSON.stringify({ total: afterDelete.totals.total, gone: deleteSync.gone }),
);
check('ledger: the deleted row is marked, not dropped', typeof firstLedger.sessions['session-2'].goneAt === 'number');
check('ledger: the live figure excludes the deleted session', afterDelete.live.total === 250 - 100 && afterDelete.live.sessions === 1, JSON.stringify(afterDelete.live));

// The same id coming back (a restore from a backup) must resume, not re-credit.
storeA.put('session-2', [attempt(0, 100), attempt(1, 60)]);
await syncLedger(storeA, firstLedger);
const restored = ledgerView(firstLedger);
check(
  'ledger: a restored session resumes from its offset (only +60)',
  restored.totals.total === 310 && firstLedger.sessions['session-2'].goneAt === null,
  JSON.stringify({ total: restored.totals.total, goneAt: firstLedger.sessions['session-2'].goneAt }),
);

// A shorter log is a rewrite, a migration or an external truncation — never a
// reason to hand credit back.
storeA.put('session-1', [attempt(0, 10)]);
const shrinkSync = await syncLedger(storeA, firstLedger);
check(
  'ledger: a shorter log keeps its credit and warns',
  ledgerView(firstLedger).totals.total === 310 && shrinkSync.warnings.length === 1,
  JSON.stringify({ total: ledgerView(firstLedger).totals.total, warnings: shrinkSync.warnings }),
);

// A reordered log cannot be advanced safely, so it is skipped rather than guessed.
storeA.put('session-3', [attempt(0, 1), attempt(1, 2)]);
await syncLedger(storeA, firstLedger);
const beforeReorder = ledgerView(firstLedger).totals.total;
storeA.put('session-3', [attempt(7, 1), attempt(8, 2), attempt(9, 4)]);
const reorderSync = await syncLedger(storeA, firstLedger);
check(
  'ledger: a reordered log is skipped with a warning',
  ledgerView(firstLedger).totals.total === beforeReorder && reorderSync.warnings.some((line) => line.includes('seq')),
  JSON.stringify({ total: ledgerView(firstLedger).totals.total, warnings: reorderSync.warnings }),
);

// Two Host processes: the row that consumed more events wins, so a stale writer
// can never rewind (and therefore re-credit) another process's work.
const ahead = normalizeLedger(JSON.parse(JSON.stringify(firstLedger)));
const behind = normalizeLedger(JSON.parse(JSON.stringify(firstLedger)));
ahead.sessions['session-1'].offset = 99;
behind.sessions['session-1'].offset = 1;
const merged = mergeLedgers(ahead, behind);
check('ledger: merging keeps the more advanced row', merged.sessions['session-1'].offset === 99, String(merged.sessions['session-1'].offset));
check('ledger: merging keeps the earlier createdAt', merged.createdAt === Math.min(ahead.createdAt, behind.createdAt));

// Two rows at the same offset hold the same credit, so the tie-break has to keep
// the fresher *description* of it. If a stale revision won a tie, every following
// sync would see "changed", re-open every log it had just finished reading, and
// the 24 ms idle tick would silently become a 3 s full scan.
const staleCopy = normalizeLedger(JSON.parse(JSON.stringify(firstLedger)));
const freshCopy = normalizeLedger(JSON.parse(JSON.stringify(firstLedger)));
staleCopy.sessions['session-1'].revision = 'r-stale';
staleCopy.sessions['session-1'].lastSeenAt = 1_000;
freshCopy.sessions['session-1'].revision = 'r-fresh';
freshCopy.sessions['session-1'].lastSeenAt = 5_000;
check(
  'ledger: a tie keeps the fresher revision (either merge order)',
  mergeLedgers(staleCopy, freshCopy).sessions['session-1'].revision === 'r-fresh' &&
    mergeLedgers(freshCopy, staleCopy).sessions['session-1'].revision === 'r-fresh',
  JSON.stringify([
    mergeLedgers(staleCopy, freshCopy).sessions['session-1'].revision,
    mergeLedgers(freshCopy, staleCopy).sessions['session-1'].revision,
  ]),
);
check(
  'ledger: a tie keeps the fresher gone mark',
  mergeLedgers(
    Object.assign(normalizeLedger(JSON.parse(JSON.stringify(staleCopy))), {}),
    (() => {
      const gone = normalizeLedger(JSON.parse(JSON.stringify(freshCopy)))
      gone.sessions['session-1'].goneAt = 9_000
      return gone
    })(),
  ).sessions['session-1'].goneAt === 9_000,
);

// Harness ids grew a 'session-' prefix partway through 2026, so one machine can
// hold logs of both vintages. A row filed under the other spelling is the same
// session: it must be renamed and keep its credit, never seen as a new session
// (which would re-credit its whole history and roughly double the total).
const renameStore = fakePersistence().put('session-old', [attempt(0, 7), attempt(1, 9)]);
const renameLedger = emptyLedger();
await syncLedger(renameStore, renameLedger);
renameStore.drop('session-old');
renameStore.put('old', [attempt(0, 7), attempt(1, 9)]);
const adoptSync = await syncLedger(renameStore, renameLedger);
check(
  'ledger: a session that changes id spelling keeps its credit',
  ledgerView(renameLedger).totals.total === 16 &&
    adoptSync.adopted === 1 &&
    adoptSync.gone === 0 &&
    Object.keys(renameLedger.sessions).join(',') === 'old',
  JSON.stringify({ sync: adoptSync, rows: Object.keys(renameLedger.sessions), total: ledgerView(renameLedger).totals.total }),
);

// The rename only lives in the writer's memory; the file still has the old key,
// and a plain merge would resurrect it. Collapsing the pair on merge is what keeps
// the saved document — not just the running process — free of double counting.
const twinLeft = emptyLedger();
await syncLedger(fakePersistence().put('abc', [attempt(0, 5), attempt(1, 6)]), twinLeft);
const twinRight = emptyLedger();
await syncLedger(fakePersistence().put('session-abc', [attempt(0, 5), attempt(1, 6)]), twinRight);
const twinMerged = mergeLedgers(twinLeft, twinRight);
check(
  'ledger: merging two spellings of one session leaves one row',
  Object.keys(twinMerged.sessions).length === 1 &&
    twinMerged.sessions['session-abc'] !== undefined &&
    ledgerView(twinMerged).totals.total === 11,
  JSON.stringify({ rows: Object.keys(twinMerged.sessions), total: ledgerView(twinMerged).totals.total }),
);

check(
  'ledger: a malformed document is repaired, not thrown',
  normalizeLedger({ sessions: { x: { offset: 'nonsense', days: { bad: null } } } }).sessions.x.offset === 0,
);
check('ledger: a non-object document becomes an empty ledger', Object.keys(normalizeLedger(null).sessions).length === 0);

// ---------------------------------------------------------------------------
// Storage location: 1.6.0 moved the ledger into the per-user data directory,
// out of $DSH_HOME and out of the plugin directory — the two things an
// uninstall removes. Path expectations are built with join() so the separators
// match whichever platform runs this check.
// ---------------------------------------------------------------------------
const fixtureHome = join('fixtures', 'home');
const fixtureWinHome = join('fixtures', 'win-home');
const fixtureLocalAppData = join('fixtures', 'localappdata');
const fixtureRoaming = join('fixtures', 'appdata');
const fixtureXdg = join('fixtures', 'xdg');
const fixtureOverride = join('fixtures', 'override', 'ledger.json');
const fixtureDshHome = join('fixtures', 'dsh');

const winLocal = resolveLedgerPath({ LOCALAPPDATA: fixtureLocalAppData }, fixtureWinHome, 'win32');
check(
  'ledger: win32 keeps the ledger under LOCALAPPDATA',
  winLocal === join(fixtureLocalAppData, 'dsh-usage', 'ledger.json'),
  winLocal,
);
const winRoaming = resolveLedgerPath({ APPDATA: fixtureRoaming }, fixtureWinHome, 'win32');
check(
  'ledger: win32 falls back to APPDATA',
  winRoaming === join(fixtureRoaming, 'dsh-usage', 'ledger.json'),
  winRoaming,
);
const winHomeOnly = resolveLedgerPath({}, fixtureWinHome, 'win32');
check(
  'ledger: win32 falls back to <home>/AppData/Local',
  winHomeOnly === join(fixtureWinHome, 'AppData', 'Local', 'dsh-usage', 'ledger.json'),
  winHomeOnly,
);
const macDefault = resolveLedgerPath({}, fixtureHome, 'darwin');
check(
  'ledger: darwin uses Application Support',
  macDefault === join(fixtureHome, 'Library', 'Application Support', 'dsh-usage', 'ledger.json'),
  macDefault,
);
const linuxXdg = resolveLedgerPath({ XDG_DATA_HOME: fixtureXdg }, fixtureHome, 'linux');
check('ledger: linux honours XDG_DATA_HOME', linuxXdg === join(fixtureXdg, 'dsh-usage', 'ledger.json'), linuxXdg);
const linuxDefault = resolveLedgerPath({}, fixtureHome, 'linux');
check(
  'ledger: linux defaults to ~/.local/share',
  linuxDefault === join(fixtureHome, '.local', 'share', 'dsh-usage', 'ledger.json'),
  linuxDefault,
);
const overrideBoth = [
  resolveLedgerPath(
    { DSH_USAGE_LEDGER: fixtureOverride, DSH_HOME: fixtureDshHome, LOCALAPPDATA: fixtureLocalAppData },
    fixtureWinHome,
    'win32',
  ),
  resolveLedgerPath(
    { DSH_USAGE_LEDGER: fixtureOverride, DSH_HOME: fixtureDshHome, XDG_DATA_HOME: fixtureXdg },
    fixtureHome,
    'linux',
  ),
];
check(
  'ledger: DSH_USAGE_LEDGER wins verbatim over every home and data root',
  overrideBoth.every((path) => path === fixtureOverride),
  JSON.stringify(overrideBoth),
);
const homeIgnored = [
  resolveLedgerPath({ DSH_HOME: fixtureDshHome }, fixtureWinHome, 'win32'),
  resolveLedgerPath({ DSH_HOME: fixtureDshHome }, fixtureHome, 'linux'),
];
check(
  'ledger: DSH_HOME no longer moves the ledger',
  homeIgnored[0] === winHomeOnly && homeIgnored[1] === linuxDefault,
  JSON.stringify(homeIgnored),
);

// The pre-1.6 ledgers are read where they were filed: $DSH_HOME/usage-ledger and
// ~/.dsh/usage-ledger. A home that moved leaves both worth looking at, and the
// canonical path must never be listed as a source of itself.
const legacyHome = join('fixtures', 'legacy-home');
const legacyDshHome = join('fixtures', 'legacy-dsh');
const legacyFileInDsh = join(legacyDshHome, 'usage-ledger', 'ledger.json');
const legacyFileInHome = join(legacyHome, '.dsh', 'usage-ledger', 'ledger.json');
const bothLegacy = resolveLegacyLedgerPaths({ DSH_HOME: legacyDshHome }, legacyHome, 'linux', linuxDefault);
check(
  'ledger: both pre-1.6 homes are searched when $DSH_HOME moved',
  bothLegacy.length === 2 && bothLegacy[0] === legacyFileInDsh && bothLegacy[1] === legacyFileInHome,
  JSON.stringify(bothLegacy),
);
const dedupedLegacy = resolveLegacyLedgerPaths({ DSH_HOME: join(legacyHome, '.dsh') }, legacyHome, 'linux', linuxDefault);
const defaultLegacy = resolveLegacyLedgerPaths({}, legacyHome, 'linux', linuxDefault);
check(
  'ledger: a $DSH_HOME that is already ~/.dsh is searched once',
  dedupedLegacy.length === 1 &&
    dedupedLegacy[0] === legacyFileInHome &&
    defaultLegacy.length === 1 &&
    defaultLegacy[0] === legacyFileInHome,
  JSON.stringify({ dedupedLegacy, defaultLegacy }),
);
const canonicalAsLegacy = resolveLegacyLedgerPaths({ DSH_HOME: legacyDshHome }, legacyHome, 'linux', legacyFileInDsh);
check(
  'ledger: the canonical path is never listed as a legacy source',
  canonicalAsLegacy.length === 1 && canonicalAsLegacy[0] === legacyFileInHome && !bothLegacy.includes(linuxDefault),
  JSON.stringify({ canonicalAsLegacy, bothLegacy }),
);

// ---------------------------------------------------------------------------
// Inheritance from the pre-1.6 locations, on explicit temp paths so no real home
// is ever read. The record beside the new ledger is what makes each old file
// merge once rather than on every boot — and what makes an intentional reset
// stick.
// ---------------------------------------------------------------------------
const inheritRoot = join(LEDGER_DIR, 'inherit');
const inheritHome = join(inheritRoot, 'home');
const legacyLedgerPath = join(inheritHome, '.dsh', 'usage-ledger', 'ledger.json');
const canonicalLedgerPath = join(inheritRoot, 'localappdata', 'dsh-usage', 'ledger.json');
const importRecordPath = resolveImportRecordPath(canonicalLedgerPath);
const ledgerFs = await import('node:fs');

/** One stored (JSON) day bucket: enough shape for ledgerView to fold it. */
const fixtureDay = (date, total) => {
  const bucket = emptyBucket(date);
  bucket.input = total;
  bucket.total = total;
  bucket.requests = 1;
  return bucket;
};
/** A ledger document holding one row per id, as a 1.5.x install left it. */
const fixtureLedger = (rows) => {
  const document = emptyLedger();
  document.createdAt = 111;
  document.updatedAt = 222;
  for (const [id, spec] of Object.entries(rows)) {
    document.sessions[id] = {
      project: 'fixtures',
      offset: spec.offset ?? 1,
      lastSeq: 0,
      revision: 'r1',
      sizeBytes: 100,
      firstSeenAt: 1,
      lastSeenAt: 2,
      goneAt: null,
      days: spec.days,
    };
  }
  return document;
};
const legacyOptions = { legacyPaths: [legacyLedgerPath] };

ledgerFs.mkdirSync(dirname(legacyLedgerPath), { recursive: true });
ledgerFs.writeFileSync(
  legacyLedgerPath,
  JSON.stringify(fixtureLedger({ 'session-old': { days: { '2026-10-01': fixtureDay('2026-10-01', 500) } } })),
  'utf8',
);
const inherited = loadLedgerWithInheritance(canonicalLedgerPath, legacyOptions);
check(
  'ledger inherit: a first load merges the pre-1.6 ledger',
  inherited.imported.length === 1 && inherited.imported[0] === legacyLedgerPath && inherited.wrote === true,
  JSON.stringify({ imported: inherited.imported, wrote: inherited.wrote }),
);
check(
  'ledger inherit: the inherited rows equal the old ledger totals',
  ledgerView(inherited.ledger).totals.total === 500 && inherited.ledger.createdAt === 111,
  JSON.stringify({ total: ledgerView(inherited.ledger).totals.total, createdAt: inherited.ledger.createdAt }),
);
check(
  'ledger inherit: the new ledger, its import record and the old file all stay',
  importRecordPath === join(dirname(canonicalLedgerPath), 'imported.json') &&
    ledgerFs.existsSync(canonicalLedgerPath) &&
    ledgerFs.existsSync(importRecordPath) &&
    ledgerFs.existsSync(legacyLedgerPath),
  JSON.stringify({
    canonical: ledgerFs.existsSync(canonicalLedgerPath),
    record: ledgerFs.existsSync(importRecordPath),
    legacy: ledgerFs.existsSync(legacyLedgerPath),
  }),
);
const inheritedAgain = loadLedgerWithInheritance(canonicalLedgerPath, legacyOptions);
check(
  'ledger inherit: an unchanged old ledger is skipped (fingerprint match)',
  inheritedAgain.imported.length === 0 &&
    inheritedAgain.wrote === false &&
    ledgerView(inheritedAgain.ledger).totals.total === 500,
  JSON.stringify({
    imported: inheritedAgain.imported,
    wrote: inheritedAgain.wrote,
    total: ledgerView(inheritedAgain.ledger).totals.total,
  }),
);
// A reset sticks: deleting the ledger and its .bak is how a user starts over, and
// the old file must not pour its history back in.
ledgerFs.rmSync(canonicalLedgerPath, { force: true });
ledgerFs.rmSync(canonicalLedgerPath + '.bak', { force: true });
const afterReset = loadLedgerWithInheritance(canonicalLedgerPath, legacyOptions);
check(
  'ledger inherit: a reset sticks (the record suppresses the old ledger)',
  afterReset.imported.length === 0 &&
    afterReset.wrote === false &&
    ledgerView(afterReset.ledger).totals.total === 0 &&
    !ledgerFs.existsSync(canonicalLedgerPath),
  JSON.stringify({
    imported: afterReset.imported,
    wrote: afterReset.wrote,
    total: ledgerView(afterReset.ledger).totals.total,
  }),
);
ledgerFs.rmSync(importRecordPath, { force: true });
const reimported = loadLedgerWithInheritance(canonicalLedgerPath, legacyOptions);
check(
  'ledger inherit: deleting the import record re-imports the old ledger',
  reimported.imported.length === 1 && ledgerView(reimported.ledger).totals.total === 500,
  JSON.stringify({ imported: reimported.imported, total: ledgerView(reimported.ledger).totals.total }),
);
// The old Harness can still be installed and advance its own ledger, so a changed
// old file is merged again — once, on top of what the row already holds.
const advancedLegacy = fixtureLedger({
  'session-old': {
    offset: 3,
    days: { '2026-10-01': fixtureDay('2026-10-01', 700), '2026-10-02': fixtureDay('2026-10-02', 200) },
  },
  'session-new': { offset: 1, days: { '2026-10-03': fixtureDay('2026-10-03', 50) } },
});
ledgerFs.writeFileSync(legacyLedgerPath, JSON.stringify(advancedLegacy), 'utf8');
const inheritedGrowth = loadLedgerWithInheritance(canonicalLedgerPath, legacyOptions);
check(
  'ledger inherit: an old ledger that was advanced later is merged again',
  inheritedGrowth.imported.length === 1 &&
    Object.keys(inheritedGrowth.ledger.sessions).sort().join(',') === 'session-new,session-old',
  JSON.stringify({ imported: inheritedGrowth.imported, rows: Object.keys(inheritedGrowth.ledger.sessions) }),
);
check(
  'ledger inherit: merging the advancement never double counts (500 -> 950)',
  ledgerView(inheritedGrowth.ledger).totals.total === 950,
  String(ledgerView(inheritedGrowth.ledger).totals.total),
);
// The seed tool's dry run: report what would be inherited, write nothing.
const dryCanonical = join(inheritRoot, 'dry', 'dsh-usage', 'ledger.json');
const dryRun = loadLedgerWithInheritance(dryCanonical, { legacyPaths: [legacyLedgerPath], write: false });
check(
  'ledger inherit: write:false reports the merge without writing anything',
  dryRun.imported.length === 1 &&
    !ledgerFs.existsSync(dryCanonical) &&
    !ledgerFs.existsSync(resolveImportRecordPath(dryCanonical)) &&
    ledgerView(dryRun.ledger).totals.total === 950,
  JSON.stringify({ imported: dryRun.imported, total: ledgerView(dryRun.ledger).totals.total }),
);
// A damaged old file must never block the load: it is skipped with a warning and
// retried next boot.
const guardCanonical = join(inheritRoot, 'guarded', 'dsh-usage', 'ledger.json');
saveLedgerFile(
  guardCanonical,
  fixtureLedger({ 'session-kept': { days: { '2026-10-01': fixtureDay('2026-10-01', 70) } } }),
);
const corruptLegacyPath = join(inheritRoot, 'corrupt-legacy.json');
ledgerFs.writeFileSync(corruptLegacyPath, '{ not json', 'utf8');
let corruptRead;
let corruptThrew;
try {
  corruptRead = loadLedgerWithInheritance(guardCanonical, { legacyPaths: [corruptLegacyPath] });
} catch (error) {
  corruptThrew = error;
}
check(
  'ledger inherit: a corrupt old ledger warns instead of throwing',
  corruptThrew === undefined && (corruptRead?.warnings?.length ?? 0) > 0 && corruptRead?.imported?.length === 0,
  corruptThrew === undefined ? JSON.stringify(corruptRead?.warnings).slice(0, 240) : corruptThrew.stack,
);
check(
  'ledger inherit: a corrupt old ledger leaves the canonical ledger intact',
  corruptRead !== undefined && ledgerView(corruptRead.ledger).totals.total === 70,
  String(corruptRead === undefined ? 'not loaded' : ledgerView(corruptRead.ledger).totals.total),
);
// A damaged canonical ledger with a good .bak is a normal crash outcome; the load
// has to recover the backup and still inherit the old rows.
const bakCanonical = join(inheritRoot, 'bakcase', 'dsh-usage', 'ledger.json');
const bakLegacyPath = join(inheritRoot, 'bakcase-legacy.json');
const bakDocument = fixtureLedger({ 'session-bak': { days: { '2026-10-01': fixtureDay('2026-10-01', 70) } } });
saveLedgerFile(bakCanonical, bakDocument);
saveLedgerFile(bakCanonical, bakDocument);
ledgerFs.writeFileSync(bakCanonical, '{ not json', 'utf8');
ledgerFs.writeFileSync(
  bakLegacyPath,
  JSON.stringify(fixtureLedger({ 'session-late': { days: { '2026-10-02': fixtureDay('2026-10-02', 500) } } })),
  'utf8',
);
const recoveredInherit = loadLedgerWithInheritance(bakCanonical, { legacyPaths: [bakLegacyPath] });
check(
  'ledger inherit: a corrupt ledger falls back to .bak and still inherits',
  ledgerView(recoveredInherit.ledger).totals.total === 570 &&
    recoveredInherit.imported.length === 1 &&
    recoveredInherit.warnings.some((line) => line.includes('.bak')),
  JSON.stringify({
    total: ledgerView(recoveredInherit.ledger).totals.total,
    imported: recoveredInherit.imported,
    warnings: recoveredInherit.warnings,
  }).slice(0, 300),
);

// ---------------------------------------------------------------------------
// Reinstall survival: everything an uninstall deletes is throwaway here — the
// Harness home and the plugin directory — and the ledger they cannot reach keeps
// every row.
// ---------------------------------------------------------------------------
const reinstallRoot = join(LEDGER_DIR, 'reinstall');
const throwawayHome = join(reinstallRoot, 'home');
const throwawayDshHome = join(reinstallRoot, 'dsh-home');
const throwawayPlugin = join(reinstallRoot, 'plugin');
for (const directory of [throwawayHome, throwawayDshHome, throwawayPlugin]) {
  ledgerFs.mkdirSync(join(directory, 'nested'), { recursive: true });
  ledgerFs.writeFileSync(join(directory, 'junk.txt'), 'junk', 'utf8');
}
ledgerFs.rmSync(throwawayHome, { recursive: true, force: true });
ledgerFs.rmSync(throwawayDshHome, { recursive: true, force: true });
ledgerFs.rmSync(throwawayPlugin, { recursive: true, force: true });
const survivedReinstall = loadLedgerWithInheritance(canonicalLedgerPath, {
  env: { DSH_HOME: throwawayDshHome },
  home: throwawayHome,
  platform: process.platform,
});
check(
  'ledger reinstall: deleting the Harness home and the plugin dir keeps the totals',
  ledgerView(survivedReinstall.ledger).totals.total === 950 &&
    survivedReinstall.imported.length === 0 &&
    survivedReinstall.wrote === false,
  JSON.stringify({
    total: ledgerView(survivedReinstall.ledger).totals.total,
    imported: survivedReinstall.imported,
    wrote: survivedReinstall.wrote,
  }),
);
/** Slash-normalised, case-folded path containment, independent of the host. */
const slashNormalized = (value) => String(value).replace(/\\/g, '/').toLowerCase();
const insideDirectory = (child, parent) =>
  slashNormalized(child) === slashNormalized(parent) ||
  slashNormalized(child).startsWith(slashNormalized(parent).replace(/\/+$/, '') + '/');
const defaultLedgerPath = resolveLedgerPath({}, throwawayHome, process.platform);
check(
  'ledger reinstall: the default ledger path is outside the plugin bundle',
  !insideDirectory(defaultLedgerPath, BUNDLE) && !insideDirectory(canonicalLedgerPath, BUNDLE),
  defaultLedgerPath,
);
check(
  'ledger reinstall: the default ledger path does not follow the Harness home',
  !insideDirectory(defaultLedgerPath, throwawayDshHome) &&
    defaultLedgerPath !== join(throwawayDshHome, 'usage-ledger', 'ledger.json'),
  defaultLedgerPath,
);

// The file layer: atomic write, .bak fallback, and merge-on-save.
const ledgerFile = join(LEDGER_DIR, 'store', 'ledger.json');
saveLedgerFile(ledgerFile, firstLedger);
const reloaded = loadLedgerFile(ledgerFile);
check(
  'ledger store: a save/load round trip keeps the totals',
  ledgerView(reloaded.ledger).totals.total === ledgerView(firstLedger).totals.total &&
    reloaded.warnings.length === 0,
  String(ledgerView(reloaded.ledger).totals.total),
);
const { existsSync } = await import('node:fs');
saveLedgerFile(ledgerFile, firstLedger);
check('ledger store: no temp file is left behind', !existsSync(ledgerFile + '.tmp'));
check('ledger store: the previous file is kept as .bak', existsSync(ledgerFile + '.bak'));
const { writeFileSync } = await import('node:fs');
writeFileSync(ledgerFile, '{ not json', 'utf8');
const recoveredFile = loadLedgerFile(ledgerFile);
check(
  'ledger store: a corrupt file falls back to .bak',
  ledgerView(recoveredFile.ledger).totals.total === ledgerView(firstLedger).totals.total &&
    recoveredFile.warnings.length > 0,
  JSON.stringify(recoveredFile.warnings),
);
const olderCopy = normalizeLedger(JSON.parse(JSON.stringify(firstLedger)));
olderCopy.sessions['session-1'].offset = 0;
olderCopy.sessions['session-1'].days = {};
const written = saveLedgerMerged(ledgerFile, olderCopy);
check(
  'ledger store: saving an older copy cannot rewind the file',
  written.sessions['session-1'].offset === firstLedger.sessions['session-1'].offset &&
    ledgerView(loadLedgerFile(ledgerFile).ledger).totals.total === ledgerView(firstLedger).totals.total,
  JSON.stringify({ offset: written.sessions['session-1'].offset, total: ledgerView(loadLedgerFile(ledgerFile).ledger).totals.total }),
);

// A recovery from .bak must not cost the backup. The rescued ledger is written
// back over the damaged primary, but refreshing .bak from that damaged primary
// would replace the safety net with the very damage it just rescued — leaving the
// next crash with nothing to recover from.
const recoveryFile = join(LEDGER_DIR, 'store', 'recovery', 'ledger.json');
const backupDocument = fixtureLedger({ 'session-backup': { days: { '2026-10-01': fixtureDay('2026-10-01', 70) } } });
const rescuedDocument = fixtureLedger({ 'session-rescued': { days: { '2026-10-02': fixtureDay('2026-10-02', 200) } } });
saveLedgerFile(recoveryFile, backupDocument);
saveLedgerFile(recoveryFile, backupDocument);
writeFileSync(recoveryFile, '{ not json', 'utf8');
const rescuedLoad = loadLedgerFile(recoveryFile);
saveLedgerFile(recoveryFile, rescuedDocument);
const rescuedPrimary = loadLedgerFile(recoveryFile);
let rescuedBackup;
try {
  rescuedBackup = normalizeLedger(JSON.parse(readFileSync(recoveryFile + '.bak', 'utf8')));
} catch {
  rescuedBackup = undefined;
}
check(
  'ledger store: a save after a .bak recovery keeps the backup readable and good',
  ledgerView(rescuedLoad.ledger).totals.total === 70 &&
    rescuedLoad.warnings.length > 0 &&
    ledgerView(rescuedPrimary.ledger).totals.total === 200 &&
    rescuedBackup !== undefined &&
    ledgerView(rescuedBackup).totals.total === 70,
  JSON.stringify({
    recovered: ledgerView(rescuedLoad.ledger).totals.total,
    primary: ledgerView(rescuedPrimary.ledger).totals.total,
    backup: rescuedBackup === undefined ? 'unparseable' : ledgerView(rescuedBackup).totals.total,
  }),
);

// The ordinary path still refreshes the backup: once the primary is a healthy
// ledger again, a save leaves the previous good primary in .bak.
const refreshFile = join(LEDGER_DIR, 'store', 'refresh', 'ledger.json');
const previousDocument = fixtureLedger({ 'session-previous': { days: { '2026-10-01': fixtureDay('2026-10-01', 40) } } });
const latestDocument = fixtureLedger({ 'session-latest': { days: { '2026-10-02': fixtureDay('2026-10-02', 60) } } });
saveLedgerFile(refreshFile, previousDocument);
saveLedgerFile(refreshFile, latestDocument);
const refreshedPrimary = loadLedgerFile(refreshFile);
const refreshedBackup = loadLedgerFile(refreshFile + '.bak');
check(
  'ledger store: a healthy save still refreshes .bak to the previous primary',
  ledgerView(refreshedPrimary.ledger).totals.total === 60 &&
    refreshedBackup.warnings.length === 0 &&
    ledgerView(refreshedBackup.ledger).totals.total === 40,
  JSON.stringify({
    primary: ledgerView(refreshedPrimary.ledger).totals.total,
    backup: ledgerView(refreshedBackup.ledger).totals.total,
  }),
);

// A vanished session has to stay marked once the ledger is persisted. The sync
// marks goneAt without consuming an event, so the row's lastSeenAt is the only
// thing that makes merge-on-save keep the mark instead of the on-disk copy that
// still says goneAt: null — without it the mark is dropped and re-made every sync.
const goneFile = join(LEDGER_DIR, 'store', 'gone', 'ledger.json');
const goneStore = fakePersistence().put('session-gone', [attempt(0, 5)]);
let goneLedger = emptyLedger();
await syncLedger(goneStore, goneLedger);
goneStore.drop('session-gone');
const goneSync = await syncLedger(goneStore, goneLedger);
goneLedger = saveLedgerMerged(goneFile, goneLedger);
const goneReloaded = loadLedgerFile(goneFile).ledger;
check(
  'ledger store: a gone mark survives the merge-on-save',
  goneSync.gone === 1 &&
    typeof goneReloaded.sessions['session-gone']?.goneAt === 'number' &&
    ledgerView(goneReloaded).live.sessions === 0 &&
    ledgerView(goneReloaded).totals.total === 5,
  JSON.stringify({
    syncGone: goneSync.gone,
    inMemory: goneLedger.sessions['session-gone']?.goneAt,
    onDisk: goneReloaded.sessions['session-gone']?.goneAt,
    live: ledgerView(goneReloaded).live.sessions,
  }),
);
await syncLedger(goneStore, goneLedger);
check(
  'ledger store: the persisted gone row stays gone across syncs',
  ledgerView(goneLedger).live.sessions === 0 && typeof goneLedger.sessions['session-gone']?.goneAt === 'number',
  JSON.stringify({ live: ledgerView(goneLedger).live.sessions }),
);

// ---------------------------------------------------------------------------
// B. Browser half
// ---------------------------------------------------------------------------
console.log('\nB. browser half (client.js)');

let loaded;
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      loaded = definition;
    },
  },
};
const source = readFileSync(`${BUNDLE}/client.js`, 'utf8');
// Evaluate the bundle in this context: it only touches `window` at load time.
new Function(`${source}\nreturn window.__ModuleLoader__.__last;`)();
check('bundle registers a factory', loaded !== undefined && typeof loaded.factory === 'function');
check('factory id equals the package name', loaded?.id === '@local/dsh-usage', String(loaded?.id));

const react = {
  createElement(tag, props, ...children) {
    return { $$typeof: 'element', tag, props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children } };
  },
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useRef: (initial) => ({ current: initial }),
  useCallback: (fn) => fn,
  Fragment: 'Fragment',
};
const clientModule = loaded.factory((name) => {
  if (name === 'react') return react;
  throw new Error(`unexpected require: ${name}`);
});
check('client exports apply()', typeof clientModule.apply === 'function');
check("client injects ['slots']", Array.isArray(clientModule.inject) && clientModule.inject.includes('slots'));

const registrations = [];
const injections = [];
const clientCtx = {
  effect(factory) {
    return factory();
  },
  get(name) {
    return name === 'locale' ? undefined : undefined; // no locale service: bundled dictionary is used
  },
  slots: {
    inject(ownerKey, register) {
      injections.push(ownerKey);
      register();
    },
    register(options, component) {
      registrations.push({ options, component });
      return () => {};
    },
  },
};
let clientThrew;
try {
  clientModule.apply(clientCtx);
} catch (error) {
  clientThrew = error;
}
check('client apply() does not throw without a locale service', clientThrew === undefined, clientThrew?.stack);
check('injected into settings.section', injections.join(',') === 'settings.section', injections.join(','));
check('registered exactly one section', registrations.length === 1, String(registrations.length));
const entry = registrations[0];
check("section id is 'usage'", entry?.options?.id === 'usage', String(entry?.options?.id));
check('order 25 (below Agent 预设 at 20)', entry?.options?.order === 25, String(entry?.options?.order));
check('label is a thunk (re-read on locale change)', typeof entry?.options?.label === 'function');
const label = entry.options.label();
check('label renders an element', label !== null && typeof label === 'object' && label.tag === 'span', JSON.stringify(label)?.slice(0, 120));
check('label carries its own glyph', label?.props?.children?.[0]?.tag === 'svg');
check('label carries the nav text', label?.props?.children?.[1]?.props?.children?.length > 0, JSON.stringify(label?.props?.children?.[1]));
check('component is a function', typeof entry.component === 'function');

// Contract tripwire: the host labels a kept card `stale`, so the browser half has
// to have a state for it, or a failed read would render as a healthy card.
check(
  'client renders the stale state the host emits',
  source.includes('provider.stale === true') && source.includes('statusStale') && source.includes('staleHint'),
  'client.js no longer handles provider.stale',
);
// Contract tripwire: OpenCode Go's three windows are three separate caps that
// read the same percentage on a quiet account, so the share-collapse rule must
// be scoped to the provider, or a fresh account would render one window of three.
check(
  'client keeps opencode-go windows separate at equal shares',
  source.includes("dedupeWindows(provider.windows, provider.id)") && source.includes("id !== 'opencode-go'"),
  'client.js no longer scopes the identical-share collapse to the provider',
);

// ---------------------------------------------------------------------------
// C. Activity heatmap — the parts that fail silently
//
// A heatmap stuck in one shade still renders, and a week fold that sums the
// wrong seven days still prints eight-digit numbers. These assert the scale, the
// folds and one rendered tree, because the visual check cannot be automated here.
// ---------------------------------------------------------------------------
console.log('\nC. activity heatmap');

const internals = clientModule.__internals;
check(
  '__internals exposes the pure helpers (test seam only)',
  internals !== undefined && typeof internals.thresholdsOf === 'function',
  typeof internals,
);

const {
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
} = internals;

// The window is six whole months (May–Oct 2026 for an October anchor), ending with the anchor month's last day.
const range = windowRange({ year: 2026, month: 10 });
check('window starts on the first day of the sixth month back', range.startKey === '2026-05-01', range.startKey);
check('window ends on the last day of the anchor month', range.endKey === '2026-10-31', range.endKey);

const dayCols = dayColumns(range.startKey, range.endKey);
const inWindow = dayCols.flat().filter((cell) => cell.inRange);
check('day columns are whole weeks of seven cells', dayCols.every((week) => week.length === 7), String(dayCols.length));
check('day columns start on a Monday', dayCols[0][0].date.getDay() === 1, dayCols[0][0].key);
check('day columns end on a Sunday', dayCols[dayCols.length - 1][6].date.getDay() === 0, dayCols[dayCols.length - 1][6].key);
check('every day of the window appears exactly once', inWindow.length === 184, String(inWindow.length));
check('the grid pads the days before the window instead of shifting it', dayCols[0][0].inRange === false && inWindow[0].key === '2026-05-01', inWindow[0].key);

const weekCols = weekColumns(range.startKey, range.endKey);
check('week columns are keyed by their Monday', weekCols.every((week) => week.startKey === week.key), weekCols[0].key);
check('week columns start at the Monday of the window start', weekCols[0].startKey === '2026-04-27', weekCols[0].startKey);
check('the clipped first week keeps only its in-window days', weekCols[0].days.length === 3, String(weekCols[0].days.length));
check(
  'weekly and daily modes cover the same days',
  weekCols.reduce((sum, week) => sum + week.days.length, 0) === inWindow.length,
  `${String(weekCols.reduce((sum, week) => sum + week.days.length, 0))} vs ${String(inWindow.length)}`,
);
check('weekKeyOf folds a Friday onto its Monday', weekKeyOf('2026-10-23') === '2026-10-19', weekKeyOf('2026-10-23'));
check('weekKeyOf leaves a Monday where it is', weekKeyOf('2026-10-19') === '2026-10-19', weekKeyOf('2026-10-19'));
check('isoWeek: 2026-01-01 is week 1', isoWeek(new Date(2026, 0, 1)) === 1, String(isoWeek(new Date(2026, 0, 1))));
check('isoWeek: 2025-12-29 belongs to week 1 of 2026', isoWeek(new Date(2025, 11, 29)) === 1, String(isoWeek(new Date(2025, 11, 29))));
check('isoWeek: 2026-10-23 is week 43', isoWeek(new Date(2026, 9, 23)) === 43, String(isoWeek(new Date(2026, 9, 23))));

const thresholds = thresholdsOf([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
check(
  'three ascending cut-offs for four shades',
  thresholds.length === 3 && thresholds[0] < thresholds[1] && thresholds[1] < thresholds[2],
  JSON.stringify(thresholds),
);
check('a day with nothing recorded is unshaded', levelOf(0, thresholds) === 0, String(levelOf(0, thresholds)));
check('the lightest shade starts above zero', levelOf(1, thresholds) === 1, String(levelOf(1, thresholds)));
check('the darkest shade is reachable', levelOf(10_000, thresholds) === 4, String(levelOf(10_000, thresholds)));
check(
  'the scale never runs backwards',
  [1, thresholds[0], thresholds[1], thresholds[2], 10_000]
    .map((value) => levelOf(value, thresholds))
    .every((level, index, all) => index === 0 || level >= all[index - 1]),
);
const flat = thresholdsOf([5, 5, 5, 5]);
check('a window where every day is equal collapses to one shade', flat.length === 1 && levelOf(5, flat) === 1, JSON.stringify(flat));
check('metricOf shades by total or by cache hits', metricOf({ total: 100, cacheRead: 70 }, 'total') === 100 && metricOf({ total: 100, cacheRead: 70 }, 'cache') === 70);
check('a day with no bucket shades as empty', metricOf(undefined, 'total') === 0 && metricOf(undefined, 'cache') === 0);

const folded = aggregateBuckets(
  [
    { date: '2026-10-19', input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10, requests: 1, providers: { kimi: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10, requests: 1 } } },
    { date: '2026-10-20', input: 5, output: 6, cacheRead: 7, cacheWrite: 8, total: 26, requests: 2, providers: { kimi: { input: 5, output: 6, cacheRead: 7, cacheWrite: 8, total: 26, requests: 2 } } },
  ],
  '2026-10-19',
);
check('a week sums every field', folded?.total === 36 && folded?.cacheRead === 10 && folded?.requests === 3, JSON.stringify(folded)?.slice(0, 160));
check('a week keeps the provider split', folded?.providers?.kimi?.total === 36 && folded?.providers?.kimi?.requests === 3, JSON.stringify(folded?.providers)?.slice(0, 160));
check('a week with no records at all is undefined', aggregateBuckets([undefined, undefined], '2026-10-19') === undefined);

const streak = streaks(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'], '2026-10-23');
check('a run ending today is the current streak', streak.current === 4 && streak.longest === 4, JSON.stringify(streak));
const gapped = streaks(['2026-10-19', '2026-10-20', '2026-10-22'], '2026-10-22');
check('a gap ends the run', gapped.current === 1 && gapped.longest === 2, JSON.stringify(gapped));
const yesterday = streaks(['2026-10-22'], '2026-10-23');
check('a run that ended yesterday still counts as current', yesterday.current === 1, JSON.stringify(yesterday));
check('addDays crosses a month boundary on calendar parts', dateKey(addDays(new Date(2026, 9, 31), 1)) === '2026-11-01', dateKey(addDays(new Date(2026, 9, 31), 1)));

const ticks = monthTicks(dayCols);
check('month ticks label all six months', ticks.length === 6, String(ticks.length));
check('month ticks are in column order', ticks.every((tick, index) => index === 0 || tick.column > ticks[index - 1].column), JSON.stringify(ticks));
check('the first tick is the window start month', ticks[0].label === '5月', ticks[0].label);

/** Depth-first walk over the stub renderer's element tree. */
const walk = (node, visit) => {
  if (node === null || node === undefined || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  visit(node);
  walk(node.props?.children, visit);
};

const today = dateKey(new Date());
const withData = [{ date: today, input: 1, output: 2, cacheRead: 3, cacheWrite: 0, total: 6, requests: 4, providers: {} }];
const liveRange = windowRange({ year: new Date().getFullYear(), month: new Date().getMonth() + 1 });
const expectedDays = dayColumns(liveRange.startKey, liveRange.endKey).flat().filter((cell) => cell.inRange).length;

const dayTree = Activity({ days: withData, grain: 'day', onGrain: () => {}, selected: { grain: 'day', key: today }, onSelect: () => {} });
const cells = [];
const tabs = [];
const swatches = [];
walk(dayTree, (node) => {
  const className = node.props?.className;
  if (typeof className === 'string' && className.includes('dsu-cell')) cells.push(node);
  if (node.props?.role === 'tab') tabs.push(node);
  if (typeof className === 'string' && className.includes('dsu-swatch')) swatches.push(node);
});
check('the daily grid renders one cell per day in the window', cells.length === expectedDays, `${String(cells.length)} vs ${String(expectedDays)}`);
const selectedCell = cells.find((node) => node.props.className.includes('dsu-cellSelected'));
check('the selected day is drawn as selected', selectedCell !== undefined);
check(
  'a cell names both figures for screen readers',
  selectedCell?.props['aria-label']?.includes('总用量 6') && selectedCell?.props['aria-label']?.includes('缓存命中 3'),
  selectedCell?.props['aria-label'],
);
check('a day with data takes a shade', selectedCell?.props.className.includes('dsu-cellL1'), selectedCell?.props.className);
const emptyCell = cells.find((node) => node.props.className.includes('dsu-cellL0') && !node.props.className.includes('dsu-cellToday'));
check('a day with no records says so', emptyCell?.props['aria-label']?.includes('没有记录'), emptyCell?.props['aria-label']);
check('both toggles are present (grain and metric)', tabs.length === 4, String(tabs.length));
check('the legend shows five steps', swatches.length === 5, String(swatches.length));
check('the legend follows the active metric', swatches[1].props.className.includes('dsu-swatchTotal'), swatches[1].props.className);

const weekTree = Activity({ days: withData, grain: 'week', onGrain: () => {}, selected: { grain: 'week', key: weekKeyOf(today) }, onSelect: () => {} });
const weekCells = [];
walk(weekTree, (node) => {
  if (typeof node.props?.className === 'string' && node.props.className.includes('dsu-cell')) weekCells.push(node);
});
const expectedWeeks = weekColumns(liveRange.startKey, liveRange.endKey).length;
check('the weekly grid renders one cell per week in the window', weekCells.length === expectedWeeks, `${String(weekCells.length)} vs ${String(expectedWeeks)}`);

const weekDetail = SelectionDetail({ grain: 'week', point: '2026-10-19', bucket: folded });
const weekText = [];
walk(weekDetail, (node) => {
  if (typeof node.props?.children === 'string') weekText.push(node.props.children);
  if (typeof node.props?.children === 'number') weekText.push(String(node.props.children));
});
const weekBlob = weekText.join(' | ');
check('the week detail names the span and the ISO week', weekBlob.includes('选中周') && weekBlob.includes('第 43 周'), weekBlob.slice(0, 160));
check('the week detail prints the summed usage', weekBlob.includes('36'), weekBlob.slice(0, 160));

// The strip carries today, the window totals, the busiest day and the run of days.
const stripTree = StatStrip({
  today: { date: today, input: 1, output: 2, cacheRead: 3, cacheWrite: 0, total: 6, requests: 4, providers: {} },
  totals: { input: 10, output: 20, cacheRead: 30, cacheWrite: 0, total: 60, requests: 40 },
  days: [
    { date: dateKey(addDays(new Date(), -1)), input: 0, output: 0, cacheRead: 100, cacheWrite: 0, total: 100, requests: 1, providers: {} },
    { date: today, input: 1, output: 2, cacheRead: 3, cacheWrite: 0, total: 6, requests: 4, providers: {} },
  ],
});
const stripText = [];
const stripStats = [];
walk(stripTree, (node) => {
  if (typeof node.props?.className === 'string' && node.props.className.split(' ').includes('dsu-stat')) stripStats.push(node);
  if (typeof node.props?.children === 'string') stripText.push(node.props.children);
});
const stripBlob = stripText.join(' | ');
check('the strip shows six figures', stripStats.length === 6, String(stripStats.length));
check('the strip names today and the window totals', stripBlob.includes('6') && stripBlob.includes('60'), stripBlob.slice(0, 200));
check('the strip reports the busiest day', stripBlob.includes('100'), stripBlob.slice(0, 200));
check('the strip counts the run of days', stripBlob.includes('2 天'), stripBlob.slice(0, 200));
check('no figure falls back to NaN or undefined', !stripBlob.includes('NaN') && !stripBlob.includes('undefined'), stripBlob.slice(0, 200));

// The ledger caption is what makes "all time" larger than "on disk" legible:
// without it, a total that survives a deletion looks like a bug.
const ledgerStrip = StatStrip({
  today: { date: today, total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0, providers: {} },
  totals: { input: 1, output: 1, cacheRead: 1, cacheWrite: 0, total: 3, requests: 1 },
  days: [],
  available: true,
  scan: {
    source: 'ledger',
    since: Date.now() - 86_400_000,
    updatedAt: Date.now(),
    gone: 3,
    live: { sessions: 149, total: 1234, cacheRead: 0, requests: 2 },
  },
});
const ledgerText = [];
let ledgerCaptionNode;
walk(ledgerStrip, (node) => {
  if (typeof node.props?.className === 'string' && node.props.className.includes('dsu-stripLedger')) ledgerCaptionNode = node;
  if (typeof node.props?.children === 'string') ledgerText.push(node.props.children);
});
const ledgerBlob = ledgerText.join(' | ');
check('the strip renders the ledger caption', ledgerCaptionNode !== undefined);
check('the caption names the ledger start and its last sync', ledgerBlob.includes('账本自') && ledgerBlob.includes('更新于'), ledgerBlob.slice(0, 240));
check('the caption prints the on-disk figure and session count', ledgerBlob.includes('1234') && ledgerBlob.includes('149'), ledgerBlob.slice(0, 240));
check('the caption counts the deleted sessions', ledgerBlob.includes('已删除 3 个会话'), ledgerBlob.slice(0, 240));
// The tooltip is the only place the file is named, and naming it is what makes
// "this survives an uninstall" checkable — but a payload without a path must not
// render an empty second line either.
const fixtureLedgerFile = join('fixtures', 'dsh-usage', 'ledger.json');
const captionNote = typeof ledgerCaptionNode?.props?.title === 'string' ? ledgerCaptionNode.props.title : undefined;
check(
  'the caption tooltip is just the ledger note when no path is reported',
  captionNote !== undefined &&
    captionNote.length > 0 &&
    !captionNote.includes('\n') &&
    !captionNote.includes(fixtureLedgerFile),
  String(captionNote).slice(0, 240),
);
const addressedStrip = StatStrip({
  today: {},
  totals: {},
  days: [],
  available: true,
  scan: { source: 'ledger', ledgerPath: fixtureLedgerFile },
});
let addressedCaptionNode;
walk(addressedStrip, (node) => {
  if (typeof node.props?.className === 'string' && node.props.className.includes('dsu-stripLedger')) addressedCaptionNode = node;
});
const addressedTitle = addressedCaptionNode?.props?.title;
check(
  'the caption tooltip carries the ledger note and the reported file path',
  typeof addressedTitle === 'string' &&
    typeof captionNote === 'string' &&
    addressedTitle.includes(captionNote) &&
    addressedTitle.includes(fixtureLedgerFile) &&
    addressedTitle !== captionNote,
  String(addressedTitle).slice(0, 300),
);
const plainStrip = StatStrip({ today: {}, totals: {}, days: [], available: true });
const plainText = [];
walk(plainStrip, (node) => {
  if (typeof node.props?.className === 'string' && node.props.className.includes('dsu-stripLedger')) plainText.push('caption');
});
check('no caption when the host reports no ledger', plainText.length === 0);

delete globalThis.window;
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;