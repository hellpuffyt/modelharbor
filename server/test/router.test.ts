import { describe, expect, it } from "vitest";
import { buildCandidatePool, route } from "../src/router.js";
import type { ModelHealth, ProviderConfig } from "../src/types.js";

const providers: ProviderConfig[] = [
  {
    id: "alpha",
    label: "Alpha",
    kind: "mock",
    baseUrl: "mock://alpha",
    timeoutMs: 5000,
    models: [
      { id: "alpha-code", contextLength: 32000, priority: 2, tasks: ["code"], pricing: { promptPer1k: 0, completionPer1k: 0 } },
      { id: "alpha-chat", contextLength: 16000, priority: 1, tasks: ["chat", "fast"], pricing: { promptPer1k: 0, completionPer1k: 0 } },
    ],
  },
  {
    id: "beta",
    label: "Beta",
    kind: "mock",
    baseUrl: "mock://beta",
    timeoutMs: 5000,
    models: [
      { id: "beta-code", contextLength: 64000, priority: 1, tasks: ["code"], pricing: { promptPer1k: 0, completionPer1k: 0 } },
    ],
  },
];

function health(providerId: string, modelId: string, status: ModelHealth["status"]): ModelHealth {
  return {
    providerId,
    providerLabel: providerId,
    modelId,
    status,
    latencyMs: status === "down" ? null : 100,
    error: status === "down" ? "down" : null,
    checkedAt: new Date().toISOString(),
    contextLength: 1000,
  };
}

describe("buildCandidatePool", () => {
  it("includes only models that list the requested task", () => {
    const pool = buildCandidatePool(providers, "fast");
    expect(pool).toHaveLength(1);
    expect(pool[0]?.candidate).toEqual({ providerId: "alpha", modelId: "alpha-chat" });
  });

  it("sorts by ascending priority", () => {
    const pool = buildCandidatePool(providers, "code");
    expect(pool.map((p) => p.candidate.modelId)).toEqual(["beta-code", "alpha-code"]);
  });

  it("returns an empty pool for a task nothing supports", () => {
    const pool = buildCandidatePool(providers, "long-context");
    expect(pool).toEqual([]);
  });

  it("breaks priority ties by providerId then modelId", () => {
    const tiedProviders: ProviderConfig[] = [
      { ...providers[1]!, id: "zzz", models: [{ ...providers[1]!.models[0]!, priority: 1 }] },
      { ...providers[1]!, id: "aaa", models: [{ ...providers[1]!.models[0]!, priority: 1 }] },
    ];
    const pool = buildCandidatePool(tiedProviders, "code");
    expect(pool.map((p) => p.candidate.providerId)).toEqual(["aaa", "zzz"]);
  });
});

describe("route", () => {
  it("returns null with a reason when no model supports the task", () => {
    const decision = route(providers, [], "long-context");
    expect(decision.chosen).toBeNull();
    expect(decision.reason).toMatch(/no model is configured/);
  });

  it("selects the highest-priority healthy candidate", () => {
    const decision = route(providers, [health("beta", "beta-code", "healthy"), health("alpha", "alpha-code", "healthy")], "code");
    expect(decision.chosen).toEqual({ providerId: "beta", modelId: "beta-code" });
  });

  it("fails over past a down candidate to the next healthy one", () => {
    const decision = route(providers, [health("beta", "beta-code", "down"), health("alpha", "alpha-code", "healthy")], "code");
    expect(decision.chosen).toEqual({ providerId: "alpha", modelId: "alpha-code" });
    expect(decision.attempted[0]?.outcome).toBe("skipped-unhealthy");
  });

  it("treats a candidate with no health data as unusable", () => {
    const decision = route(providers, [health("alpha", "alpha-code", "healthy")], "code");
    expect(decision.chosen).toEqual({ providerId: "alpha", modelId: "alpha-code" });
    expect(decision.attempted[0]?.outcome).toBe("skipped-no-health-data");
  });

  it("treats a degraded candidate as usable and selects it", () => {
    const decision = route(providers, [health("beta", "beta-code", "degraded")], "code");
    expect(decision.chosen).toEqual({ providerId: "beta", modelId: "beta-code" });
    expect(decision.reason).toContain("degraded");
  });

  it("returns null when every candidate is down or unreported", () => {
    const decision = route(providers, [health("beta", "beta-code", "down")], "code");
    expect(decision.chosen).toBeNull();
    expect(decision.reason).toMatch(/down or unreported/);
  });

  it("records every attempted candidate in priority order", () => {
    const decision = route(providers, [health("beta", "beta-code", "down"), health("alpha", "alpha-code", "down")], "code");
    expect(decision.attempted.map((a) => a.candidate.modelId)).toEqual(["beta-code", "alpha-code"]);
  });
});
