/**
 * HTTP-boundary errors and their status mapping (build step 9).
 *
 * The API layer throws these (or a `WalletScopeError` from the data layer) and
 * calls `toHttpError` to turn them into a status + body. Two invariants:
 *   - A wallet-scope violation maps to 403 with a GENERIC body, never echoing
 *     "resource not found for this wallet" — reads already return null so a
 *     caller can't tell "not yours" from "does not exist" (see lib/db/errors.ts).
 *   - Unknown errors map to a generic 500 that never leaks internal detail.
 */
import { ZodError } from "zod";
import { WalletScopeError } from "@/lib/db/errors";

export class UnauthorizedError extends Error {
  readonly code = "UNAUTHORIZED" as const;
  constructor(message = "authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN" as const;
  constructor(message = "forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class BadRequestError extends Error {
  readonly code = "BAD_REQUEST" as const;
  constructor(message = "bad request") {
    super(message);
    this.name = "BadRequestError";
  }
}

export interface HttpErrorShape {
  readonly status: number;
  readonly body: { readonly error: string };
}

/** Map any thrown value to a safe { status, body }. Never leaks internal detail. */
export function toHttpError(err: unknown): HttpErrorShape {
  if (err instanceof UnauthorizedError) return { status: 401, body: { error: err.message } };
  if (err instanceof ForbiddenError) return { status: 403, body: { error: err.message } };
  // Non-leaking: a scope violation must not reveal whether the row exists.
  if (err instanceof WalletScopeError) return { status: 403, body: { error: "forbidden" } };
  if (err instanceof BadRequestError) return { status: 400, body: { error: err.message } };
  if (err instanceof ZodError) return { status: 400, body: { error: "invalid request" } };
  return { status: 500, body: { error: "internal error" } };
}
