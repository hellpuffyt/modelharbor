import { describe, expect, it } from "vitest";
import { executeTask } from "../src/execute.js";
import { MockProviderClient } from "../src/providers/mock.js";
import type { ModelHealth, ProviderClient, ProviderConfig } from "../src/types.js";

function provider(id: string, models: ProviderConfig["models"]): ProviderConfig {
  return { id, label: id, kind: "mock", baseUrl: `mock://${id}`, timeoutMs: 5000, models };
}

function model(id: string, priority: number, tasks: ProviderConfig["models"][number]["tasks"]) {
  return { id, contextLength: 8192, priority, tasks, pricing: { promptPer1k: 0.001, completionPer1k: 0.002 } };
}

function healthy(providerId: string, modelId: string, status: ModelHealth["status"] = "healthy"): ModelHealth {
  return {
    providerId,
    providerLabel: providerId,
    modelId,
    status,
    latencyMs: 50,
    error: null,
    checkedAt: new Date().toISOString(),
    contextLength: 8192,
  };
}

describe("executeTask", () => {
  it("returns no chosen candidate when nothing supports the task", async () => {
    const providers = [provider("p1", [model("m1", 1, ["chat"])])];
    const clients = new Map<string, ProviderClient>([["p1", new MockProviderClient(providers[0]!)]]);
    const result = await executeTask(providers, clients, [], "code", "hi");
    expect(result.chosen).toBeNull();
    expect(result.events).toEqual([]);
  });

  it("executes successfully against a healthy top-priority model", async () => {
    const providers = [provider("p1", [model("steady-model", 1, ["chat"])])];
    const clients = new Map<string, ProviderClient>([["p1", new MockProviderClient(providers[0]!)]]);
    const result = await executeTask(providers, clients, [healthy("p1", "steady-model")], "chat", "hello");
    expect(result.chosen).toEqual({ providerId: "p1", modelId: "steady-model" });
    expect(result.text).toContain("steady-model");
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.success).toBe(true);
    expect(result.events[0]?.failoverCount).toBe(0);
  });

  it("computes cost from the model's pricing and returned token counts", async () => {
    const providers = [provider("p1", [model("steady-model", 1, ["chat"])])];
    const clients = new Map<string, ProviderClient>([["p1", new MockProviderClient(providers[0]!)]]);
    const result = await executeTask(providers, clients, [healthy("p1", "steady-model")], "chat", "hello");
    const event = result.events[0]!;
    const expectedCost = (event.promptTokens / 1000) * 0.001 + (event.completionTokens / 1000) * 0.002;
    expect(event.costUsd).toBeCloseTo(expectedCost, 6);
  });

  it("fails over to the next candidate when the first generate() call throws", async () => {
    const providers = [
      provider("p1", [model("down-model", 1, ["chat"])]),
      provider("p2", [model("steady-model", 2, ["chat"])]),
    ];
    const clients = new Map<string, ProviderClient>([
      ["p1", new MockProviderClient(providers[0]!)],
      ["p2", new MockProviderClient(providers[1]!)],
    ]);
    const health = [healthy("p1", "down-model"), healthy("p2", "steady-model")];
    const result = await executeTask(providers, clients, health, "chat", "hello");
    expect(result.chosen).toEqual({ providerId: "p2", modelId: "steady-model" });
    expect(result.events).toHaveLength(2);
    expect(result.events[0]?.success).toBe(false);
    expect(result.events[1]?.success).toBe(true);
    expect(result.events[1]?.failoverCount).toBe(1);
    expect(result.reason).toContain("failover");
  });

  it("records a failed usage event with zero cost and zero tokens", async () => {
    const providers = [provider("p1", [model("down-model", 1, ["chat"])])];
    const clients = new Map<string, ProviderClient>([["p1", new MockProviderClient(providers[0]!)]]);
    const result = await executeTask(providers, clients, [healthy("p1", "down-model")], "chat", "hello", 1);
    expect(result.chosen).toBeNull();
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ success: false, costUsd: 0, promptTokens: 0, completionTokens: 0 });
  });

  it("gives up after maxAttempts even if more candidates remain", async () => {
    const providers = [
      provider("p1", [model("down-a", 1, ["chat"])]),
      provider("p2", [model("down-b", 2, ["chat"])]),
      provider("p3", [model("steady-model", 3, ["chat"])]),
    ];
    const clients = new Map<string, ProviderClient>([
      ["p1", new MockProviderClient(providers[0]!)],
      ["p2", new MockProviderClient(providers[1]!)],
      ["p3", new MockProviderClient(providers[2]!)],
    ]);
    const health = [healthy("p1", "down-a"), healthy("p2", "down-b"), healthy("p3", "steady-model")];
    const result = await executeTask(providers, clients, health, "chat", "hello", 2);
    expect(result.chosen).toBeNull();
    expect(result.events).toHaveLength(2);
  });

  it("still attempts a candidate with unknown health rather than refusing outright", async () => {
    const providers = [provider("p1", [model("steady-model", 1, ["chat"])])];
    const clients = new Map<string, ProviderClient>([["p1", new MockProviderClient(providers[0]!)]]);
    const result = await executeTask(providers, clients, [], "chat", "hello");
    expect(result.chosen).toEqual({ providerId: "p1", modelId: "steady-model" });
  });

  it("skips a candidate missing its provider/model/client wiring", async () => {
    const providers = [provider("p1", [model("ghost-model", 1, ["chat"]), model("steady-model", 2, ["chat"])])];
    const clients = new Map<string, ProviderClient>([["p1", new MockProviderClient(providers[0]!)]]);
    // No client registered for a hypothetical second provider referencing ghost-model differently;
    // instead simulate missing wiring by pointing health at a candidate whose model config was removed.
    const trimmedProviders = [provider("p1", [model("steady-model", 2, ["chat"])])];
    const health = [healthy("p1", "ghost-model"), healthy("p1", "steady-model")];
    const result = await executeTask(trimmedProviders, clients, health, "chat", "hello");
    expect(result.chosen).toEqual({ providerId: "p1", modelId: "steady-model" });
  });
});
