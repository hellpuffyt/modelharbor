export type TaskType = "code" | "chat" | "fast" | "long-context";

export const TASK_TYPES: readonly TaskType[] = ["code", "chat", "fast", "long-context"];

export interface ModelPricing {
  /** USD per 1000 prompt tokens. 0 for free/local models. */
  promptPer1k: number;
  /** USD per 1000 completion tokens. 0 for free/local models. */
  completionPer1k: number;
}

export interface ModelConfig {
  /** Model identifier as the provider knows it, e.g. "qwen2.5-coder:7b". */
  id: string;
  contextLength: number;
  pricing: ModelPricing;
  /** Task types this model is eligible to be routed for. */
  tasks: TaskType[];
  /** Lower priority number is preferred within a task's candidate pool. */
  priority: number;
}

export type ProviderKind = "ollama" | "openai-compatible" | "mock";

export interface ProviderConfig {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Optional bearer token, used only for openai-compatible providers. Never logged or exposed via the API. */
  apiKey?: string;
  models: ModelConfig[];
  /** Request timeout in milliseconds for health checks and generation calls. */
  timeoutMs: number;
}

export interface ModelHarborConfig {
  providers: ProviderConfig[];
  /** How long a health check result is considered fresh, in milliseconds. */
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

export interface GenerateResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

export interface ProviderClient {
  readonly config: ProviderConfig;
  listModels(): Promise<string[]>;
  checkHealth(modelId: string): Promise<{ ok: boolean; latencyMs: number; error: string | null }>;
  generate(modelId: string, prompt: string): Promise<GenerateResult>;
}
