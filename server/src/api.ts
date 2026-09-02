import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { redactConfig } from "./config.js";
import { summarize, type UsageStore } from "./costStore.js";
import { executeTask } from "./execute.js";
import { HealthCache } from "./health.js";
import { route } from "./router.js";
import { TASK_TYPES } from "./types.js";
import type { ModelHarborConfig, ProviderClient, TaskType } from "./types.js";

export interface ApiDeps {
  config: ModelHarborConfig;
  clients: Map<string, ProviderClient>;
  healthCache: HealthCache;
  usageStore: UsageStore;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "access-control-allow-origin": "*",
  });
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim().length === 0) return {};
  return JSON.parse(text) as unknown;
}

function isTaskType(value: unknown): value is TaskType {
  return typeof value === "string" && (TASK_TYPES as readonly string[]).includes(value);
}

export function createApiServer(deps: ApiDeps): Server {
  const { config, clients, healthCache, usageStore } = deps;

  return createHttpServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";

    if (method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      res.end();
      return;
    }

    if (method === "GET" && url.pathname === "/api/config") {
      sendJson(res, 200, redactConfig(config));
      return;
    }

    if (method === "GET" && url.pathname === "/api/health") {
      const force = url.searchParams.get("force") === "true";
      const health = await healthCache.get(force);
      sendJson(res, 200, { checkedAt: new Date().toISOString(), models: health });
      return;
    }

    if (method === "GET" && url.pathname === "/api/route") {
      const taskParam = url.searchParams.get("task");
      if (!isTaskType(taskParam)) {
        sendJson(res, 400, { error: `query param "task" must be one of ${TASK_TYPES.join(", ")}` });
        return;
      }
      const health = await healthCache.get(false);
      const decision = route(config.providers, health, taskParam);
      sendJson(res, 200, decision);
      return;
    }

    if (method === "POST" && url.pathname === "/api/route") {
      const body = await readJsonBody(req);
      const obj = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
      const task = obj.task;
      const prompt = obj.prompt;
      if (!isTaskType(task)) {
        sendJson(res, 400, { error: `body.task must be one of ${TASK_TYPES.join(", ")}` });
        return;
      }
      if (typeof prompt !== "string" || prompt.length === 0) {
        sendJson(res, 400, { error: "body.prompt must be a non-empty string" });
        return;
      }
      const health = await healthCache.get(false);
      const result = await executeTask(config.providers, clients, health, task, prompt);
      for (const event of result.events) {
        usageStore.append(event);
      }
      sendJson(res, result.chosen ? 200 : 502, result);
      return;
    }

    if (method === "GET" && url.pathname === "/api/usage") {
      sendJson(res, 200, summarize(usageStore.all()));
      return;
    }

    if (method === "GET" && url.pathname === "/api/usage/events") {
      const limitParam = Number(url.searchParams.get("limit") ?? "50");
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 1000) : 50;
      const events = usageStore.all().slice(-limit).reverse();
      sendJson(res, 200, { events });
      return;
    }

    sendJson(res, 404, { error: `no route for ${method} ${url.pathname}` });
  }
}
