import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiServer } from "../src/api.js";
import { parseConfig } from "../src/config.js";
import { MemoryUsageStore } from "../src/costStore.js";
import { HealthCache } from "../src/health.js";
import { MockProviderClient } from "../src/providers/mock.js";
import type { ModelHarborConfig, ProviderClient } from "../src/types.js";

const rawConfig = {
  healthCacheMs: 60_000,
  providers: [
    {
      id: "p1",
      label: "Provider One",
      kind: "mock",
      baseUrl: "mock://p1",
      apiKey: "top-secret",
      timeoutMs: 5000,
      models: [
        { id: "steady-model", contextLength: 8192, priority: 1, tasks: ["chat"], pricing: { promptPer1k: 0.001, completionPer1k: 0.002 } },
        { id: "down-model", contextLength: 8192, priority: 2, tasks: ["chat"], pricing: { promptPer1k: 0, completionPer1k: 0 } },
      ],
    },
  ],
};

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  const config: ModelHarborConfig = parseConfig(rawConfig);
  const clients = new Map<string, ProviderClient>(config.providers.map((p) => [p.id, new MockProviderClient(p)]));
  const healthCache = new HealthCache(config.providers, clients, config.healthCacheMs);
  const usageStore = new MemoryUsageStore();
  server = createApiServer({ config, clients, healthCache, usageStore });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  baseUrl = `http://127.0.0.1:${String(port)}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/config", () => {
  it("returns 200 with the provider list", async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ModelHarborConfig;
    expect(body.providers).toHaveLength(1);
  });

  it("never leaks apiKey", async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    const text = await res.text();
    expect(text).not.toContain("top-secret");
  });
});

describe("GET /api/health", () => {
  it("returns health for every configured model", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: unknown[] };
    expect(body.models).toHaveLength(2);
  });

  it("supports force=true to bypass the cache", async () => {
    const res = await fetch(`${baseUrl}/api/health?force=true`);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/route", () => {
  it("returns 400 for a missing task param", async () => {
    const res = await fetch(`${baseUrl}/api/route`);
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid task param", async () => {
    const res = await fetch(`${baseUrl}/api/route?task=nonsense`);
    expect(res.status).toBe(400);
  });

  it("returns a routing decision for a valid task", async () => {
    const res = await fetch(`${baseUrl}/api/route?task=chat`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { chosen: unknown };
    expect(body.chosen).toEqual({ providerId: "p1", modelId: "steady-model" });
  });
});

describe("POST /api/route", () => {
  it("returns 400 when task is missing", async () => {
    const res = await fetch(`${baseUrl}/api/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hi" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when prompt is missing", async () => {
    const res = await fetch(`${baseUrl}/api/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "chat" }),
    });
    expect(res.status).toBe(400);
  });

  it("executes a task end-to-end and returns generated text", async () => {
    const res = await fetch(`${baseUrl}/api/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "chat", prompt: "hello world" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string | null };
    expect(body.text).toContain("steady-model");
  });

  it("recording a usage event makes it visible via /api/usage", async () => {
    await fetch(`${baseUrl}/api/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "chat", prompt: "hello" }),
    });
    const res = await fetch(`${baseUrl}/api/usage`);
    const body = (await res.json()) as { totalRequests: number };
    expect(body.totalRequests).toBe(1);
  });
});

describe("GET /api/usage", () => {
  it("returns a zeroed summary before any requests", async () => {
    const res = await fetch(`${baseUrl}/api/usage`);
    const body = (await res.json()) as { totalRequests: number; totalCostUsd: number };
    expect(body.totalRequests).toBe(0);
    expect(body.totalCostUsd).toBe(0);
  });
});

describe("GET /api/usage/events", () => {
  it("returns an empty events list before any requests", async () => {
    const res = await fetch(`${baseUrl}/api/usage/events`);
    const body = (await res.json()) as { events: unknown[] };
    expect(body.events).toEqual([]);
  });

  it("returns the most recent events first, capped by limit", async () => {
    for (let i = 0; i < 3; i += 1) {
      await fetch(`${baseUrl}/api/route`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: "chat", prompt: `prompt ${String(i)}` }),
      });
    }
    const res = await fetch(`${baseUrl}/api/usage/events?limit=2`);
    const body = (await res.json()) as { events: Array<{ promptTokens: number }> };
    expect(body.events).toHaveLength(2);
  });
});

describe("unmatched routes and CORS", () => {
  it("returns 404 for an unknown path", async () => {
    const res = await fetch(`${baseUrl}/api/nonexistent`);
    expect(res.status).toBe(404);
  });

  // Changed during the production-readiness audit: these used to expect
  // "access-control-allow-origin: *", which let any website drive paid
  // POST /api/route calls with the server's provider keys. CORS is now
  // opt-in for one exact origin (see test/security.test.ts).
  it("answers OPTIONS preflight with 204 but grants no CORS by default", async () => {
    const res = await fetch(`${baseUrl}/api/route`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("sets no access-control-allow-origin on ordinary responses by default", async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
