# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Security

- The API server binds `127.0.0.1` by default (`HOST` to override); it used
  to listen on all interfaces with no authentication.
- Removed `access-control-allow-origin: *`, which let any website run paid
  prompts through `POST /api/route`. CORS is opt-in for one exact origin
  (`MODELHARBOR_CORS_ORIGIN`). `POST /api/route` requires
  `content-type: application/json`; bodies over 1 MiB get 413.
- Provider error text (health errors, failover reasons) and `/api/config`
  `baseUrl` values are scrubbed of the configured key, bearer tokens, `sk-…`
  strings and URL credentials.
- Live configs go in `*.local.json` (gitignored) instead of overwriting the
  tracked `modelharbor.config.json`.

### Fixed

- `npm run dev:server` crashed with ENOENT: the workspace script runs inside
  `server/`, so the default config path did not exist. Paths now resolve
  against the directory `npm` was run from.
- Malformed JSON bodies return 400 instead of 500.

### Added

- `server/test/security.test.ts`, and a suite-wide network guard
  (`server/test/setup.ts`) that fails any test reaching a non-loopback host.
- `SECURITY.md`, `.editorconfig`, `docs/PRODUCTION_READINESS.md`.

## [1.0.0] - 2026-09-02

### Added

- Provider-adapter core (`ProviderClient`): `ollama`, `openai-compatible`, and a
  deterministic `mock` kind used for CI and local demos with no API keys.
- Health checking with a TTL cache (`HealthCache`), classifying every
  configured model as `healthy` / `degraded` / `down` per request latency.
- Task-aware router (`route`) that ranks candidates by priority per task type
  and skips unhealthy ones, plus a live-execution path (`executeTask`) that
  performs real failover across candidates and records a `UsageEvent` for
  every attempt, successful or not.
- Cost accounting (`computeCostUsd`, `summarize`) aggregating usage by model,
  provider, task, and day, backed by an in-memory or append-only JSONL store.
- HTTP API (`/api/config`, `/api/health`, `/api/route`, `/api/usage`,
  `/api/usage/events`) with API-key redaction on every response.
- Vite + TypeScript + React dashboard: live-polling health grid, a
  task-routing panel with an interactive "run this task" flow showing the
  failover chain, and a usage/cost panel with bar breakdowns and a recent
  events table — each panel with its own loading/error/empty states and full
  dark/light theme tokens.
- 129 server-side tests (vitest) covering config parsing, health, routing,
  execution/failover, cost aggregation, the mock provider's determinism, the
  live HTTP adapters (via stubbed `fetch`), and the API layer end-to-end.
- CI workflow running the full test/coverage/lint/typecheck/build matrix on
  Ubuntu, Windows, and macOS.

[1.0.0]: https://github.com/hellpuffyt/modelharbor/releases/tag/v1.0.0
