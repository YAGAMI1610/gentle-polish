import { describe, expect, it } from "vitest";
import { decryptSecret, deriveConnectorKey, encryptSecret } from "./crypto";

const SECRET_ENV = { SESSION_PASSWORD: "x".repeat(40) };

/**
 * Always-on: connector tokens are encrypted at rest with AES-256-GCM. These prove
 * confidentiality (ciphertext ≠ plaintext, randomised per call) AND integrity
 * (tamper / wrong key → throw), plus the fail-loud key-derivation contract.
 */
describe("deriveConnectorKey", () => {
  it("derives a stable 32-byte key from the server secret", () => {
    const a = deriveConnectorKey(SECRET_ENV);
    const b = deriveConnectorKey(SECRET_ENV);
    expect(a).toHaveLength(32);
    expect(a.equals(b)).toBe(true);
  });

  it("prefers CONNECTOR_TOKEN_SECRET over SESSION_PASSWORD", () => {
    const viaDedicated = deriveConnectorKey({ CONNECTOR_TOKEN_SECRET: "y".repeat(40) });
    const viaSession = deriveConnectorKey(SECRET_ENV);
    expect(viaDedicated.equals(viaSession)).toBe(false);
  });

  it("throws (no weak fallback) when no adequate secret is configured", () => {
    expect(() => deriveConnectorKey({})).toThrow(/CONNECTOR_TOKEN_SECRET/);
    expect(() => deriveConnectorKey({ SESSION_PASSWORD: "tooshort" })).toThrow();
  });
});

describe("encryptSecret / decryptSecret", () => {
  const key = deriveConnectorKey(SECRET_ENV);

  it("round-trips a value", () => {
    const plaintext = "gho_exampleAccessToken1234567890";
    const enc = encryptSecret(plaintext, key);
    expect(enc).not.toContain(plaintext);
    expect(decryptSecret(enc, key)).toBe(plaintext);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const p = "same-token";
    expect(encryptSecret(p, key)).not.toBe(encryptSecret(p, key));
  });

  it("throws when the ciphertext is tampered (GCM integrity)", () => {
    const enc = encryptSecret("tok", key);
    const parts = enc.split(".");
    // Flip a byte in the ciphertext segment.
    const data = Buffer.from(parts[2] as string, "base64");
    data[0] = data[0]! ^ 0xff;
    const tampered = [parts[0], parts[1], data.toString("base64")].join(".");
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it("throws when decrypted with the wrong key", () => {
    const enc = encryptSecret("tok", key);
    const otherKey = deriveConnectorKey({ CONNECTOR_TOKEN_SECRET: "z".repeat(40) });
    expect(() => decryptSecret(enc, otherKey)).toThrow();
  });

  it("throws on a malformed envelope", () => {
    expect(() => decryptSecret("not-three-parts", key)).toThrow(/malformed/);
  });
});
