import type { GenerateResult, ProviderClient, ProviderConfig } from "../types.js";
import { redactSecrets } from "../redact.js";

interface OllamaTagsResponse {
  models: Array<{ name: string }>;
}

interface OllamaGenerateResponse {
  response: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

/** Client for a real Ollama server (https://github.com/ollama/ollama REST API). */
export class OllamaClient implements ProviderClient {
  constructor(public readonly config: ProviderConfig) {}

  /** Error text can reach the dashboard, so it never carries credentials. */
  private clean(message: string): string {
    return redactSecrets(message, [this.config.apiKey]);
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.config.baseUrl}/api/tags`, { method: "GET" });
    if (!res.ok) {
      throw new Error(`ollama /api/tags returned ${res.status}`);
    }
    const body = (await res.json()) as OllamaTagsResponse;
    return body.models.map((m) => m.name);
  }

  async checkHealth(modelId: string): Promise<{ ok: boolean; latencyMs: number; error: string | null }> {
    const { signal, cancel } = withTimeout(this.config.timeoutMs);
    const start = performance.now();
    try {
      const res = await fetch(`${this.config.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: modelId, prompt: "ping", stream: false, options: { num_predict: 1 } }),
        signal,
      });
      const latencyMs = Math.round(performance.now() - start);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, latencyMs, error: this.clean(`HTTP ${res.status}: ${text.slice(0, 200)}`) };
      }
      await res.json();
      return { ok: true, latencyMs, error: null };
    } catch (err) {
      const latencyMs = Math.round(performance.now() - start);
      return { ok: false, latencyMs, error: this.clean(err instanceof Error ? err.message : String(err)) };
    } finally {
      cancel();
    }
  }

  async generate(modelId: string, prompt: string): Promise<GenerateResult> {
    const { signal, cancel } = withTimeout(this.config.timeoutMs);
    const start = performance.now();
    try {
      const res = await fetch(`${this.config.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: modelId, prompt, stream: false }),
        signal,
      });
      const latencyMs = Math.round(performance.now() - start);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(this.clean(`ollama generate failed with HTTP ${res.status}: ${text.slice(0, 200)}`));
      }
      const body = (await res.json()) as OllamaGenerateResponse;
      return {
        text: body.response,
        promptTokens: body.prompt_eval_count ?? 0,
        completionTokens: body.eval_count ?? 0,
        latencyMs,
      };
    } finally {
      cancel();
    }
  }
}
