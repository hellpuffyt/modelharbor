# Contributing to ModelHarbor

Thanks for considering a contribution. ModelHarbor is a small, opinionated
codebase — the goal of these guidelines is to keep it that way.

## Getting set up

```bash
npm install
npm run build         # compiles server + web once, catching type errors early
npm run test          # server test suite (vitest)
npm run test:coverage # same, with coverage thresholds enforced
npm run lint          # eslint across server + web
npm run typecheck     # tsc --noEmit across server + web
```

Start the stack locally against the deterministic mock provider (no API keys
required):

```bash
npm run dev:server    # http://localhost:4180, reads ./modelharbor.config.json
npm run dev:web       # http://localhost:5180, proxies /api to the server
```

## Ground rules

- **Every behavior change needs a test.** The server suite is the source of
  truth for correctness — router failover, cost math, config validation, and
  the mock provider's determinism all have dedicated coverage. New logic
  should follow the same pattern rather than relying on manual testing.
- **Keep the mock provider deterministic.** `server/src/providers/mock.ts` is
  what makes CI possible without secrets. If you change its behavior, keep it
  a pure function of `(modelId, call count)` — no `Math.random()`, no wall
  clock reads that leak into the output.
- **No secrets in the repo.** `modelharbor.config.json` (used by CI and local
  dev) only ever contains mock providers. Real credentials belong in a
  gitignored config file pointed to by `MODELHARBOR_CONFIG`; see
  `modelharbor.config.example.json`.
- **Coverage thresholds are enforced**, not aspirational — `npm run
  test:coverage` fails the build below the thresholds in
  `server/vitest.config.ts`. If you add a branch, add the test that exercises
  it.
- **Zero lint warnings.** Both workspaces run with `eslint:recommended` +
  strict `@typescript-eslint` rules and no warning budget — fix, don't
  suppress.

## Adding a new provider adapter

Provider adapters implement the `ProviderClient` interface in
`server/src/types.ts` (`listModels`, `checkHealth`, `generate`). To add one:

1. Create `server/src/providers/<name>.ts` implementing the interface.
2. Register it in `server/src/providers/factory.ts` and add the new
   `ProviderKind` to `server/src/types.ts` and the `VALID_KINDS` list in
   `server/src/config.ts`.
3. Add unit tests under `server/test/` that stub `fetch` the way
   `providers.test.ts` does for the existing HTTP-based adapters — don't
   depend on a live network endpoint in CI.

## Pull requests

Keep PRs focused on one change. Include the test output (`npm run test`) and
a one-line description of what changed and why in the PR description.
