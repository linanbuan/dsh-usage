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

delete globalThis.window;
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;
