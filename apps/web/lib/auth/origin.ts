/**
 * Same-origin / CSRF defence for state-changing API requests (build step 9,
 * LIMITATIONS §4). Pure functions (no next/headers) so both the edge middleware
 * and each route handler can share exactly one implementation — defence in depth
 * without drift. The session cookie is SameSite=Lax + httpOnly; this Origin check
 * is the second layer that blocks a cross-site POST from riding the cookie.
 */
import { ForbiddenError } from "./errors";

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Allowed origin hosts (host:port) from APP_ORIGIN / NEXT_PUBLIC_APP_URL, if set. */
export function getConfiguredOriginHosts(): string[] {
  const raw = process.env["APP_ORIGIN"] ?? process.env["NEXT_PUBLIC_APP_URL"];
  if (!raw) return [];
  try {
    return [new URL(raw).host];
  } catch {
    return [];
  }
}

export interface OriginCheckInput {
  method: string;
  url: string;
  origin: string | null;
}

/**
 * True when the request is safe to process. Non-state-changing methods always
 * pass. State-changing methods must carry an Origin header whose host matches
 * the request host (same-origin) or a configured allowlist entry.
 */
export function isSameOrigin(input: OriginCheckInput): boolean {
  if (!STATE_CHANGING.has(input.method.toUpperCase())) return true;
  if (!input.origin) return false;

  let originHost: string;
  try {
    originHost = new URL(input.origin).host;
  } catch {
    return false;
  }
  if (!originHost) return false;

  let requestHost = "";
  try {
    requestHost = new URL(input.url).host;
  } catch {
    requestHost = "";
  }
  if (originHost === requestHost) return true;

  return getConfiguredOriginHosts().includes(originHost);
}

/** Throw ForbiddenError (→ 403) when a request fails the same-origin check. */
export function assertSameOrigin(req: Request): void {
  const ok = isSameOrigin({
    method: req.method,
    url: req.url,
    origin: req.headers.get("origin"),
  });
  if (!ok) {
    throw new ForbiddenError("cross-origin request refused");
  }
}

/**
 * The expected SIWE domain (host) for this request: the configured origin host
 * when set (correct behind a proxy), else the request's own host.
 */
export function getExpectedDomain(req: Request): string {
  const configured = getConfiguredOriginHosts();
  const first = configured[0];
  if (first) return first;
  try {
    return new URL(req.url).host;
  } catch {
    return "";
  }
}
