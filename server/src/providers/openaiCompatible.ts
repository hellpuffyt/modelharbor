import type { GenerateResult, ProviderClient, ProviderConfig } from "../types.js";
import { redactSecrets } from "../redact.js";

interface OpenAiModelsResponse {
  data: Array<{ id: string }>;
}

interface OpenAiChatResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

/** Client for any OpenAI-compatible chat-completions HTTP endpoint (LM Studio, vLLM, LiteLLM, OpenRouter, etc.). */
export class OpenAiCompatibleClient implements ProviderClient {
  constructor(public readonly config: ProviderConfig) {}

  /** Error text can reach the dashboard, so it never carries credentials. */
  private clean(message: string): string {
    return redactSecrets(message, [this.config.apiKey]);
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.config.apiKey) {
      headers.authorization = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.config.baseUrl}/models`, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(this.clean(`${this.config.baseUrl}/models returned ${res.status}`));
    }
    const body = (await res.json()) as OpenAiModelsResponse;
    return body.data.map((m) => m.id);
  }

  async checkHealth(modelId: string): Promise<{ ok: boolean; latencyMs: number; error: string | null }> {
    const { signal, cancel } = withTimeout(this.config.timeoutMs);
    const start = performance.now();
    try {
      const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
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
      const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: prompt }] }),
        signal,
      });
      const latencyMs = Math.round(performance.now() - start);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(this.clean(`chat/completions failed with HTTP ${res.status}: ${text.slice(0, 200)}`));
      }
      const body = (await res.json()) as OpenAiChatResponse;
      return {
        text: body.choices[0]?.message.content ?? "",
        promptTokens: body.usage?.prompt_tokens ?? 0,
        completionTokens: body.usage?.completion_tokens ?? 0,
        latencyMs,
      };
    } finally {
      cancel();
    }
  }
}
