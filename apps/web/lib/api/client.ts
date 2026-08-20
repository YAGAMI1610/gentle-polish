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

/**
 * Send a state-changing JSON request (POST/PUT/PATCH/DELETE) and parse the JSON
 * reply. `credentials: "include"` sends the session cookie; the browser sets the
 * `Origin` header the server's same-origin check validates — that is the CSRF
 * defence, so (as with `apiGet`) there is no bespoke CSRF token here. Throws a
 * typed `ApiError` so callers can branch on 401/403/413/415/503.
 */
export async function apiSend<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await readError(res));
  }
  return (await res.json()) as T;
}

/** POST a JSON body and parse the JSON reply (thin wrapper over `apiSend`). */
export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiSend<T>(path, "POST", body);
}

/**
 * POST a `multipart/form-data` body (evidence upload). We deliberately do NOT set
 * `Content-Type` — the browser adds it with the correct multipart boundary. Same
 * cookie + same-origin defence as the JSON senders.
 */
export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
    body: form,
  });
  if (!res.ok) {
    throw new ApiError(res.status, await readError(res));
  }
  return (await res.json()) as T;
}
