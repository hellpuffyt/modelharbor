import { afterEach, describe, expect, it, vi } from "vitest";
import { createProviderClient } from "../src/providers/factory.js";
import { OllamaClient } from "../src/providers/ollama.js";
import { OpenAiCompatibleClient } from "../src/providers/openaiCompatible.js";
import { MockProviderClient } from "../src/providers/mock.js";
import type { ProviderConfig } from "../src/types.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "p1",
    label: "P1",
    kind: "openai-compatible",
    baseUrl: "http://example.test/v1",
    timeoutMs: 5000,
    models: [{ id: "m1", contextLength: 8192, priority: 1, tasks: ["chat"], pricing: { promptPer1k: 0, completionPer1k: 0 } }],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("factory: createProviderClient", () => {
  it("creates an OllamaClient for kind 'ollama'", () => {
    expect(createProviderClient(config({ kind: "ollama" }))).toBeInstanceOf(OllamaClient);
  });

  it("creates an OpenAiCompatibleClient for kind 'openai-compatible'", () => {
    expect(createProviderClient(config({ kind: "openai-compatible" }))).toBeInstanceOf(OpenAiCompatibleClient);
  });

  it("creates a MockProviderClient for kind 'mock'", () => {
    expect(createProviderClient(config({ kind: "mock" }))).toBeInstanceOf(MockProviderClient);
  });

  it("throws for an unknown kind bypassing the type system", () => {
    const bad = config({ kind: "bogus" as ProviderConfig["kind"] });
    expect(() => createProviderClient(bad)).toThrow(/unknown provider kind/);
  });
});

describe("OpenAiCompatibleClient", () => {
  it("listModels maps the data array to ids", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ id: "gpt-x" }, { id: "gpt-y" }] })));
    const client = new OpenAiCompatibleClient(config());
    await expect(client.listModels()).resolves.toEqual(["gpt-x", "gpt-y"]);
  });

  it("listModels throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse(500, "boom")));
    const client = new OpenAiCompatibleClient(config());
    await expect(client.listModels()).rejects.toThrow(/returned 500/);
  });

  it("checkHealth returns ok on a successful chat completion", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: "pong" } }] })));
    const client = new OpenAiCompatibleClient(config());
    const result = await client.checkHealth("m1");
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
  });

  it("checkHealth returns not-ok with the response body on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse(503, "service unavailable")));
    const client = new OpenAiCompatibleClient(config());
    const result = await client.checkHealth("m1");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("503");
  });

  it("checkHealth catches a network-level rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const client = new OpenAiCompatibleClient(config());
    const result = await client.checkHealth("m1");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("generate sends an authorization header when apiKey is set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 3, completion_tokens: 4 } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new OpenAiCompatibleClient(config({ apiKey: "secret-token" }));
    await client.generate("m1", "hello");
    const calls: unknown = fetchMock.mock.calls;
    const firstCall = (calls as unknown[][])[0];
    const options = firstCall?.[1] as { headers: Record<string, string> };
    expect(options.headers.authorization).toBe("Bearer secret-token");
  });

  it("generate returns text and token usage from the response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: "hello there" } }], usage: { prompt_tokens: 5, completion_tokens: 7 } })),
    );
    const client = new OpenAiCompatibleClient(config());
    const result = await client.generate("m1", "hi");
    expect(result.text).toBe("hello there");
    expect(result.promptTokens).toBe(5);
    expect(result.completionTokens).toBe(7);
  });

  it("generate throws with response body on a non-ok status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse(429, "rate limited")));
    const client = new OpenAiCompatibleClient(config());
    await expect(client.generate("m1", "hi")).rejects.toThrow(/429/);
  });

  it("generate defaults token counts to 0 when usage is absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: "x" } }] })));
    const client = new OpenAiCompatibleClient(config());
    const result = await client.generate("m1", "hi");
    expect(result.promptTokens).toBe(0);
    expect(result.completionTokens).toBe(0);
  });
});

describe("OllamaClient", () => {
  it("listModels maps the models array to names", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { models: [{ name: "llama3" }, { name: "qwen" }] })));
    const client = new OllamaClient(config({ kind: "ollama", baseUrl: "http://localhost:11434" }));
    await expect(client.listModels()).resolves.toEqual(["llama3", "qwen"]);
  });

  it("listModels throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse(500, "err")));
    const client = new OllamaClient(config({ kind: "ollama" }));
    await expect(client.listModels()).rejects.toThrow(/api\/tags returned 500/);
  });

  it("checkHealth returns ok on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { response: "pong" })));
    const client = new OllamaClient(config({ kind: "ollama" }));
    const result = await client.checkHealth("m1");
    expect(result.ok).toBe(true);
  });

  it("checkHealth returns not-ok on a failing response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse(404, "model not found")));
    const client = new OllamaClient(config({ kind: "ollama" }));
    const result = await client.checkHealth("missing");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("404");
  });

  it("checkHealth catches a network-level rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));
    const client = new OllamaClient(config({ kind: "ollama" }));
    const result = await client.checkHealth("m1");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("generate returns response text and eval counts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { response: "hi there", prompt_eval_count: 2, eval_count: 9 })));
    const client = new OllamaClient(config({ kind: "ollama" }));
    const result = await client.generate("m1", "hello");
    expect(result.text).toBe("hi there");
    expect(result.promptTokens).toBe(2);
    expect(result.completionTokens).toBe(9);
  });

  it("generate throws with response body on a non-ok status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse(500, "internal error")));
    const client = new OllamaClient(config({ kind: "ollama" }));
    await expect(client.generate("m1", "hi")).rejects.toThrow(/generate failed with HTTP 500/);
  });

  it("generate defaults counts to 0 when absent from the response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { response: "x" })));
    const client = new OllamaClient(config({ kind: "ollama" }));
    const result = await client.generate("m1", "hi");
    expect(result.promptTokens).toBe(0);
    expect(result.completionTokens).toBe(0);
  });
});
