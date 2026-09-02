import type { ModelHealth, ProviderClient, ProviderConfig } from "./types.js";

/** A health result counts as "degraded" once latency crosses this threshold, even though the call succeeded. */
export const DEGRADED_LATENCY_MS = 4000;

export async function checkModelHealth(
  provider: ProviderConfig,
  client: ProviderClient,
  modelId: string,
  contextLength: number,
): Promise<ModelHealth> {
  const result = await client.checkHealth(modelId);
  const status: ModelHealth["status"] = !result.ok
    ? "down"
    : result.latencyMs > DEGRADED_LATENCY_MS
      ? "degraded"
      : "healthy";
  return {
    providerId: provider.id,
    providerLabel: provider.label,
    modelId,
    status,
    latencyMs: result.ok ? result.latencyMs : null,
    error: result.error,
    checkedAt: new Date().toISOString(),
    contextLength,
  };
}

/**
 * Runs health checks for every configured model across every provider, in parallel.
 * A failure on one model never prevents the others from reporting.
 */
export async function checkAllHealth(
  providers: ProviderConfig[],
  clients: Map<string, ProviderClient>,
): Promise<ModelHealth[]> {
  const jobs: Array<Promise<ModelHealth>> = [];
  for (const provider of providers) {
    const client = clients.get(provider.id);
    if (!client) continue;
    for (const model of provider.models) {
      jobs.push(checkModelHealth(provider, client, model.id, model.contextLength));
    }
  }
  return Promise.all(jobs);
}

/** Caches health results for a configurable TTL so bursts of requests don't hammer providers. */
export class HealthCache {
  private snapshot: ModelHealth[] = [];
  private fetchedAt = 0;

  constructor(
    private readonly providers: ProviderConfig[],
    private readonly clients: Map<string, ProviderClient>,
    private readonly ttlMs: number,
  ) {}

  async get(force = false): Promise<ModelHealth[]> {
    const age = Date.now() - this.fetchedAt;
    if (!force && this.snapshot.length > 0 && age < this.ttlMs) {
      return this.snapshot;
    }
    this.snapshot = await checkAllHealth(this.providers, this.clients);
    this.fetchedAt = Date.now();
    return this.snapshot;
  }

  peek(): ModelHealth[] {
    return this.snapshot;
  }
}
