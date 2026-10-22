import { readFileSync } from "node:fs";
import type { ModelHarborConfig, ModelPricing, ProviderConfig, ProviderKind, TaskType } from "./types.js";
import { TASK_TYPES } from "./types.js";
import { redactUrl } from "./redact.js";

export class ConfigError extends Error {}

function isTaskType(value: unknown): value is TaskType {
  return typeof value === "string" && (TASK_TYPES as readonly string[]).includes(value);
}

function parsePricing(raw: unknown, path: string): ModelPricing {
  if (typeof raw !== "object" || raw === null) {
    throw new ConfigError(`${path}.pricing must be an object`);
  }
  const obj = raw as Record<string, unknown>;
  const promptPer1k = obj.promptPer1k;
  const completionPer1k = obj.completionPer1k;
  if (typeof promptPer1k !== "number" || typeof completionPer1k !== "number") {
    throw new ConfigError(`${path}.pricing.promptPer1k and completionPer1k must be numbers`);
  }
  return { promptPer1k, completionPer1k };
}

function parseModel(raw: unknown, path: string): ProviderConfig["models"][number] {
  if (typeof raw !== "object" || raw === null) {
    throw new ConfigError(`${path} must be an object`);
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== "string" || obj.id.length === 0) {
    throw new ConfigError(`${path}.id must be a non-empty string`);
  }
  if (typeof obj.contextLength !== "number" || obj.contextLength <= 0) {
    throw new ConfigError(`${path}.contextLength must be a positive number`);
  }
  if (!Array.isArray(obj.tasks) || obj.tasks.length === 0 || !obj.tasks.every(isTaskType)) {
    throw new ConfigError(`${path}.tasks must be a non-empty array of valid task types (${TASK_TYPES.join(", ")})`);
  }
  const priority = obj.priority;
  if (typeof priority !== "number") {
    throw new ConfigError(`${path}.priority must be a number`);
  }
  return {
    id: obj.id,
    contextLength: obj.contextLength,
    tasks: obj.tasks,
    priority,
    pricing: parsePricing(obj.pricing ?? { promptPer1k: 0, completionPer1k: 0 }, path),
  };
}

const VALID_KINDS: readonly ProviderKind[] = ["ollama", "openai-compatible", "mock"];

function parseProvider(raw: unknown, index: number): ProviderConfig {
  const path = `providers[${index}]`;
  if (typeof raw !== "object" || raw === null) {
    throw new ConfigError(`${path} must be an object`);
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== "string" || obj.id.length === 0) {
    throw new ConfigError(`${path}.id must be a non-empty string`);
  }
  if (typeof obj.kind !== "string" || !VALID_KINDS.includes(obj.kind as ProviderKind)) {
    throw new ConfigError(`${path}.kind must be one of ${VALID_KINDS.join(", ")}`);
  }
  if (typeof obj.baseUrl !== "string" || obj.baseUrl.length === 0) {
    throw new ConfigError(`${path}.baseUrl must be a non-empty string`);
  }
  if (!Array.isArray(obj.models) || obj.models.length === 0) {
    throw new ConfigError(`${path}.models must be a non-empty array`);
  }
  const apiKey = typeof obj.apiKey === "string" ? obj.apiKey : undefined;
  return {
    id: obj.id,
    label: typeof obj.label === "string" && obj.label.length > 0 ? obj.label : obj.id,
    kind: obj.kind as ProviderKind,
    baseUrl: obj.baseUrl.replace(/\/+$/, ""),
    ...(apiKey !== undefined ? { apiKey } : {}),
    timeoutMs: typeof obj.timeoutMs === "number" && obj.timeoutMs > 0 ? obj.timeoutMs : 10_000,
    models: obj.models.map((m, i) => parseModel(m, `${path}.models[${i}]`)),
  };
}

export function parseConfig(raw: unknown): ModelHarborConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new ConfigError("config root must be an object");
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.providers) || obj.providers.length === 0) {
    throw new ConfigError("config.providers must be a non-empty array");
  }
  const providers = obj.providers.map((p, i) => parseProvider(p, i));
  const ids = new Set<string>();
  for (const p of providers) {
    if (ids.has(p.id)) {
      throw new ConfigError(`duplicate provider id "${p.id}"`);
    }
    ids.add(p.id);
  }
  const healthCacheMs = typeof obj.healthCacheMs === "number" && obj.healthCacheMs >= 0 ? obj.healthCacheMs : 15_000;
  return { providers, healthCacheMs };
}

export function loadConfigFromFile(path: string): ModelHarborConfig {
  const raw = readFileSync(path, "utf8");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`failed to parse ${path} as JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parseConfig(json);
}

/** Strips secrets before the config is ever sent to a client. */
export function redactConfig(config: ModelHarborConfig): ModelHarborConfig {
  return {
    ...config,
    providers: config.providers.map((p) => {
      const { apiKey, ...rest } = p;
      void apiKey;
      return { ...rest, baseUrl: redactUrl(rest.baseUrl) };
    }),
  };
}
