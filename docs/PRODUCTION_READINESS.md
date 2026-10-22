# Production readiness — modelharbor

Tested commit: `0a4c844` (audit/production-readiness; this file was added in
the following docs-only commit). Date: 2026-10-22.

## Scope and architecture

A Node HTTP server (`server/`, no framework) that reads a provider config,
health-checks every model on a TTL, routes tasks to the highest-priority
healthy model with live failover, and records usage/cost; plus a Vite + React
dashboard (`web/`) that talks to it through `/api`. Adapters: `mock`
(deterministic, no network), `openai-compatible`, `ollama`.

## Platforms and prerequisites

- Node 20+ (CI uses Node 20), npm workspaces. Verified locally on macOS 27
  (Apple M5), Node 24.19.0, npm 11.17.0. Windows not run locally.
- Mock mode needs nothing else. Live mode needs real provider endpoints and
  keys, which were **not** available or used in this audit.

## Clean-clone verification

| Step (README, literally) | Exit / result |
|---|---|
| `npm install` | 0 |
| `npm run build` | 0 |
| `npm run dev:server` | listening on `127.0.0.1:4180`, read the root `modelharbor.config.json` |
| `npm run dev:web` | `GET http://localhost:5180/` → 200 |
| Browser: open dashboard, press **Run** | headless Chromium: 8 models with health, routed run returned mock text, usage panel populated, no console errors, no requests to other origins |
| Going live: `cp … modelharbor.config.local.json`, `MODELHARBOR_CONFIG=./modelharbor.config.local.json npm run dev:server` | server resolved the file at the repo root; `git status` clean (file ignored). Stopped before any request, so no provider call was made |
| `npm run test` / `test:coverage` / `lint` / `typecheck` | 144 passed; all exit 0 |

Before the fix, `npm run dev:server` in a clone exited with
`ENOENT … server/modelharbor.config.json`.

## Commands and results (CI steps)

| Check | Command | Before | After |
|---|---|---|---|
| Install | `npm ci` | 0 | 0 |
| Typecheck | `npm run typecheck` | 0 | 0 |
| Lint | `npm run lint` | 0 | 0 |
| Tests + coverage | `npm run test:coverage` | 0 — 8 files, 129 passed | 0 — 9 files, 144 passed, 0 failed, 0 skipped; statements 98.54%, branches 91.76% |
| Build | `npm run build` | 0 | 0 |
| Web bundle key scan | `grep -E 'apiKey|sk-' web/dist/assets/*` | — | only CSS/text false positives (`task-tab`, "Task-aware") |
| Runtime dependency audit | `npm audit --omit=dev` | 0 | 0 |
| Full audit | `npm audit` | dev-only critical/high (vitest 1.x chain, vite 5, typescript-eslint 7 chain) | brace-expansion, source-map-js fixed; the rest need major upgrades, not done |

## CI status

Default branch: success (latest `main` run). Audit branch: pending until pushed.

## Bugs found and fixed

1. **Any website could spend the operator's provider budget.** The server
   sent `access-control-allow-origin: *`, accepted `text/plain` POST bodies,
   and listened on all interfaces. Reproduced against the original code: a
   `text/plain` POST with `Origin: https://evil.test` returned 200 with
   `access-control-allow-origin: *` and executed the prompt; `lsof` showed
   `*:4191`. Fixed: loopback bind, opt-in single-origin CORS, JSON content
   type required, 1 MiB body limit, 400 on bad JSON.
2. **Key fragments could reach the browser.** Provider error bodies (which can
   echo the key or a masked form of it) were passed straight into health
   errors and failover reasons; `/api/config` returned `baseUrl` verbatim
   (credentials in userinfo/query). Fixed with `redactSecrets`/`redactUrl`.
3. **Quickstart crash** (`npm run dev:server` ENOENT). Fixed with
   INIT_CWD-relative path resolution.
4. **README told users to put keys in a tracked file.** Now `*.local.json`,
   gitignored.

Regression tests: `server/test/security.test.ts` (18 tests). Two existing
tests in `api.test.ts` asserted the wildcard CORS header and were changed,
with a comment explaining why.

## Security review

- Secret scan of tree and history: no real credentials. The initial commit's
  `modelharbor.config.example.json` contains a key-prefix placeholder (an
  Anthropic-style prefix followed by `...`) that pattern scanners flag — not a
  secret, no rotation needed; HEAD now uses neutral placeholders.
- Keys: read only by the server adapters; never logged (startup logs print
  the config path only); absent from the web bundle.
- Tests make no real provider calls: HTTP adapter tests stub `fetch` and are
  labelled as mocked; a suite-wide guard rejects non-loopback fetches.
- XSS: the dashboard renders all data through React (no `innerHTML`).
- SSRF: `baseUrl` comes only from the operator's config file.
- CI token `contents: read`; actions pinned to tags (unchanged).

## Known limitations and risks

- No authentication or rate limiting; safe only on loopback or behind an
  authenticating proxy.
- The `openai-compatible` and `ollama` adapters have not been run against real
  services here (no keys / no Ollama on this machine); only mocked HTTP.
- Health checks for live providers send a real 1-token completion and cost a
  little money per model per TTL.
- Remaining dev-only advisories need vitest, vite and typescript-eslint major
  upgrades.

## Acceptance checklist

| # | Item | Expected | Command / test | Result | Actual | Reference |
|---|---|---|---|---|---|---|
| 1 | Keys never in `/api/config` | no `apiKey`, no URL credentials | `security.test.ts` "keys never leave the server", `api.test.ts` | pass | | `config.ts`, `redact.ts` |
| 2 | Keys never in error text sent to the UI | redacted in health + failover | `security.test.ts` (mocked HTTP) | pass | | `providers/*.ts`, `execute.ts` |
| 3 | Keys never in the web bundle | no key strings | bundle grep | pass | false positives only | `web/` |
| 4 | Keys never logged | startup logs path only | code review | pass | | `index.ts` |
| 5 | No real provider calls in tests | non-loopback fetch fails | network-guard test | pass | | `test/setup.ts` |
| 6 | Cross-site requests cannot spend | text/plain POST → 415, no CORS by default | `security.test.ts` "API exposure" | pass | | `api.ts` |
| 7 | Loopback by default | `127.0.0.1` | "listen defaults", clean-clone log | pass | | `listen.ts` |
| 8 | Routing skips down models, fails over live | | `router.test.ts`, `execute.test.ts` | pass | | `router.ts`, `execute.ts` |
| 9 | Cost recorded per attempt | | `costStore.test.ts`, `api.test.ts` | pass | | `costStore.ts` |
| 10 | Quickstart works from a clone | dashboard renders, Run works | clean clone + Chromium | pass | | `README.md` |

## Further testing needs

Live-mode verification needs an OpenAI-compatible endpoint with a key and/or a
running Ollama server; audit-branch CI (Windows) after push.

## Classification proposal

**PARTIALLY VERIFIED** — mock mode, API hardening and key handling are
verified; the live HTTP adapters are only verified against mocked HTTP.
