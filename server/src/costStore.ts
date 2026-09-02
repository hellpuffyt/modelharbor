import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ModelPricing, UsageEvent } from "./types.js";

export function computeCostUsd(pricing: ModelPricing, promptTokens: number, completionTokens: number): number {
  const cost = (promptTokens / 1000) * pricing.promptPer1k + (completionTokens / 1000) * pricing.completionPer1k;
  // Round to 6 decimal places (micro-cent precision) to avoid float noise in the dashboard.
  return Math.round(cost * 1e6) / 1e6;
}

export interface UsageStore {
  append(event: UsageEvent): void;
  all(): UsageEvent[];
}

/** In-memory store. Used in tests and as the default when no persistence path is configured. */
export class MemoryUsageStore implements UsageStore {
  private events: UsageEvent[] = [];

  append(event: UsageEvent): void {
    this.events.push(event);
  }

  all(): UsageEvent[] {
    return [...this.events];
  }
}

/** Append-only JSON-Lines file store: one UsageEvent per line, survives restarts. */
export class FileUsageStore implements UsageStore {
  private cache: UsageEvent[];

  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    if (!existsSync(filePath)) {
      this.cache = [];
      return;
    }
    const raw = readFileSync(filePath, "utf8");
    this.cache = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as UsageEvent);
  }

  append(event: UsageEvent): void {
    this.cache.push(event);
    appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
  }

  all(): UsageEvent[] {
    return [...this.cache];
  }
}

export interface UsageAggregate {
  key: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  totalCostUsd: number;
  promptTokens: number;
  completionTokens: number;
  averageLatencyMs: number;
}

function aggregateBy(events: UsageEvent[], keyFn: (e: UsageEvent) => string): UsageAggregate[] {
  const groups = new Map<string, UsageEvent[]>();
  for (const event of events) {
    const key = keyFn(event);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(event);
    } else {
      groups.set(key, [event]);
    }
  }
  const result: UsageAggregate[] = [];
  for (const [key, bucket] of groups) {
    const successCount = bucket.filter((e) => e.success).length;
    const totalLatency = bucket.reduce((sum, e) => sum + e.latencyMs, 0);
    result.push({
      key,
      requestCount: bucket.length,
      successCount,
      failureCount: bucket.length - successCount,
      totalCostUsd: Math.round(bucket.reduce((sum, e) => sum + e.costUsd, 0) * 1e6) / 1e6,
      promptTokens: bucket.reduce((sum, e) => sum + e.promptTokens, 0),
      completionTokens: bucket.reduce((sum, e) => sum + e.completionTokens, 0),
      averageLatencyMs: Math.round(totalLatency / bucket.length),
    });
  }
  result.sort((a, b) => b.totalCostUsd - a.totalCostUsd || a.key.localeCompare(b.key));
  return result;
}

export interface UsageSummary {
  totalRequests: number;
  totalCostUsd: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  byModel: UsageAggregate[];
  byProvider: UsageAggregate[];
  byTask: UsageAggregate[];
  byDay: UsageAggregate[];
}

export function summarize(events: UsageEvent[]): UsageSummary {
  return {
    totalRequests: events.length,
    totalCostUsd: Math.round(events.reduce((sum, e) => sum + e.costUsd, 0) * 1e6) / 1e6,
    totalPromptTokens: events.reduce((sum, e) => sum + e.promptTokens, 0),
    totalCompletionTokens: events.reduce((sum, e) => sum + e.completionTokens, 0),
    byModel: aggregateBy(events, (e) => `${e.providerId}/${e.modelId}`),
    byProvider: aggregateBy(events, (e) => e.providerId),
    byTask: aggregateBy(events, (e) => e.task),
    byDay: aggregateBy(events, (e) => e.timestamp.slice(0, 10)),
  };
}
