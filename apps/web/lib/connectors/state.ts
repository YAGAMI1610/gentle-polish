/**
 * OAuth 2.0 `state` parameter — CSRF defence for the authorization-code flow
 * (LIMITATIONS.md item 8).
 *
 * The `start` route mints a random state, stores it in the encrypted iron-session
 * cookie, and puts it on the authorize URL. GitHub echoes it back to the callback,
 * which must find an EXACT match against the session value before exchanging the
 * code — otherwise an attacker could trick a signed-in user into completing an
 * OAuth flow the attacker initiated (session fixation / login CSRF). Pure and
 * dependency-free so it is unit-testable without a request scope.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

/** 32 bytes of CSPRNG entropy, base64url — safe to place on a URL unescaped. */
export function generateOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * True iff `received` equals the `expected` state we stored. Constant-time compare
 * (timingSafeEqual) so a mismatch can't be probed byte-by-byte via timing; a
 * missing/empty value or a length mismatch is always a fail-closed false.
 */
export function verifyOAuthState(
  expected: string | undefined,
  received: string | undefined,
): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
