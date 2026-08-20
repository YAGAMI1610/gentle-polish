import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Nonce route hardening — debugging the wallet sign-in "Error preparing message".
 *
 * RainbowKit's getNonce() fetches THIS route during its "Preparing message…" phase;
 * if the response isn't ok, the modal shows the un-customisable "Error preparing
 * message, please retry!". So the route must (a) return a clean single-use nonce when
 * SESSION_PASSWORD is configured, and (b) when it is missing/short — the real local-dev
 * cause — fail with a HANDLED 500 + JSON error and a server-side log, never an unhandled
 * throw and never leaking the SESSION_PASSWORD hint to the client.
 */

const TEST_PASSWORD = "commitai_test_session_password_0123456789"; // >= 32 chars

// Same next/headers seam as app/api/security.test.ts: a no-op cookie store so the
// route can read/save a session without a real request scope.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  }),
}));

import { GET as getNonce } from "./nonce/route";

const savedPassword = process.env["SESSION_PASSWORD"];

afterEach(() => {
  if (savedPassword === undefined) delete process.env["SESSION_PASSWORD"];
  else process.env["SESSION_PASSWORD"] = savedPassword;
  vi.restoreAllMocks();
});

describe("GET /api/auth/nonce", () => {
  it("issues a single-use, cacheless SIWE nonce when SESSION_PASSWORD is set", async () => {
    process.env["SESSION_PASSWORD"] = TEST_PASSWORD;
    const res = await getNonce();

    expect(res.status).toBe(200);
    // A sign-in nonce must never be stored/replayed by a shared cache.
    expect(res.headers.get("cache-control")).toBe("no-store");
    const nonce = await res.text();
    // siwe generateNonce() → an alphanumeric string (>= 8 chars).
    expect(nonce).toMatch(/^[A-Za-z0-9]{8,}$/);
  });

  it("returns a handled 500 with a JSON error and a server log when SESSION_PASSWORD is missing", async () => {
    delete process.env["SESSION_PASSWORD"];
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // The route must CATCH the getSessionOptions() throw, not propagate it.
    const res = await getNonce();

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeTruthy();
    // The real cause is logged server-side for diagnosis...
    expect(errSpy).toHaveBeenCalled();
    // ...but the SESSION_PASSWORD hint never leaks to the client response.
    expect(JSON.stringify(body)).not.toMatch(/SESSION_PASSWORD/);
  });

  it("also fails safe with 500 when SESSION_PASSWORD is too short", async () => {
    process.env["SESSION_PASSWORD"] = "too-short";
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await getNonce();

    expect(res.status).toBe(500);
  });
});
