import type { ModelHealth, ProviderConfig, RouteAttempt, RouteCandidate, RouteDecision, TaskType } from "./types.js";

interface PoolEntry {
  candidate: RouteCandidate;
  priority: number;
}

/**
 * Builds the ranked candidate pool for a task: every (provider, model) pair whose
 * model config lists the task, sorted by ascending priority (lower = more preferred).
 * Ties break on providerId then modelId for a fully deterministic order.
 */
export function buildCandidatePool(providers: ProviderConfig[], task: TaskType): PoolEntry[] {
  const pool: PoolEntry[] = [];
  for (const provider of providers) {
    for (const model of provider.models) {
      if (model.tasks.includes(task)) {
        pool.push({ candidate: { providerId: provider.id, modelId: model.id }, priority: model.priority });
      }
    }
  }
  pool.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.candidate.providerId !== b.candidate.providerId) {
      return a.candidate.providerId.localeCompare(b.candidate.providerId);
    }
    return a.candidate.modelId.localeCompare(b.candidate.modelId);
  });
  return pool;
}

function healthFor(health: ModelHealth[], candidate: RouteCandidate): ModelHealth | undefined {
  return health.find((h) => h.providerId === candidate.providerId && h.modelId === candidate.modelId);
}

/**
 * Picks a model for a task using the candidate pool in priority order, walking past
 * unhealthy or unknown-health candidates (failover) until one healthy candidate is found.
 * "degraded" candidates are treated as usable (still respond, just slow) so a slow-but-alive
 * model beats having nothing at all; only "down" or missing health data is skipped.
 */
export function route(providers: ProviderConfig[], health: ModelHealth[], task: TaskType): RouteDecision {
  const pool = buildCandidatePool(providers, task);
  const attempted: RouteAttempt[] = [];

  if (pool.length === 0) {
    return { task, chosen: null, attempted, reason: `no model is configured for task "${task}"` };
  }

  for (const entry of pool) {
    const h = healthFor(health, entry.candidate);
    if (!h) {
      attempted.push({ candidate: entry.candidate, outcome: "skipped-no-health-data" });
      continue;
    }
    if (h.status === "down") {
      attempted.push({ candidate: entry.candidate, outcome: "skipped-unhealthy" });
      continue;
    }
    attempted.push({ candidate: entry.candidate, outcome: "selected" });
    return {
      task,
      chosen: entry.candidate,
      attempted,
      reason: `selected ${entry.candidate.providerId}/${entry.candidate.modelId} (status: ${h.status})`,
    };
  }

  return {
    task,
    chosen: null,
    attempted,
    reason: `all ${pool.length} candidate(s) for task "${task}" are down or unreported`,
  };
}
