import { resolve as resolvePath } from "node:path";

/** Where the server listens. Loopback by default: the API holds provider keys and has no auth. */
export interface ListenOptions {
  host: string;
  port: number;
  corsOrigin: string | undefined;
}

export function listenOptionsFromEnv(env: NodeJS.ProcessEnv): ListenOptions {
  const port = Number(env.PORT ?? 4180);
  const cors = env.MODELHARBOR_CORS_ORIGIN?.trim();
  return {
    host: env.HOST?.trim() || "127.0.0.1",
    port: Number.isInteger(port) && port >= 0 && port < 65536 ? port : 4180,
    corsOrigin: cors && cors !== "*" ? cors : undefined,
  };
}

/**
 * Resolves a user-supplied path the way the user typed it. `npm run dev:server`
 * runs inside server/, but npm records the directory it was invoked from in
 * INIT_CWD, so relative paths (and the default config) resolve against that.
 */
export function resolveUserPath(path: string, env: NodeJS.ProcessEnv, cwd: string): string {
  return resolvePath(env.INIT_CWD ?? cwd, path);
}

export function configPathFromEnv(env: NodeJS.ProcessEnv, cwd: string): string {
  return resolveUserPath(env.MODELHARBOR_CONFIG ?? "modelharbor.config.json", env, cwd);
}
