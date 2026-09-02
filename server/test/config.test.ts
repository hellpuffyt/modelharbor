import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfigFromFile, parseConfig, redactConfig } from "../src/config.js";
import type { ModelHarborConfig } from "../src/types.js";

const validProvider = {
  id: "p1",
  label: "Provider One",
  kind: "mock",
  baseUrl: "mock://p1",
  timeoutMs: 5000,
  models: [
    {
      id: "m1",
      contextLength: 8192,
      priority: 1,
      tasks: ["chat"],
      pricing: { promptPer1k: 0.001, completionPer1k: 0.002 },
    },
  ],
};

function withProviders(providers: unknown[]): unknown {
  return { providers };
}

describe("parseConfig", () => {
  it("parses a minimal valid config", () => {
    const config = parseConfig(withProviders([validProvider]));
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0]?.id).toBe("p1");
    expect(config.healthCacheMs).toBe(15_000);
  });

  it("defaults label to id when label is missing", () => {
    const { label, ...rest } = validProvider;
    void label;
    const config = parseConfig(withProviders([rest]));
    expect(config.providers[0]?.label).toBe("p1");
  });

  it("strips trailing slashes from baseUrl", () => {
    const config = parseConfig(withProviders([{ ...validProvider, baseUrl: "mock://p1///" }]));
    expect(config.providers[0]?.baseUrl).toBe("mock://p1");
  });

  it("defaults timeoutMs to 10000 when invalid", () => {
    const config = parseConfig(withProviders([{ ...validProvider, timeoutMs: -1 }]));
    expect(config.providers[0]?.timeoutMs).toBe(10_000);
  });

  it("respects an explicit healthCacheMs", () => {
    const config = parseConfig({ providers: [validProvider], healthCacheMs: 5000 });
    expect(config.healthCacheMs).toBe(5000);
  });

  it("defaults model pricing to zero when omitted", () => {
    const { pricing, ...model } = validProvider.models[0]!;
    void pricing;
    const config = parseConfig(withProviders([{ ...validProvider, models: [model] }]));
    expect(config.providers[0]?.models[0]?.pricing).toEqual({ promptPer1k: 0, completionPer1k: 0 });
  });

  it("rejects a non-object root", () => {
    expect(() => parseConfig(null)).toThrow(ConfigError);
    expect(() => parseConfig("nope")).toThrow(ConfigError);
  });

  it("rejects an empty providers array", () => {
    expect(() => parseConfig({ providers: [] })).toThrow(ConfigError);
  });

  it("rejects a missing providers field", () => {
    expect(() => parseConfig({})).toThrow(ConfigError);
  });

  it("rejects a provider missing id", () => {
    const { id, ...rest } = validProvider;
    void id;
    expect(() => parseConfig(withProviders([rest]))).toThrow(/id must be a non-empty string/);
  });

  it("rejects an invalid provider kind", () => {
    expect(() => parseConfig(withProviders([{ ...validProvider, kind: "bogus" }]))).toThrow(/kind must be one of/);
  });

  it("rejects a provider missing baseUrl", () => {
    const { baseUrl, ...rest } = validProvider;
    void baseUrl;
    expect(() => parseConfig(withProviders([rest]))).toThrow(/baseUrl must be a non-empty string/);
  });

  it("rejects a provider with an empty models array", () => {
    expect(() => parseConfig(withProviders([{ ...validProvider, models: [] }]))).toThrow(/models must be a non-empty array/);
  });

  it("rejects duplicate provider ids", () => {
    expect(() => parseConfig(withProviders([validProvider, validProvider]))).toThrow(/duplicate provider id/);
  });

  it("rejects a model missing an id", () => {
    const badModel = { ...validProvider.models[0], id: "" };
    expect(() => parseConfig(withProviders([{ ...validProvider, models: [badModel] }]))).toThrow(/id must be a non-empty string/);
  });

  it("rejects a model with a non-positive contextLength", () => {
    const badModel = { ...validProvider.models[0], contextLength: 0 };
    expect(() => parseConfig(withProviders([{ ...validProvider, models: [badModel] }]))).toThrow(/contextLength must be a positive number/);
  });

  it("rejects a model with an invalid task type", () => {
    const badModel = { ...validProvider.models[0], tasks: ["not-a-task"] };
    expect(() => parseConfig(withProviders([{ ...validProvider, models: [badModel] }]))).toThrow(/tasks must be a non-empty array/);
  });

  it("rejects a model with an empty tasks array", () => {
    const badModel = { ...validProvider.models[0], tasks: [] };
    expect(() => parseConfig(withProviders([{ ...validProvider, models: [badModel] }]))).toThrow(/tasks must be a non-empty array/);
  });

  it("rejects a model missing priority", () => {
    const { priority, ...badModel } = validProvider.models[0]!;
    void priority;
    expect(() => parseConfig(withProviders([{ ...validProvider, models: [badModel] }]))).toThrow(/priority must be a number/);
  });

  it("rejects pricing that is not an object", () => {
    const badModel = { ...validProvider.models[0], pricing: "free" };
    expect(() => parseConfig(withProviders([{ ...validProvider, models: [badModel] }]))).toThrow(/pricing must be an object/);
  });

  it("rejects pricing with non-numeric fields", () => {
    const badModel = { ...validProvider.models[0], pricing: { promptPer1k: "x", completionPer1k: 1 } };
    expect(() => parseConfig(withProviders([{ ...validProvider, models: [badModel] }]))).toThrow(/must be numbers/);
  });

  it("rejects a non-object model entry", () => {
    expect(() => parseConfig(withProviders([{ ...validProvider, models: [null] }]))).toThrow(/must be an object/);
  });

  it("rejects a non-object provider entry", () => {
    expect(() => parseConfig(withProviders(["nope"]))).toThrow(/must be an object/);
  });

  it("accepts multiple distinct providers", () => {
    const config = parseConfig(withProviders([validProvider, { ...validProvider, id: "p2" }]));
    expect(config.providers.map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});

describe("redactConfig", () => {
  it("removes apiKey from every provider", () => {
    const config: ModelHarborConfig = parseConfig(withProviders([{ ...validProvider, apiKey: "secret-123" }]));
    const redacted = redactConfig(config);
    expect((redacted.providers[0] as { apiKey?: string }).apiKey).toBeUndefined();
    expect(JSON.stringify(redacted)).not.toContain("secret-123");
  });

  it("leaves other provider fields intact", () => {
    const config = parseConfig(withProviders([validProvider]));
    const redacted = redactConfig(config);
    expect(redacted.providers[0]?.id).toBe("p1");
    expect(redacted.providers[0]?.models).toHaveLength(1);
  });

  it("does not mutate the original config", () => {
    const config = parseConfig(withProviders([{ ...validProvider, apiKey: "secret" }]));
    redactConfig(config);
    expect(config.providers[0]?.apiKey).toBe("secret");
  });
});

describe("loadConfigFromFile", () => {
  it("loads and parses a config file from disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "modelharbor-test-"));
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify(withProviders([validProvider])), "utf8");
    try {
      const config = loadConfigFromFile(path);
      expect(config.providers[0]?.id).toBe("p1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws ConfigError on invalid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "modelharbor-test-"));
    const path = join(dir, "config.json");
    writeFileSync(path, "{ not json", "utf8");
    try {
      expect(() => loadConfigFromFile(path)).toThrow(ConfigError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads the repository's real default config without error", () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const config = loadConfigFromFile(join(testDir, "..", "..", "modelharbor.config.json"));
    expect(config.providers.length).toBeGreaterThan(0);
  });
});
