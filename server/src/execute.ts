import { randomUUID } from "node:crypto";
import { computeCostUsd } from "./costStore.js";
import { buildCandidatePool } from "./router.js";
import type {
  ModelHealth,
  ProviderClient,
  ProviderConfig,
  RouteAttempt,
  RouteCandidate,
  TaskType,
  UsageEvent,
} from "./types.js";

export interface ExecuteResult {
  task: TaskType;
  attempted: RouteAttempt[];
  chosen: RouteCandidate | null;
  reason: string;
  text: string | null;
  /** Every usage event generated during this call, in attempt order (failed attempts first, then the final one). */
  events: UsageEvent[];
}

function findModelConfig(providers: ProviderConfig[], candidate: RouteCandidate) {
  const provider = providers.find((p) => p.id === candidate.providerId);
  const model = provider?.models.find((m) => m.id === candidate.modelId);
  return { provider, model };
}

function healthFor(health: ModelHealth[], candidate: RouteCandidate): ModelHealth | undefined {
  return health.find((h) => h.providerId === candidate.providerId && h.modelId === candidate.modelId);
}

/**
 * Routes a task to a real model and executes the prompt against it, with live failover:
 * if the chosen candidate's generate() call throws (timeout, connection refused, model
 * unloaded since the last health check, etc.) the next candidate in priority order is
 * tried instead, up to `maxAttempts` times. Every attempt — success or failure — is
 * recorded as a UsageEvent so the cost dashboard reflects reality, including wasted
 * failed calls.
 */
export async function executeTask(
  providers: ProviderConfig[],
  clients: Map<string, ProviderClient>,
  health: ModelHealth[],
  task: TaskType,
  prompt: string,
  maxAttempts = 3,
): Promise<ExecuteResult> {
  const pool = buildCandidatePool(providers, task);
  const attempted: RouteAttempt[] = [];
  const events: UsageEvent[] = [];

  if (pool.length === 0) {
    return {
      task,
      attempted,
      chosen: null,
      reason: `no model is configured for task "${task}"`,
      text: null,
      events,
    };
  }

  // Order: prefer candidates whose cached health is not "down", but still fall back to
  // an unknown/down one at the end rather than refusing outright — the cache can be stale.
  const ordered = [...pool].sort((a, b) => {
    const ha = healthFor(health, a.candidate)?.status ?? "down";
    const hb = healthFor(health, b.candidate)?.status ?? "down";
    const rank = (s: string) => (s === "down" ? 1 : 0);
    return rank(ha) - rank(hb);
  });

  let attempts = 0;
  for (const entry of ordered) {
    if (attempts >= maxAttempts) break;
    const h = healthFor(health, entry.candidate);
    if (h?.status === "down" && attempts < ordered.length - 1) {
      attempted.push({ candidate: entry.candidate, outcome: "skipped-unhealthy" });
      continue;
    }
    attempts += 1;
    const { provider, model } = findModelConfig(providers, entry.candidate);
    const client = clients.get(entry.candidate.providerId);
    if (!provider || !model || !client) {
      attempted.push({ candidate: entry.candidate, outcome: "skipped-unhealthy" });
      continue;
    }
    try {
      const result = await client.generate(entry.candidate.modelId, prompt);
      attempted.push({ candidate: entry.candidate, outcome: "selected" });
      const usageEvent: UsageEvent = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        providerId: entry.candidate.providerId,
        modelId: entry.candidate.modelId,
        task,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        costUsd: computeCostUsd(model.pricing, result.promptTokens, result.completionTokens),
        latencyMs: result.latencyMs,
        success: true,
        failoverCount: attempts - 1,
      };
      events.push(usageEvent);
      return {
        task,
        attempted,
        chosen: entry.candidate,
        reason:
          attempts === 1
            ? `selected ${entry.candidate.providerId}/${entry.candidate.modelId}`
            : `selected ${entry.candidate.providerId}/${entry.candidate.modelId} after ${attempts - 1} failover(s)`,
        text: result.text,
        events,
      };
    } catch (err) {
      const failEvent: UsageEvent = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        providerId: entry.candidate.providerId,
        modelId: entry.candidate.modelId,
        task,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        latencyMs: 0,
        success: false,
        failoverCount: attempts - 1,
      };
      events.push(failEvent);
      attempted.push({ candidate: entry.candidate, outcome: "skipped-unhealthy" });
      if (attempts >= maxAttempts || entry === ordered[ordered.length - 1]) {
        return {
          task,
          attempted,
          chosen: null,
          reason: `all attempted candidates failed for task "${task}": ${err instanceof Error ? err.message : String(err)}`,
          text: null,
          events,
        };
      }
    }
  }

  return {
    task,
    attempted,
    chosen: null,
    reason: `exhausted ${attempts} attempt(s) for task "${task}" without success`,
    text: null,
    events,
  };
}
