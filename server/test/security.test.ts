/**
 * Key-handling and exposure regression tests. Provider HTTP is MOCKED
 * (vi.stubGlobal fetch); fake keys are assembled at runtime so no
 * key-shaped literal lives in the source.
 */
import type { Server } from "node:http";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiServer, MAX_BODY_BYTES } from "../src/api.js";
import { parseConfig, redactConfig } from "../src/config.js";
import { MemoryUsageStore } from "../src/costStore.js";
import { executeTask } from "../src/execute.js";
import { HealthCache } from "../src/health.js";
import { configPathFromEnv, listenOptionsFromEnv } from "../src/listen.js";
import { join, resolve } from "node:path";
import { MockProviderClient } from "../src/providers/mock.js";
import { OpenAiCompatibleClient } from "../src/providers/openaiCompatible.js";
import { redactSecrets } from "../src/redact.js";
import { guardedFetch } from "./networkGuard.js";
import type { ProviderClient, ProviderConfig } from "../src/types.js";

const FAKE_KEY = ["sk", "proj", "FAKE0123456789abcdefFAKE"].join("-");

function liveProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "openai",
    label: "OpenAI",
    kind: "openai-compatible",
    baseUrl: "http://provider.test/v1",
    apiKey: FAKE_KEY,
    timeoutMs: 5000,
    models: [{ id: "m1", contextLength: 8192, priority: 1, tasks: ["chat"], pricing: { promptPer1k: 0, completionPer1k: 0 } }],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("redactSecrets", () => {
  it("removes the configured key, bearer tokens, sk- keys, URL userinfo and key query params", () => {
    const text = [
      `Incorrect API key provided: ${FAKE_KEY}`,
      `Authorization: Bearer ${FAKE_KEY}`,
      "masked echo sk-proj-abc*****wxyz",
      "https://user:hunter2pass@gw.test/v1",
      "https://gw.test/v1?api-key=abcdef123&x=1",
    ].join("\n");
    const out = redactSecrets(text, [FAKE_KEY]);
    expect(out).not.toContain(FAKE_KEY);
    expect(out).not.toContain("hunter2pass");
    expect(out).not.toContain("abcdef123");
    expect(out).not.toContain("sk-proj-abc");
    expect(out).toContain("x=1");
  });

  it("leaves ordinary error text alone", () => {
    expect(redactSecrets("HTTP 503: service unavailable")).toBe("HTTP 503: service unavailable");
  });
});

describe("keys never leave the server", () => {
  it("/api/config redaction drops apiKey and URL credentials", () => {
    const cfg = parseConfig({
      providers: [liveProvider({ baseUrl: "https://user:hunter2pass@gw.test/v1?api-key=abcdef123" })],
    });
    const json = JSON.stringify(redactConfig(cfg));
    expect(json).not.toContain(FAKE_KEY);
    expect(json).not.toContain("hunter2pass");
    expect(json).not.toContain("abcdef123");
    expect(json).toContain("gw.test");
  });

  it("a provider error body echoing the key is redacted in health results (mocked HTTP)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(`{"error":"Incorrect API key provided: ${FAKE_KEY}"}`, { status: 401 })),
    );
    const health = await new OpenAiCompatibleClient(liveProvider()).checkHealth("m1");
    expect(health.ok).toBe(false);
    expect(health.error).toContain("HTTP 401");
    expect(health.error).not.toContain(FAKE_KEY);
  });

  it("a provider error echoing the key is redacted in the failover reason (mocked HTTP)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`bad key ${FAKE_KEY}`, { status: 401 })));
    const provider = liveProvider();
    const clients = new Map<string, ProviderClient>([[provider.id, new OpenAiCompatibleClient(provider)]]);
    const result = await executeTask([provider], clients, [], "chat", "hi");
    expect(result.chosen).toBeNull();
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
  });

  it("a thrown network error mentioning the key is redacted too (mocked HTTP)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(`connect failed for Bearer ${FAKE_KEY}`)));
    const health = await new OpenAiCompatibleClient(liveProvider()).checkHealth("m1");
    expect(health.error).not.toContain(FAKE_KEY);
  });
});

