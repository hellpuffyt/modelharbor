/**
 * Removes credentials from text that may leave the server (health-check
 * errors, failover reasons, /api/config). Upstream providers sometimes echo
 * part of the key or the Authorization header back in error bodies, and a
 * baseUrl can carry credentials in its userinfo or query string.
 */
const REDACTED = "[redacted]";

export function redactSecrets(text: string, secrets: ReadonlyArray<string | undefined> = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join(REDACTED);
  }
  return (
    out
      // Authorization header values.
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`)
      // Common provider key shapes (OpenAI/Anthropic-style "sk-...", including masked echoes).
      .replace(/\bsk-[A-Za-z0-9_*.-]{6,}/g, REDACTED)
      // Credentials embedded in URLs: scheme://user:pass@host
      .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, `$1${REDACTED}@`)
      // Key-like query parameters.
      .replace(/([?&](?:api[-_]?key|key|token|access_token|auth)=)[^&\s"']+/gi, `$1${REDACTED}`)
  );
}

/** A baseUrl safe to show a client: no userinfo, and key-like query values removed. */
export function redactUrl(raw: string): string {
  return redactSecrets(raw);
}
