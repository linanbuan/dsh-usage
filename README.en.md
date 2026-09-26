# Usage · dsh-usage

[中文](README.md) | [English](README.en.md)

> A **Usage** page inside the DeepSeek Harness (DSH) settings panel: token usage and
> cache hits for today and all time, a history calendar, and the quotas and reset
> times of the APIs wired into this Harness.

![Usage panel](docs/panel-light.png)

The plugin registers one `settings.section` named 用量 (Usage), placed directly below
**Agent 预设** (Agent presets), with its own hand-drawn bar-chart glyph.

## Install

This is a standard DSH bundle (`package.json` declares `dsh.bundle.patch` and
`dsh.client`). Put this directory anywhere and install it into the current profile:

```text
plugin_manager   action: install_bundle   target: <absolute path to this directory>
```

That runs the pnpm install and writes `@local/dsh-usage` into the profile's
`dsh.profile.bundles`. The equivalent manual form:

```bash
dsh plugin --profile <your profile> add <absolute path to this directory>
```

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
| Today / All time | Total usage and cache hits, plus input / output / cache-write / billed-call detail |
| History | A month calendar whose cells draw two proportional bars per day (total usage, cache hits); pick a day for its exact figures; step through months |
| API quotas | `kimi-coding` (5-hour window, monthly total) and `commandcode` (5-hour, weekly, monthly) usage, caps and reset times |

Token counts are always shown as **complete integers** — never abbreviated to `K` / `M` / `B`.

![API quotas](docs/panel-quota.png)

## Speed

The panel never waits. The two halves differ in cost by three orders of magnitude, so
they are requested separately:

| Half | Measured |
|---|---|
| Local fold (reading this machine's session logs) | tens of milliseconds |
| Provider quota (one overseas round trip) | 2 to 8 seconds |

Therefore:

- the cards and the calendar paint as soon as the local data arrives, and the quota
  section fills in behind them;
- all four provider requests go out **concurrently** (it used to be two serialized
  groups — kimi, then command code — which paid the round trip twice);
- a quota answer is served as-is while it is under 90 seconds old, and once stale it is
  returned immediately while a background refresh runs (`refreshing` tells the page to
  come back for the fresh answer);
- activation warms both caches 2.5 seconds after boot and revalidates every 5 minutes,
  so **opening Settings is usually a cache hit**;
- session logs are folded incrementally by `revision`: a log that merely grew costs one
  tail read instead of a full re-read.

![Dark theme](docs/panel-dark.png)

## Accounting

- Total usage = input + cache read + cache write + output, matching
  `@deepseek-ai/dsh-token-meter`: a billed record's `inputTokens` is its **uncached**
  prompt, so cache hits are never double counted.
- Cache hits are that accounting's cache-read share.
- Days are bucketed by **local timezone** calendar day.
- Data comes from the Host's `sessionPersistence` service — the compressed on-disk
  session format is never re-implemented here.

## Layout

```
package.json       bundle manifest (dsh.bundle.patch + dsh.client)
cordis.patch.yml   one insert row: mounts the host half
index.js           host half: /api/usage/usage, /api/usage/quota, /api/usage/report
client.js          browser half: the settings.section page (build-free lazy CJS bundle)
icon.svg           bundle icon
locale/*.json      plugin-manager title and description
docs/              screenshots taken from the running UI
test/selfcheck.mjs activation self-check
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
parsers, that the four requests really do overlap, that the local half touches no
network, and the section's id / order / label / component type. Exit code 0 means all
checks passed.

## Credits

The technique of drawing one's own glyph in the settings rail and retiring the shell's
fallback icon follows the same approach as the MIT-licensed
[`commandcode-dash`](https://github.com/Momonaka/commandcode-dash).

## License

[MIT](LICENSE) © linanbuan
