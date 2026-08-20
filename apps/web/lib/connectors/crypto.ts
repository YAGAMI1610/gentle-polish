/**
 * Authenticated encryption for connector secrets at rest (LIMITATIONS.md item 8).
 *
 * A GitHub OAuth access token grants read access to a user's account, so it must
 * NOT be stored in plaintext in the database. `EvidenceConnector.accessTokenEnc`
 * holds the output of `encryptSecret`; the token is decrypted only in-process,
 * server-side, at the moment an import call needs it (`getConnectorToken`).
 *
 * AES-256-GCM gives confidentiality AND integrity: a tampered ciphertext fails the
 * auth-tag check on decrypt and throws, rather than returning garbage. The key is
 * derived (scrypt) from a server secret, so a stolen DB dump without the secret is
 * useless. No new required secret is forced on existing deployments: the key comes
 * from CONNECTOR_TOKEN_SECRET when set, else falls back to SESSION_PASSWORD (which
 * every deployment already sets, ≥32 chars — see session-core).
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

type Env = Record<string, string | undefined>;

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Fixed, non-secret salt: the input secret is high-entropy, and a stable salt
 *  keeps the derived key deterministic so any process can decrypt what another
 *  wrote. (A per-record salt would need to be stored alongside; unnecessary here.) */
const KEY_SALT = "commitai:connector-token:v1";
const MIN_SECRET_LENGTH = 32;

/**
 * Derive the 32-byte AES key from the server secret. Throws (loudly, no fake
 * fallback) when no adequate secret is configured — refusing to "encrypt" with a
 * weak/absent key rather than silently storing near-plaintext.
 */
export function deriveConnectorKey(env: Env = process.env): Buffer {
  const secret = env["CONNECTOR_TOKEN_SECRET"]?.trim() || env["SESSION_PASSWORD"]?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `CONNECTOR_TOKEN_SECRET (or SESSION_PASSWORD) must be set to at least ${MIN_SECRET_LENGTH} characters to encrypt connector tokens.`,
    );
  }
  return scryptSync(secret, KEY_SALT, KEY_BYTES);
}

/**
 * Encrypt a UTF-8 secret with AES-256-GCM. Output is `iv.tag.ciphertext`, each
 * segment base64 — self-describing so `decryptSecret` needs only the key. A fresh
 * random IV per call means the same plaintext never encrypts to the same string.
 */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

/**
 * Decrypt a value produced by `encryptSecret`. Throws on a malformed envelope OR
 * on any tampering (the GCM auth-tag check fails) — an integrity guarantee, not
 * just confidentiality. A wrong key also throws rather than returning garbage.
 */
export function decryptSecret(token: string, key: Buffer): string {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("malformed encrypted secret: expected iv.tag.ciphertext");
  }
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("malformed encrypted secret: bad iv/tag length");
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
