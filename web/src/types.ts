// Mirrors server/src/types.ts. Kept as a small independent copy rather than a shared
// package so the web workspace has zero build-time dependency on the server workspace.

export type TaskType = "code" | "chat" | "fast" | "long-context";

export const TASK_TYPES: readonly TaskType[] = ["code", "chat", "fast", "long-context"];

export interface ModelPricing {
  promptPer1k: number;
  completionPer1k: number;
}

export interface ModelConfig {
  id: string;
  contextLength: number;
  pricing: ModelPricing;
  tasks: TaskType[];
  priority: number;
}

export type ProviderKind = "ollama" | "openai-compatible" | "mock";

export interface ProviderConfig {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  models: ModelConfig[];
  timeoutMs: number;
}

export interface ModelHarborConfig {
  providers: ProviderConfig[];
  healthCacheMs: number;
}

export type HealthStatus = "healthy" | "degraded" | "down";

export interface ModelHealth {
  providerId: string;
  providerLabel: string;
  modelId: string;
  status: HealthStatus;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
  contextLength: number;
}

export interface HealthResponse {
  checkedAt: string;
  models: ModelHealth[];
}

export interface RouteCandidate {
  providerId: string;
  modelId: string;
}

export interface RouteAttempt {
  candidate: RouteCandidate;
  outcome: "skipped-unhealthy" | "skipped-no-health-data" | "selected";
}

export interface RouteDecision {
  task: TaskType;
  chosen: RouteCandidate | null;
  attempted: RouteAttempt[];
  reason: string;
}

export interface ExecuteResult extends RouteDecision {
  text: string | null;
  events: UsageEvent[];
}

export interface UsageEvent {
  id: string;
  timestamp: string;
  providerId: string;
  modelId: string;
  task: TaskType;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
  success: boolean;
  failoverCount: number;
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
