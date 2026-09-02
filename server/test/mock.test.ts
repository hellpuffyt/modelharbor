import { describe, expect, it } from "vitest";
import { MockProviderClient } from "../src/providers/mock.js";
import type { ProviderConfig } from "../src/types.js";

function providerConfig(id: string): ProviderConfig {
  return {
    id,
    label: id,
    kind: "mock",
    baseUrl: `mock://${id}`,
    timeoutMs: 5000,
    models: [
      { id: "steady-model", contextLength: 8192, priority: 1, tasks: ["chat"], pricing: { promptPer1k: 0, completionPer1k: 0 } },
    ],
  };
}

describe("MockProviderClient", () => {
  it("listModels returns the configured model ids", async () => {
    const client = new MockProviderClient(providerConfig("p"));
    await expect(client.listModels()).resolves.toEqual(["steady-model"]);
  });

  it("reports healthy for an ordinary model id", async () => {
    const client = new MockProviderClient(providerConfig("p"));
    const result = await client.checkHealth("steady-model");
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic across repeated health checks", async () => {
    const client = new MockProviderClient(providerConfig("p"));
    const a = await client.checkHealth("steady-model");
    const b = await client.checkHealth("steady-model");
    expect(a).toEqual(b);
  });

  it("reports down for a model id containing 'down'", async () => {
    const client = new MockProviderClient(providerConfig("p"));
    const result = await client.checkHealth("totally-down-model");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/down/);
  });

  it("reports elevated latency for a model id containing 'slow'", async () => {
    const client = new MockProviderClient(providerConfig("p"));
    const result = await client.checkHealth("slow-context-model");
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThan(4000);
  });

  it("generate rejects for a 'down' model id", async () => {
    const client = new MockProviderClient(providerConfig("p"));
    await expect(client.generate("service-down", "hi")).rejects.toThrow(/down/);
  });

  it("generate succeeds for a healthy model and returns usable token counts", async () => {
    const client = new MockProviderClient(providerConfig("p"));
    const result = await client.generate("steady-model", "hello there");
    expect(result.text).toContain("steady-model");
    expect(result.promptTokens).toBeGreaterThan(0);
    expect(result.completionTokens).toBeGreaterThan(0);
  });

  it("generate fails deterministically every 3rd call for a 'flaky' model id", async () => {
    const client = new MockProviderClient(providerConfig("p"));
    const outcomes: boolean[] = [];
    for (let i = 0; i < 6; i += 1) {
      try {
        await client.generate("flaky-model", "ping");
        outcomes.push(true);
      } catch {
        outcomes.push(false);
      }
    }
    expect(outcomes).toEqual([true, true, false, true, true, false]);
  });

  it("keeps independent call counters per model id", async () => {
    const client = new MockProviderClient(providerConfig("p"));
    await client.generate("flaky-a", "1");
    await client.generate("flaky-a", "2");
    // flaky-b's counter starts fresh; only its own 3rd call should fail.
    const r1 = await client.generate("flaky-b", "1").then(() => true).catch(() => false);
    const r2 = await client.generate("flaky-b", "2").then(() => true).catch(() => false);
    const r3 = await client.generate("flaky-b", "3").then(() => true).catch(() => false);
    expect([r1, r2, r3]).toEqual([true, true, false]);
  });

  it("produces the same hash-derived latency for the same model id across instances", async () => {
    const clientA = new MockProviderClient(providerConfig("a"));
    const clientB = new MockProviderClient(providerConfig("b"));
    const resultA = await clientA.checkHealth("steady-model");
    const resultB = await clientB.checkHealth("steady-model");
    expect(resultA.latencyMs).toBe(resultB.latencyMs);
  });
});
