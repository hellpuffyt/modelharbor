# ModelHarbor

**A visual control center for every configured LLM provider** — live
health/latency/context-limit per model, automatic task-aware routing with
failover, and a real usage-cost dashboard. Not a config file. An operable
instrument panel.

![ModelHarbor dashboard, light theme](docs/screenshots/dashboard-light.png)

<details>
<summary>Dark theme</summary>

![ModelHarbor dashboard, dark theme](docs/screenshots/dashboard-dark.png)

</details>

## Why

Teams running more than one LLM provider end up with the same three problems:
nobody can see which models are actually up right now, routing decisions are
buried in `if` statements nobody trusts, and the invoice at the end of the
month is a surprise. ModelHarbor is a small, self-hosted service that answers
all three with one running process and one dashboard:

- **Health** — every configured model is checked on a TTL, classified
  `healthy` / `degraded` / `down` by response latency, with the error message
  surfaced when a check fails.
- **Routing** — each task type (`code`, `chat`, `fast`, `long-context`) has a
  ranked pool of candidate models. The router walks the pool in priority
  order, skipping anything unhealthy, and the *execution* path goes further:
  if the chosen model's call actually fails at request time, it fails over
  live to the next candidate and records every attempt.
- **Cost** — every executed request — success or failure — becomes a
  `UsageEvent` with real token counts and computed cost, aggregated by model,
  provider, task, and day.

## Quickstart (mock mode — no API keys)

Nobody wants to hand out real provider credentials to try a dashboard, so
ModelHarbor ships a `mock` provider kind that deterministically simulates
health checks and generations — same shape as the real HTTP adapters, zero
network calls. It's what `modelharbor.config.json` (the default config) uses,
and it's exactly what CI runs against.

```bash
npm install
npm run build

npm run dev:server   # http://localhost:4180  (reads modelharbor.config.json)
npm run dev:web      # http://localhost:5180  (proxies /api to the server)
```

Open `http://localhost:5180`. You'll see three providers, eight models — one
deliberately `degraded` (elevated latency), one deliberately `down` — and a
routing panel you can drive: pick a task, hit **Run**, and watch the executed
request (with real failover if the top pick is unhealthy) land in the cost
dashboard.

## Going live

Live mode is the same code path with real adapters instead of `mock` ones —
nothing to rewrite. Copy the example config and point the server at it:

```bash
cp modelharbor.config.example.json modelharbor.config.json   # do NOT commit this
MODELHARBOR_CONFIG=./modelharbor.config.json npm run dev:server
```

Two adapter kinds ship today:

| `kind` | Talks to | Notes |
|---|---|---|
| `openai-compatible` | Any endpoint speaking the OpenAI chat-completions HTTP shape | OpenAI itself, LM Studio, vLLM, LiteLLM proxies, OpenRouter, or Anthropic behind an OpenAI-shim gateway |
| `ollama` | A real Ollama server's native REST API | Local, no API key |
| `mock` | Nothing — pure deterministic function of `(modelId, call count)` | CI / demos |

Never commit a config with real `apiKey` values — `.gitignore` only protects
`modelharbor.config.json` itself if you rename it away from the tracked
default; keep secrets in a separate, gitignored file and point
`MODELHARBOR_CONFIG` at it.

## Architecture

```
                         ┌─────────────────────────┐
                         │   web/ (Vite + React)   │
                         │  Health · Routing · Cost │
                         │  panels, polling every 5s│
                         └────────────┬────────────┘
                                      │ fetch /api/*
                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ server/ (Node, zero-framework http.Server)                       │
│                                                                   │
│  config.ts ──▶ ProviderConfig[] ──▶ providers/factory.ts         │
│                                        │                         │
│                     ┌──────────────────┼───────────────────┐     │
│                     ▼                  ▼                   ▼     │
│              OllamaClient   OpenAiCompatibleClient   MockProvider │
│                     └──────────────────┴───────────────────┘     │
│                                 ProviderClient                    │
│                                      │                            │
│              ┌───────────────────────┼────────────────────┐      │
│              ▼                       ▼                    ▼      │
│        health.ts               router.ts              execute.ts │
│      (TTL-cached                (pick highest-       (route + run,│
│       checkHealth per            priority healthy      live fail- │
│       model)                     candidate)             over,     │
│              │                       │                  UsageEvent│
│              └──────────┬────────────┘                  per try)  │
│                         ▼                                    │    │
│                    api.ts (HTTP routes)         costStore.ts ◀────┘
│                                                  (aggregate, persist)
└─────────────────────────────────────────────────────────────────┘
```

The router and the execution path are deliberately separate: `GET /api/route`
answers *"what would be chosen right now"* purely from the health cache (fast,
side-effect-free — safe to poll every few seconds), while `POST /api/route`
actually runs the prompt, fails over live if a call throws, and is the only
place that writes `UsageEvent`s.

### API

| Endpoint | Method | Description |
|---|---|---|
| `/api/config` | GET | Redacted provider/model config (no API keys ever leave the server) |
| `/api/health` | GET | Latest health snapshot; `?force=true` bypasses the TTL cache |
| `/api/route` | GET | Routing decision for `?task=` without executing anything |
| `/api/route` | POST | `{ task, prompt }` → executes with live failover, records usage |
| `/api/usage` | GET | Cost/usage summary, aggregated by model / provider / task / day |
| `/api/usage/events` | GET | Most recent raw usage events, `?limit=` |

## Testing

```bash
npm run test           # 129 tests (vitest)
npm run test:coverage   # same, coverage-gated: 90% stmts/lines/funcs, 85% branches
npm run lint            # eslint, zero warnings
npm run typecheck       # tsc --noEmit, both workspaces
```

The live HTTP adapters (`ollama.ts`, `openaiCompatible.ts`) are unit-tested by
stubbing `fetch` rather than hitting a real network — every success/error
branch is exercised without needing Ollama or an API key present in CI.

## Project layout

```
server/           Node/TypeScript API — config, health, routing, execution, cost
  src/providers/   ollama, openai-compatible, and mock adapters
  test/            129 vitest cases
web/              Vite + React + TypeScript dashboard, hand-rolled CSS design tokens
modelharbor.config.json          default (mock) config — used by CI and `npm run dev:*`
modelharbor.config.example.json  documented live-mode config to copy and edit
```

## License

MIT © 2026 Prabesh Sharma
