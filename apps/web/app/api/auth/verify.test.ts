import { afterEach, describe, expect, it, vi } from "vitest";
import { SiweMessage, generateNonce } from "siwe";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sealData } from "iron-session";

/**
 * Verify-route hardening — the "failed to sign message" follow-up.
 *
 * Symptom: the wallet signs the SIWE message successfully, but sign-in still fails.
 * RainbowKit renders ANY non-ok /api/auth/verify response as a generic sign-in
 * error, so a backend outage (the database unreachable, or migrations not applied)
 * looked identical to "your signature was rejected" — and the route logged nothing,
 * so the real cause was invisible server-side.
 *
 * These tests drive the REAL route handler with a REAL EIP-191 signature (viem),
 * mocking only the DB persistence seam so both outcomes are exercised:
 *   - persistence OK    → 200 + { address } (the wallet is recorded, nonce consumed).
 *   - persistence FAILS → 503 (NOT 401, NOT a silent 500) + a server-side log, so the
 *     honest "temporarily unavailable" reaches the client and the cause reaches ops.
 *   - bad signature     → 401 before the DB is ever touched (unchanged).
 */

const TEST_PASSWORD = "commitai_test_session_password_0123456789"; // >= 32 chars
const DOMAIN = "localhost:3000";
const URI = "http://localhost:3000";
const CHAIN_ID = 968;
const BASE = "http://localhost:3000";

process.env["SESSION_PASSWORD"] = TEST_PASSWORD;

// next/headers cookie seam (same pattern as app/api/security.test.ts): a test
// presents a session by sealing data into the cookie value; `set` is a no-op so
// session.save() completes without a real request scope.
const state = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.cookie !== undefined ? { name, value: state.cookie } : undefined),
    set: () => {},
    delete: () => {},
  }),
}));

// DB persistence seam: the ONLY faked thing is whether ensureWallet succeeds — the
// signature verification below is real cryptography.
const ensureWallet = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ ensureWallet }));

import { POST as postVerify } from "./verify/route";

async function setSession(data: { address?: string; nonce?: string } | null): Promise<void> {
  state.cookie = data === null ? undefined : await sealData(data, { password: TEST_PASSWORD });
}

/** Produce a genuine SIWE message + EIP-191 signature bound to `nonce`. */
async function signInPayload(nonce: string) {
  const account = privateKeyToAccount(generatePrivateKey());
  const message = new SiweMessage({
    domain: DOMAIN,
    address: account.address,
    statement: "Sign in to CommitAI to manage your goals and commitments.",
    uri: URI,
    version: "1",
    chainId: CHAIN_ID,
    nonce,
  }).prepareMessage();
  const signature = await account.signMessage({ message });
  return { account, message, signature };
}

function verifyReq(body: unknown): Request {
  return new Request(`${BASE}/api/auth/verify`, {
    method: "POST",
    headers: { origin: BASE, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  ensureWallet.mockReset();
});

describe("POST /api/auth/verify", () => {
  it("completes sign-in (200 + verified address) for a valid signature when the DB is available", async () => {
    const nonce = generateNonce();
    await setSession({ nonce });
    const { account, message, signature } = await signInPayload(nonce);
    ensureWallet.mockResolvedValue({ address: account.address.toLowerCase() });

    const res = await postVerify(verifyReq({ message, signature }));

    expect(res.status).toBe(200);
    const json = (await res.json()) as { address?: string };
    expect(json.address).toBe(account.address.toLowerCase());
    expect(ensureWallet).toHaveBeenCalledOnce();
  });

  it("returns a LOGGED 503 (not 401, not a silent 500) when the signature is valid but persistence fails", async () => {
    const nonce = generateNonce();
    await setSession({ nonce });
    const { message, signature } = await signInPayload(nonce);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // The real-world cause: DB unreachable / migrations not applied.
    ensureWallet.mockRejectedValue(new Error("Can't reach database server at localhost:5432"));

    const res = await postVerify(verifyReq({ message, signature }));

    // A valid signature is NOT an auth rejection...
    expect(res.status).not.toBe(401);
    // ...it is an honest, retryable "temporarily unavailable".
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toMatch(/unavailable/i);
    // The real cause is logged server-side for diagnosis...
    expect(errSpy).toHaveBeenCalled();
    // ...but the raw DB error never leaks to the client.
    expect(JSON.stringify(json)).not.toMatch(/localhost:5432/);
  });

  it("still rejects an invalid signature with 401 before ever touching the DB", async () => {
    const nonce = generateNonce();
    await setSession({ nonce });
    const { message } = await signInPayload(nonce);
    const forged = `0x${"11".repeat(65)}`;

    const res = await postVerify(verifyReq({ message, signature: forged }));

    expect(res.status).toBe(401);
    expect(ensureWallet).not.toHaveBeenCalled();
  });
});
