/** Rejects any fetch() to a non-loopback host; see test/setup.ts. */
const realFetch = globalThis.fetch;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function guardedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!LOOPBACK.has(url.hostname)) {
    return Promise.reject(new Error(`test network guard: refusing real request to ${url.origin}`));
  }
  return realFetch(input, init);
}