describe("API exposure", () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server?.close(() => r()));
    server = undefined;
  });

  async function start(corsOrigin?: string): Promise<number> {
    const config = parseConfig({
      healthCacheMs: 60_000,
      providers: [{ ...liveProvider(), kind: "mock", baseUrl: "mock://p1" }],
    });
    const clients = new Map<string, ProviderClient>(config.providers.map((p) => [p.id, new MockProviderClient(p)]));
    server = createApiServer({
      config,
      clients,
      healthCache: new HealthCache(config.providers, clients, config.healthCacheMs),
      usageStore: new MemoryUsageStore(),
      ...(corsOrigin ? { corsOrigin } : {}),
    });
    await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
    return (server.address() as AddressInfo).port;
  }

  it("rejects a cross-site 'simple' text/plain POST that would skip preflight", async () => {
    const port = await start();
    const res = await fetch(`http://127.0.0.1:${String(port)}/api/route`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ task: "chat", prompt: "spend money" }),
    });
    expect(res.status).toBe(415);
    const usage = (await (await fetch(`http://127.0.0.1:${String(port)}/api/usage/events`)).json()) as { events: unknown[] };
    expect(usage.events).toHaveLength(0);
  });

  it("returns 400, not 500, for malformed JSON", async () => {
    const port = await start();
    const res = await fetch(`http://127.0.0.1:${String(port)}/api/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("refuses bodies larger than MAX_BODY_BYTES with 413", async () => {
    const port = await start();
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, path: "/api/route", method: "POST", headers: { "content-type": "application/json" } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end(Buffer.alloc(MAX_BODY_BYTES + 1024, 0x20));
    });
    expect(status).toBe(413);
  });

  it("allows exactly the configured CORS origin when one is set", async () => {
    const port = await start("https://dash.example.test");
    const pre = await fetch(`http://127.0.0.1:${String(port)}/api/route`, { method: "OPTIONS" });
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://dash.example.test");
    const res = await fetch(`http://127.0.0.1:${String(port)}/api/config`);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://dash.example.test");
    expect(await res.text()).not.toContain(FAKE_KEY);
  });
});

describe("listen defaults", () => {
  it("binds loopback by default and never accepts a wildcard CORS origin", () => {
    expect(listenOptionsFromEnv({})).toEqual({ host: "127.0.0.1", port: 4180, corsOrigin: undefined });
    expect(listenOptionsFromEnv({ MODELHARBOR_CORS_ORIGIN: "*" }).corsOrigin).toBeUndefined();
    expect(listenOptionsFromEnv({ HOST: "0.0.0.0", PORT: "9000", MODELHARBOR_CORS_ORIGIN: "https://a.test" })).toEqual({
      host: "0.0.0.0",
      port: 9000,
      corsOrigin: "https://a.test",
    });
    expect(listenOptionsFromEnv({ PORT: "nope" }).port).toBe(4180);
  });
});

describe("test network guard", () => {
  it("rejects real (non-loopback) requests", async () => {
    await expect(guardedFetch("https://api.openai.com/v1/models")).rejects.toThrow(/network guard/);
  });
});

describe("config path resolution (npm workspaces run the server inside server/)", () => {
  const root = resolve("/repo");
  const serverDir = join(root, "server");
  it("defaults to modelharbor.config.json in the directory npm was invoked from", () => {
    expect(configPathFromEnv({ INIT_CWD: root }, serverDir)).toBe(join(root, "modelharbor.config.json"));
  });
  it("resolves a relative MODELHARBOR_CONFIG against that directory too", () => {
    expect(configPathFromEnv({ INIT_CWD: root, MODELHARBOR_CONFIG: "./live.json" }, serverDir)).toBe(join(root, "live.json"));
  });
  it("falls back to the process cwd when not run through npm", () => {
    expect(configPathFromEnv({}, serverDir)).toBe(join(serverDir, "modelharbor.config.json"));
  });
});

