import { describe, expect, it, vi } from "vitest";
import { checkAllHealth, checkModelHealth, DEGRADED_LATENCY_MS, HealthCache } from "../src/health.js";
import { MockProviderClient } from "../src/providers/mock.js";
import type { ProviderClient, ProviderConfig } from "../src/types.js";

function makeProvider(id: string, modelIds: string[]): ProviderConfig {
  return {
    id,
    label: id,
    kind: "mock",
    baseUrl: `mock://${id}`,
    timeoutMs: 5000,
    models: modelIds.map((mid, i) => ({
      id: mid,
      contextLength: 8192,
      priority: i,
      tasks: ["chat"],
      pricing: { promptPer1k: 0, completionPer1k: 0 },
    })),
  };
}

describe("checkModelHealth", () => {
  it("returns healthy status for a fast successful check", async () => {
    const provider = makeProvider("p", ["fast-model"]);
    const client = new MockProviderClient(provider);
    const result = await checkModelHealth(provider, client, "fast-model", 8192);
    expect(result.status).toBe("healthy");
    expect(result.providerId).toBe("p");
    expect(result.contextLength).toBe(8192);
    expect(result.error).toBeNull();
  });

  it("returns degraded status when latency exceeds the threshold", async () => {
    const provider = makeProvider("p", ["slow-model"]);
    const client = new MockProviderClient(provider);
    const result = await checkModelHealth(provider, client, "slow-model", 8192);
    expect(result.status).toBe("degraded");
    expect(result.latencyMs).toBeGreaterThan(DEGRADED_LATENCY_MS);
  });

  it("returns down status with null latency when the check fails", async () => {
    const provider = makeProvider("p", ["down-model"]);
    const client = new MockProviderClient(provider);
    const result = await checkModelHealth(provider, client, "down-model", 8192);
    expect(result.status).toBe("down");
    expect(result.latencyMs).toBeNull();
    expect(result.error).not.toBeNull();
  });

  it("stamps checkedAt as a valid ISO timestamp", async () => {
    const provider = makeProvider("p", ["fast-model"]);
    const client = new MockProviderClient(provider);
    const result = await checkModelHealth(provider, client, "fast-model", 8192);
    expect(() => new Date(result.checkedAt).toISOString()).not.toThrow();
  });
});

describe("checkAllHealth", () => {
  it("checks every model across every provider", async () => {
    const providers = [makeProvider("p1", ["m1", "m2"]), makeProvider("p2", ["m3"])];
    const clients = new Map<string, ProviderClient>(providers.map((p) => [p.id, new MockProviderClient(p)]));
    const results = await checkAllHealth(providers, clients);
    expect(results).toHaveLength(3);
  });

  it("skips providers with no registered client", async () => {
    const providers = [makeProvider("p1", ["m1"]), makeProvider("p2", ["m2"])];
    const clients = new Map<string, ProviderClient>([["p1", new MockProviderClient(providers[0]!)]]);
    const results = await checkAllHealth(providers, clients);
    expect(results).toHaveLength(1);
    expect(results[0]?.providerId).toBe("p1");
  });

  it("a failing model does not prevent others from reporting", async () => {
    const providers = [makeProvider("p1", ["down-model", "healthy-model"])];
    const clients = new Map<string, ProviderClient>([["p1", new MockProviderClient(providers[0]!)]]);
    const results = await checkAllHealth(providers, clients);
    const statuses = new Map(results.map((r) => [r.modelId, r.status]));
    expect(statuses.get("down-model")).toBe("down");
    expect(statuses.get("healthy-model")).toBe("healthy");
  });

  it("returns an empty array for no providers", async () => {
    const results = await checkAllHealth([], new Map());
    expect(results).toEqual([]);
  });
});

describe("HealthCache", () => {
  it("fetches fresh results on first call", async () => {
    const providers = [makeProvider("p1", ["m1"])];
    const clients = new Map<string, ProviderClient>([["p1", new MockProviderClient(providers[0]!)]]);
    const cache = new HealthCache(providers, clients, 10_000);
    expect(cache.peek()).toEqual([]);
    const results = await cache.get();
    expect(results).toHaveLength(1);
    expect(cache.peek()).toHaveLength(1);
  });

  it("serves from cache within the TTL without re-checking", async () => {
    const providers = [makeProvider("p1", ["m1"])];
    const client = new MockProviderClient(providers[0]!);
    const spy = vi.spyOn(client, "checkHealth");
    const clients = new Map<string, ProviderClient>([["p1", client]]);
    const cache = new HealthCache(providers, clients, 60_000);
    await cache.get();
    await cache.get();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("force refresh bypasses the cache", async () => {
    const providers = [makeProvider("p1", ["m1"])];
    const client = new MockProviderClient(providers[0]!);
    const spy = vi.spyOn(client, "checkHealth");
    const clients = new Map<string, ProviderClient>([["p1", client]]);
    const cache = new HealthCache(providers, clients, 60_000);
    await cache.get();
    await cache.get(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("re-checks automatically once the TTL has elapsed", async () => {
    const providers = [makeProvider("p1", ["m1"])];
    const client = new MockProviderClient(providers[0]!);
    const spy = vi.spyOn(client, "checkHealth");
    const clients = new Map<string, ProviderClient>([["p1", client]]);
    const cache = new HealthCache(providers, clients, 1);
    await cache.get();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await cache.get();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
