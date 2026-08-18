"use client";

/**
 * Browser fetch client for the CommitAI read/write API (build step 9, phase 2).
 *
 * `apiGet` sends the session cookie (`credentials: "include"`) so the server can
 * resolve the SIWE wallet, and surfaces the server's status code as a typed
 * `ApiError` so hooks can tell the states apart — 401 "connect your wallet" vs
 * 404 "not found" vs a real failure.
 *
 * There is deliberately no custom CSRF header here: the API's CSRF defence is the
 * same-origin `Origin` check in `middleware.ts` / `assertSameOrigin` (which the
 * browser sets automatically on state-changing requests). Adding a header the
 * server never validates would be security theatre, so we don't (CLAUDE.md
 * rule 1 — nothing that only looks like a control).
 */

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Non-JSON error body; fall back to the status text.
  }
  return res.statusText || `request failed (${res.status})`;
}

/** GET a JSON resource, throwing `ApiError` (with the HTTP status) on failure. */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new ApiError(res.status, await readError(res));
  }
  return (await res.json()) as T;
}
