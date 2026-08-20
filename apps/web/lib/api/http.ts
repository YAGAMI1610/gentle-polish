/**
 * Server-only HTTP boundary helpers (build step 9, phase 3).
 *
 * Kept separate from `lib/api/client.ts` (which is `"use client"`): this imports
 * the server error types, so it must never be pulled into the browser bundle.
 */
import { BadRequestError } from "@/lib/auth/errors";

/**
 * Parse a JSON request body, turning a malformed or empty body into a 400 (via
 * `BadRequestError`) instead of the generic 500 an uncaught `SyntaxError` would
 * become. Returns `unknown` — the caller validates the shape (by handing it to a
 * zod schema, or a repo that parses its input), so this only guards the parse step.
 */
export async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new BadRequestError("request body must be valid JSON");
  }
}
