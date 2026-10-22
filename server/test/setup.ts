/**
 * Network guard for the whole suite: no test may reach a real LLM provider.
 * Any fetch() to a non-loopback host fails loudly. Tests that exercise the
 * HTTP adapters replace fetch with a clearly labelled stub (vi.stubGlobal),
 * and the API tests only talk to a server on 127.0.0.1.
 */
import { afterEach, beforeEach, vi } from "vitest";
import { guardedFetch } from "./networkGuard.js";


beforeEach(() => {
  vi.stubGlobal("fetch", guardedFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});
