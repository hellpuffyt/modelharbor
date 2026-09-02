import type { GenerateResult, ProviderClient, ProviderConfig } from "../types.js";

/**
 * Deterministic mock provider used in CI and for local demos where no real API keys
 * exist. It exercises the exact same interface as the live clients (listModels,
 * checkHealth, generate) so the health/routing/cost pipeline runs end-to-end without
 * any network access, and always produces the same sequence of results for a given
 * config — no flakiness, nothing random.
 *
 * Behavior is derived purely from the modelId string and a per-instance call counter:
 *  - a modelId containing "down" always fails health checks and generate calls.
 *  - a modelId containing "slow" reports latency above the degraded threshold.
 *  - a modelId containing "flaky" fails generate on every 3rd call (deterministic,
 *    not random) so the failover path in execute.ts is exercised in tests and demos.
 *  - every other model reports healthy with a small deterministic latency derived
 *    from a stable hash of its id.
 */
function stableHash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

export class MockProviderClient implements ProviderClient {
  private callCounts = new Map<string, number>();

  constructor(public readonly config: ProviderConfig) {}

  private nextCall(modelId: string): number {
    const count = (this.callCounts.get(modelId) ?? 0) + 1;
    this.callCounts.set(modelId, count);
    return count;
  }

  listModels(): Promise<string[]> {
    return Promise.resolve(this.config.models.map((m) => m.id));
  }

  checkHealth(modelId: string): Promise<{ ok: boolean; latencyMs: number; error: string | null }> {
    if (modelId.includes("down")) {
      return Promise.resolve({ ok: false, latencyMs: 0, error: "mock: model marked down" });
    }
    const base = 20 + (stableHash(modelId) % 180);
    const latencyMs = modelId.includes("slow") ? base + 4500 : base;
    return Promise.resolve({ ok: true, latencyMs, error: null });
  }

  generate(modelId: string, prompt: string): Promise<GenerateResult> {
    const call = this.nextCall(modelId);
    if (modelId.includes("down")) {
      return Promise.reject(new Error(`mock: ${modelId} is down`));
    }
    if (modelId.includes("flaky") && call % 3 === 0) {
      return Promise.reject(new Error(`mock: ${modelId} flaked on call #${String(call)}`));
    }
    const base = 20 + (stableHash(modelId) % 180);
    const latencyMs = modelId.includes("slow") ? base + 4500 : base;
    const promptTokens = Math.max(1, Math.round(prompt.length / 4));
    const completionTokens = 8 + (stableHash(`${modelId}:${String(call)}`) % 64);
    return Promise.resolve({
      text: `[mock:${modelId}] response #${String(call)} to: ${prompt.slice(0, 60)}`,
      promptTokens,
      completionTokens,
      latencyMs,
    });
  }
}
