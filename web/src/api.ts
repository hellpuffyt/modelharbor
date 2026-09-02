import type { ExecuteResult, HealthResponse, ModelHarborConfig, RouteDecision, TaskType, UsageSummary } from "./types";

/**
 * Base URL for the API. In dev, Vite proxies /api to the server (see vite.config.ts).
 * In a production build, set VITE_API_BASE_URL at build time to point at a deployed
 * server origin; it defaults to same-origin "" so the two can also be served together.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch (err) {
    throw new ApiError(0, err instanceof Error ? err.message : "network error: could not reach the ModelHarbor server");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : `HTTP ${String(res.status)}`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

export function fetchConfig(): Promise<ModelHarborConfig> {
  return request<ModelHarborConfig>("/api/config");
}

export function fetchHealth(force = false): Promise<HealthResponse> {
  return request<HealthResponse>(`/api/health${force ? "?force=true" : ""}`);
}

export function fetchRoute(task: TaskType): Promise<RouteDecision> {
  return request<RouteDecision>(`/api/route?task=${encodeURIComponent(task)}`);
}

export function runTask(task: TaskType, prompt: string): Promise<ExecuteResult> {
  return request<ExecuteResult>("/api/route", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task, prompt }),
  });
}

export function fetchUsage(): Promise<UsageSummary> {
  return request<UsageSummary>("/api/usage");
}

export interface UsageEventsResponse {
  events: import("./types").UsageEvent[];
}

export function fetchUsageEvents(limit = 20): Promise<UsageEventsResponse> {
  return request<UsageEventsResponse>(`/api/usage/events?limit=${String(limit)}`);
}
