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

/**
 * 413 — an upload exceeds the size the boundary accepts. The evidence route
 * throws this at the edge (before touching storage) when a blob is over
 * `MAX_EVIDENCE_BYTES`, so the limit is enforced at the HTTP boundary and not
 * only deep in `storeEvidence` (§13, malicious-upload item).
 */
export class PayloadTooLargeError extends Error {
  readonly code = "PAYLOAD_TOO_LARGE" as const;
  constructor(message = "payload too large") {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

/**
 * 415 — the upload's MIME type is not on the evidence allowlist. Thrown at the
 * edge so a disallowed type is refused with the right status instead of a
 * generic 400/500.
 */
export class UnsupportedMediaTypeError extends Error {
  readonly code = "UNSUPPORTED_MEDIA_TYPE" as const;
  constructor(message = "unsupported media type") {
    super(message);
    this.name = "UnsupportedMediaTypeError";
  }
}

/**
 * 503 — a dependency the route needs is not configured (e.g. no `GEMINI_API_KEY`
 * for the AI turn route). This is the honest "not configured" surface CLAUDE.md
 * rule 1 requires: the route says the service is unavailable rather than faking
 * an answer.
 */
export class ServiceUnavailableError extends Error {
  readonly code = "SERVICE_UNAVAILABLE" as const;
  constructor(message = "service unavailable") {
    super(message);
    this.name = "ServiceUnavailableError";
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
  if (err instanceof PayloadTooLargeError) return { status: 413, body: { error: err.message } };
  if (err instanceof UnsupportedMediaTypeError)
    return { status: 415, body: { error: err.message } };
  if (err instanceof ServiceUnavailableError) return { status: 503, body: { error: err.message } };
  if (err instanceof ZodError) return { status: 400, body: { error: "invalid request" } };
  return { status: 500, body: { error: "internal error" } };
}
