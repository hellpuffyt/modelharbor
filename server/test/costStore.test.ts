import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeCostUsd, FileUsageStore, MemoryUsageStore, summarize } from "../src/costStore.js";
import type { UsageEvent } from "../src/types.js";

function event(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    id: overrides.id ?? "id-1",
    timestamp: overrides.timestamp ?? "2026-01-01T00:00:00.000Z",
    providerId: overrides.providerId ?? "p1",
    modelId: overrides.modelId ?? "m1",
    task: overrides.task ?? "chat",
    promptTokens: overrides.promptTokens ?? 100,
    completionTokens: overrides.completionTokens ?? 50,
    costUsd: overrides.costUsd ?? 0.01,
    latencyMs: overrides.latencyMs ?? 200,
    success: overrides.success ?? true,
    failoverCount: overrides.failoverCount ?? 0,
  };
}

describe("computeCostUsd", () => {
  it("computes cost proportional to token counts", () => {
    expect(computeCostUsd({ promptPer1k: 0.01, completionPer1k: 0.02 }, 1000, 1000)).toBeCloseTo(0.03, 6);
  });

  it("returns zero for zero pricing", () => {
    expect(computeCostUsd({ promptPer1k: 0, completionPer1k: 0 }, 5000, 5000)).toBe(0);
  });

  it("rounds to 6 decimal places", () => {
    const cost = computeCostUsd({ promptPer1k: 0.0000001, completionPer1k: 0 }, 1, 0);
    expect(cost).toBe(0);
  });

  it("handles fractional token counts scaled by 1000", () => {
    expect(computeCostUsd({ promptPer1k: 1, completionPer1k: 0 }, 500, 0)).toBeCloseTo(0.5, 6);
  });
});

describe("MemoryUsageStore", () => {
  it("starts empty", () => {
    expect(new MemoryUsageStore().all()).toEqual([]);
  });

  it("appends and returns events in order", () => {
    const store = new MemoryUsageStore();
    store.append(event({ id: "a" }));
    store.append(event({ id: "b" }));
    expect(store.all().map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("returns a defensive copy from all()", () => {
    const store = new MemoryUsageStore();
    store.append(event());
    const snapshot = store.all();
    snapshot.push(event({ id: "injected" }));
    expect(store.all()).toHaveLength(1);
  });
});

describe("FileUsageStore", () => {
  it("persists events to disk and reloads them", () => {
    const dir = mkdtempSync(join(tmpdir(), "modelharbor-usage-"));
    const path = join(dir, "nested", "usage.jsonl");
    try {
      const store = new FileUsageStore(path);
      store.append(event({ id: "a" }));
      store.append(event({ id: "b" }));
      const reopened = new FileUsageStore(path);
      expect(reopened.all().map((e) => e.id)).toEqual(["a", "b"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("starts empty when the file does not exist yet", () => {
    const dir = mkdtempSync(join(tmpdir(), "modelharbor-usage-"));
    const path = join(dir, "usage.jsonl");
    try {
      const store = new FileUsageStore(path);
      expect(store.all()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores blank lines when reloading", () => {
    const dir = mkdtempSync(join(tmpdir(), "modelharbor-usage-"));
    const path = join(dir, "usage.jsonl");
    try {
      const store = new FileUsageStore(path);
      store.append(event({ id: "a" }));
      const reopened = new FileUsageStore(path);
      expect(reopened.all()).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("summarize", () => {
  it("returns zeroed summary for no events", () => {
    const summary = summarize([]);
    expect(summary.totalRequests).toBe(0);
    expect(summary.totalCostUsd).toBe(0);
    expect(summary.byModel).toEqual([]);
  });

  it("totals requests, cost, and tokens", () => {
    const events = [event({ id: "a", costUsd: 0.01 }), event({ id: "b", costUsd: 0.02 })];
    const summary = summarize(events);
    expect(summary.totalRequests).toBe(2);
    expect(summary.totalCostUsd).toBeCloseTo(0.03, 6);
    expect(summary.totalPromptTokens).toBe(200);
    expect(summary.totalCompletionTokens).toBe(100);
  });

  it("aggregates by model as providerId/modelId", () => {
    const events = [
      event({ id: "a", providerId: "p1", modelId: "m1" }),
      event({ id: "b", providerId: "p1", modelId: "m2" }),
    ];
    const summary = summarize(events);
    expect(summary.byModel.map((a) => a.key).sort()).toEqual(["p1/m1", "p1/m2"]);
  });

  it("aggregates by provider", () => {
    const events = [
      event({ id: "a", providerId: "p1" }),
      event({ id: "b", providerId: "p2" }),
    ];
    const summary = summarize(events);
    expect(summary.byProvider.map((a) => a.key).sort()).toEqual(["p1", "p2"]);
  });

  it("aggregates by task", () => {
    const events = [event({ id: "a", task: "chat" }), event({ id: "b", task: "code" })];
    const summary = summarize(events);
    expect(summary.byTask.map((a) => a.key).sort()).toEqual(["chat", "code"]);
  });

  it("aggregates by day using the date portion of the timestamp", () => {
    const events = [
      event({ id: "a", timestamp: "2026-01-01T10:00:00.000Z" }),
      event({ id: "b", timestamp: "2026-01-01T23:00:00.000Z" }),
      event({ id: "c", timestamp: "2026-01-02T01:00:00.000Z" }),
    ];
    const summary = summarize(events);
    expect(summary.byDay.map((a) => a.key).sort()).toEqual(["2026-01-01", "2026-01-02"]);
  });

  it("counts success and failure separately within an aggregate", () => {
    const events = [
      event({ id: "a", providerId: "p1", success: true }),
      event({ id: "b", providerId: "p1", success: false, costUsd: 0 }),
    ];
    const summary = summarize(events);
    const p1 = summary.byProvider.find((a) => a.key === "p1")!;
    expect(p1.successCount).toBe(1);
    expect(p1.failureCount).toBe(1);
    expect(p1.requestCount).toBe(2);
  });

  it("computes average latency per aggregate", () => {
    const events = [
      event({ id: "a", providerId: "p1", latencyMs: 100 }),
      event({ id: "b", providerId: "p1", latencyMs: 300 }),
    ];
    const summary = summarize(events);
    expect(summary.byProvider.find((a) => a.key === "p1")?.averageLatencyMs).toBe(200);
  });

  it("sorts aggregates by descending total cost", () => {
    const events = [
      event({ id: "a", providerId: "cheap", costUsd: 0.001 }),
      event({ id: "b", providerId: "pricey", costUsd: 5 }),
    ];
    const summary = summarize(events);
    expect(summary.byProvider.map((a) => a.key)).toEqual(["pricey", "cheap"]);
  });

  it("breaks a cost tie alphabetically by key", () => {
    const events = [
      event({ id: "a", providerId: "zeta", costUsd: 1 }),
      event({ id: "b", providerId: "alpha", costUsd: 1 }),
    ];
    const summary = summarize(events);
    expect(summary.byProvider.map((a) => a.key)).toEqual(["alpha", "zeta"]);
  });
});
