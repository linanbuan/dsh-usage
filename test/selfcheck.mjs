// Activation self-check for the 用量 bundle: load both halves exactly as the
// Host/Client plugin systems do, apply them against stub contexts, and exercise
// both routes offline (no credentials, no session persistence).
//
//   node test/selfcheck.mjs
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUNDLE = dirname(dirname(fileURLToPath(import.meta.url)));
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

delete globalThis.window;
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;