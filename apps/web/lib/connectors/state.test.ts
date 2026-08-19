import { describe, expect, it } from "vitest";
import { generateOAuthState, verifyOAuthState } from "./state";

/** Always-on: the OAuth CSRF-state contract — unguessable, and matched only by an
 *  exact, constant-time equal value. */
describe("OAuth state", () => {
  it("generates high-entropy, URL-safe, unique states", () => {
    const a = generateOAuthState();
    const b = generateOAuthState();
    expect(a).not.toBe(b);
    // 32 bytes base64url → 43 chars, no padding, URL-safe alphabet only.
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("verifies an exact match and rejects everything else (fail-closed)", () => {
    const s = generateOAuthState();
    expect(verifyOAuthState(s, s)).toBe(true);
    expect(verifyOAuthState(s, `${s}x`)).toBe(false); // length mismatch
    expect(verifyOAuthState(s, generateOAuthState())).toBe(false); // different value
    expect(verifyOAuthState(undefined, s)).toBe(false);
    expect(verifyOAuthState(s, undefined)).toBe(false);
    expect(verifyOAuthState("", "")).toBe(false);
  });
});
