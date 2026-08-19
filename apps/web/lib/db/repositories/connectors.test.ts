import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deleteConnector,
  getConnectorStatus,
  getConnectorToken,
  listConnectors,
  prisma,
  upsertConnector,
} from "@/lib/db";
import { probeDatabaseReady } from "@/lib/db/probe";

/**
 * Evidence-connector persistence (LIMITATIONS item 8), DB-gated. Proves the repo's
 * security promises: the OAuth token is stored ENCRYPTED (never plaintext),
 * decrypts back only via `getConnectorToken`, status reads never leak it,
 * re-connect replaces in place, and every read/write is strictly wallet-scoped.
 */

// The repo derives its encryption key from SESSION_PASSWORD; set one for the run.
process.env["SESSION_PASSWORD"] ??= "test-session-password-at-least-32-chars-long";

const WALLET_A = "0xc0ffee0000000000000000000000000000000001";
const WALLET_B = "0xc0ffee0000000000000000000000000000000002";

const dbReady = await probeDatabaseReady();
if (!dbReady) {
  console.info("[connectors.repo] tests SKIPPED — no migrated Postgres reachable at DATABASE_URL.");
}

describe.skipIf(!dbReady)("evidence connector repository", () => {
  beforeAll(async () => {
    await prisma.evidenceConnector.deleteMany({
      where: { walletAddress: { in: [WALLET_A, WALLET_B] } },
    });
  });

  afterAll(async () => {
    await prisma.evidenceConnector.deleteMany({
      where: { walletAddress: { in: [WALLET_A, WALLET_B] } },
    });
    await prisma.wallet.deleteMany({ where: { address: { in: [WALLET_A, WALLET_B] } } });
    await prisma.$disconnect();
  });

  it("stores the token encrypted and round-trips it only via getConnectorToken", async () => {
    const status = await upsertConnector(WALLET_A, {
      provider: "GITHUB",
      externalLogin: "octocat",
      accessToken: "gho_secretToken_do_not_leak",
      scope: "read:user",
    });
    expect(status.externalLogin).toBe("octocat");
    // Status carries no token field at all.
    expect(JSON.stringify(status)).not.toContain("gho_secretToken");

    // Raw row must NOT contain the plaintext token.
    const raw = await prisma.evidenceConnector.findUniqueOrThrow({
      where: { walletAddress_provider: { walletAddress: WALLET_A, provider: "GITHUB" } },
    });
    expect(raw.accessTokenEnc).not.toContain("gho_secretToken");
    expect(raw.accessTokenEnc.split(".")).toHaveLength(3); // iv.tag.ciphertext

    // Only getConnectorToken decrypts it back.
    expect(await getConnectorToken(WALLET_A, "GITHUB")).toBe("gho_secretToken_do_not_leak");
  });

  it("re-connecting replaces the connection in place (one row, new token)", async () => {
    await upsertConnector(WALLET_A, {
      provider: "GITHUB",
      externalLogin: "octocat-renamed",
      accessToken: "gho_rotated",
      scope: "read:user",
    });
    const rows = await prisma.evidenceConnector.findMany({ where: { walletAddress: WALLET_A } });
    expect(rows).toHaveLength(1);
    const status = await getConnectorStatus(WALLET_A, "GITHUB");
    expect(status?.externalLogin).toBe("octocat-renamed");
    expect(await getConnectorToken(WALLET_A, "GITHUB")).toBe("gho_rotated");
  });

  it("is wallet-scoped: B cannot see A's connection", async () => {
    expect(await getConnectorStatus(WALLET_B, "GITHUB")).toBeNull();
    expect(await getConnectorToken(WALLET_B, "GITHUB")).toBeNull();
    expect(await listConnectors(WALLET_B)).toEqual([]);
    expect(await listConnectors(WALLET_A)).toHaveLength(1);
  });

  it("disconnect deletes only the caller's connection and is idempotent", async () => {
    expect(await deleteConnector(WALLET_B, "GITHUB")).toBe(0); // nothing to delete
    expect(await deleteConnector(WALLET_A, "GITHUB")).toBe(1);
    expect(await getConnectorStatus(WALLET_A, "GITHUB")).toBeNull();
    expect(await deleteConnector(WALLET_A, "GITHUB")).toBe(0); // already gone
  });
});
