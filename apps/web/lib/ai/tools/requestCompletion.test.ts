import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGoal, ensureWallet, listChainTxs, prisma } from "@/lib/db";
import { probeDatabaseReady } from "@/lib/db/probe";
import { requestCompletionTool } from "./requestCompletion";
import type { ToolContext } from "./types";

/**
 * `requestCompletion` is the one tool here that DOES broadcast when configured — but
 * the call moves NO funds (the contract only transitions Active → CompletionRequested
 * and records the verification hash; the attestor key can call it but has no path to
 * value). These tests never reach a real broadcast: the always-on case is unconfigured,
 * and the DB-gated case (attestor configured) uses a goal with NO on-chain commitment,
 * which returns before any wallet client is built — proving the honest early-outs and
 * that no `ChainTransaction` receipt is written without a real broadcast (rule 1).
 */

const VAULT = "0x1111111111111111111111111111111111111111";
// Well-known anvil test account #0 — a PUBLIC throwaway key, never a real secret.
const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const WALLET = "0x4e40d00100000000000000000000000000000000";

describe("requestCompletion tool — schema & advertised parameters", () => {
  it("takes goalId (required) and an optional verificationHash, and never moves funds", () => {
    expect(requestCompletionTool.name).toBe("requestCompletion");
    const params = requestCompletionTool.parameters as { required: string[] };
    expect(params.required).toEqual(["goalId"]);
    expect(requestCompletionTool.description.toLowerCase()).toContain("moves no funds");
  });
});

// Always-on: no attestor configured → honest not-configured, no DB, no broadcast (rule 1).
describe("requestCompletion tool — unconfigured (always-on, no DB)", () => {
  const savedVault = process.env["COMMITMENT_VAULT_ADDRESS"];
  const savedKey = process.env["ATTESTOR_PRIVATE_KEY"];
  beforeAll(() => {
    delete process.env["COMMITMENT_VAULT_ADDRESS"];
    delete process.env["ATTESTOR_PRIVATE_KEY"];
  });
  afterAll(() => {
    if (savedVault === undefined) delete process.env["COMMITMENT_VAULT_ADDRESS"];
    else process.env["COMMITMENT_VAULT_ADDRESS"] = savedVault;
    if (savedKey === undefined) delete process.env["ATTESTOR_PRIVATE_KEY"];
    else process.env["ATTESTOR_PRIVATE_KEY"] = savedKey;
  });

  it("returns configured:false and does not broadcast", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const result = await requestCompletionTool.handler(
      requestCompletionTool.input.parse({ goalId: "no-such-goal" }),
      ctx,
    );
    expect(result.configured).toBe(false);
    expect(result.broadcast).toBe(false);
    expect(result.txHash).toBeNull();
    expect(result.reason).toMatch(/attestor not configured/i);
  });
});

const dbReady = await probeDatabaseReady();
if (!dbReady) {
  console.info(
    "[requestCompletion.tool] handler test SKIPPED — no migrated Postgres reachable at DATABASE_URL.",
  );
}

describe.skipIf(!dbReady)("requestCompletion tool — handler (integration, no broadcast)", () => {
  const savedVault = process.env["COMMITMENT_VAULT_ADDRESS"];
  const savedKey = process.env["ATTESTOR_PRIVATE_KEY"];
  beforeAll(async () => {
    // Fully "attestor configured" — yet the no-commitment path must still refuse to
    // broadcast. (The key is the PUBLIC anvil key; it is restored after this block.)
    process.env["COMMITMENT_VAULT_ADDRESS"] = VAULT;
    process.env["ATTESTOR_PRIVATE_KEY"] = ANVIL_KEY;
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await ensureWallet(WALLET);
  });
  afterAll(async () => {
    if (savedVault === undefined) delete process.env["COMMITMENT_VAULT_ADDRESS"];
    else process.env["COMMITMENT_VAULT_ADDRESS"] = savedVault;
    if (savedKey === undefined) delete process.env["ATTESTOR_PRIVATE_KEY"];
    else process.env["ATTESTOR_PRIVATE_KEY"] = savedKey;
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await prisma.$disconnect();
  });

  it("refuses to broadcast (and records no tx) when there is no on-chain commitment", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const goal = await createGoal(WALLET, {
      title: "No commitment to complete",
      summary: "There is nothing on-chain to request completion for.",
      mode: "SELF_COMMITMENT",
      category: "GENERIC",
      checkInFrequency: "Weekly",
    });

    const result = await requestCompletionTool.handler(
      requestCompletionTool.input.parse({ goalId: goal.id }),
      ctx,
    );

    expect(result.configured).toBe(true);
    expect(result.broadcast).toBe(false);
    expect(result.txHash).toBeNull();
    expect(result.reason).toMatch(/no on-chain commitment/i);

    // No broadcast means no receipt row — a ChainTransaction exists only after a real
    // broadcast returns a hash (rule 1).
    const txs = await listChainTxs(WALLET);
    expect(txs).toEqual([]);
  });
});
