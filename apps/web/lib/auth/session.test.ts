import { afterEach, describe, expect, it } from "vitest";
import { sealData, unsealData } from "iron-session";
import { UnauthorizedError } from "./errors";
import {
  SESSION_COOKIE_NAME,
  getSessionOptions,
  requireWalletFromSession,
  type SessionData,
} from "./session-core";

const TEST_PASSWORD = "commitai_test_session_password_0123456789"; // >= 32 chars
const REAL_ADDRESS = "0x1111111111111111111111111111111111111111";

describe("getSessionOptions", () => {
  const prev = process.env["SESSION_PASSWORD"];
  afterEach(() => {
    if (prev === undefined) delete process.env["SESSION_PASSWORD"];
    else process.env["SESSION_PASSWORD"] = prev;
  });

  it("refuses to run when SESSION_PASSWORD is missing or too short (no weak fallback)", () => {
    process.env["SESSION_PASSWORD"] = "short";
    expect(() => getSessionOptions()).toThrow();
    delete process.env["SESSION_PASSWORD"];
    expect(() => getSessionOptions()).toThrow();
  });

  it("returns hardened cookie options with a valid password", () => {
    process.env["SESSION_PASSWORD"] = TEST_PASSWORD;
    const opts = getSessionOptions();
    expect(opts.cookieName).toBe(SESSION_COOKIE_NAME);
    expect(opts.cookieOptions?.["httpOnly"]).toBe(true);
    expect(opts.cookieOptions?.["sameSite"]).toBe("lax");
    expect(opts.cookieOptions?.["path"]).toBe("/");
  });
});

describe("requireWalletFromSession", () => {
  it("throws Unauthorized when no address is present", () => {
    expect(() => requireWalletFromSession({})).toThrow(UnauthorizedError);
  });

  it("returns the lowercased address when present", () => {
    expect(
      requireWalletFromSession({ address: "0xABCDEF0000000000000000000000000000000001" }),
    ).toBe("0xabcdef0000000000000000000000000000000001");
  });
});

describe("iron-session seal/unseal round-trip", () => {
  it("encrypts SessionData opaquely and recovers it with the same password", async () => {
    const data: SessionData = { address: REAL_ADDRESS, nonce: "noncevalue1234567", chainId: 968 };
    const sealed = await sealData(data, { password: TEST_PASSWORD });
    expect(typeof sealed).toBe("string");
    expect(sealed).not.toContain("1111"); // ciphertext, not plaintext
    const recovered = await unsealData<SessionData>(sealed, { password: TEST_PASSWORD });
    expect(recovered).toEqual(data);
  });

  it("fails to unseal a cookie sealed with a different password (tamper/forgery resistance)", async () => {
    const sealed = await sealData({ address: REAL_ADDRESS }, { password: TEST_PASSWORD });
    const otherPassword = "another_totally_different_password_987654";
    const recovered = await unsealData<SessionData>(sealed, { password: otherPassword });
    // iron-session returns {} rather than a forged identity on password mismatch.
    expect(recovered.address).toBeUndefined();
  });
});
