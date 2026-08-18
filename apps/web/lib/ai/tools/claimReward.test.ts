import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { createDraftCommitment, createGoal, ensureWallet, prisma } from "@/lib/db";
import { probeDatabaseReady } from "@/lib/db/probe";
import { commitmentVaultAbi } from "@/lib/chain";
import { claimRewardTool } from "./claimReward";
import type { ToolContext } from "./types";

/**
 * `claimReward` is PREPARE-ONLY (CLAUDE.md rules 1–3): withdrawals are pull-based and
 * depositor-signed, so this never broadcasts and the backend holds no key that could.
 * It returns the encoded `claimReward` calldata (value "0" — a withdrawal sends nothing
 * in) for the depositor's own wallet to sign in step 9.
 */

const VAULT = "0x1111111111111111111111111111111111111111";
const WALLET = "0xc1a1d00100000000000000000000000000000000";

describe("claimReward tool — schema & advertised parameters", () => {
  it("is prepare-only in name and description, requiring only goalId", () => {
    expect(claimRewardTool.name).toBe("claimReward");
    const d = claimRewardTool.description.toLowerCase();
    expect(d).toContain("do not send");
    expect(d).toContain("never moves funds");
    const params = claimRewardTool.parameters as { required: string[] };
    expect(params.required).toEqual(["goalId"]);
  });
});

// Always-on: no deployed contract → honest not-configured, no calldata (rule 1).
describe("claimReward tool — unconfigured (always-on, no DB)", () => {
  const saved = process.env["COMMITMENT_VAULT_ADDRESS"];
  beforeAll(() => {
    delete process.env["COMMITMENT_VAULT_ADDRESS"];
  });
  afterAll(() => {
    if (saved === undefined) delete process.env["COMMITMENT_VAULT_ADDRESS"];
    else process.env["COMMITMENT_VAULT_ADDRESS"] = saved;
  });

  it("returns configured:false and prepares nothing", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const result = await claimRewardTool.handler(
      claimRewardTool.input.parse({ goalId: "no-such-goal" }),
      ctx,
    );
    expect(result.configured).toBe(false);
    expect(result.prepared).toBe(false);
    expect(result.transaction).toBeNull();
  });
});

const dbReady = await probeDatabaseReady();
if (!dbReady) {
  console.info(
    "[claimReward.tool] handler tests SKIPPED — no migrated Postgres reachable at DATABASE_URL.",
  );
}

describe.skipIf(!dbReady)("claimReward tool — handler (integration)", () => {
  const saved = process.env["COMMITMENT_VAULT_ADDRESS"];
  beforeAll(async () => {
    process.env["COMMITMENT_VAULT_ADDRESS"] = VAULT;
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await ensureWallet(WALLET);
  });
  afterAll(async () => {
    if (saved === undefined) delete process.env["COMMITMENT_VAULT_ADDRESS"];
    else process.env["COMMITMENT_VAULT_ADDRESS"] = saved;
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await prisma.$disconnect();
  });

  it("reports nothing to claim when the goal has no on-chain commitment", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const goal = await createGoal(WALLET, {
      title: "No commitment yet",
      summary: "Draftless goal.",
      mode: "SELF_COMMITMENT",
      category: "GENERIC",
      checkInFrequency: "Weekly",
    });
    const result = await claimRewardTool.handler(
      claimRewardTool.input.parse({ goalId: goal.id }),
      ctx,
    );
    expect(result.configured).toBe(true);
    expect(result.prepared).toBe(false);
    expect(result.transaction).toBeNull();
    expect(result.reason).toMatch(/nothing to claim/i);
  });

  it("prepares claimReward calldata (value 0) for an on-chain commitment", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const goal = await createGoal(WALLET, {
      title: "Finish the marathon",
      summary: "Reward waiting on approval.",
      mode: "SELF_COMMITMENT",
      category: "GENERIC",
      checkInFrequency: "Weekly",
    });
    await createDraftCommitment(WALLET, {
      goalId: goal.id,
      principalWei: "1000000",
      releaseCondition: "Release the stake when verified complete.",
      failurePath: "Forfeit per the terms if not met.",
    });
    // Simulate the commitment having been broadcast and indexed (on-chain id 3).
    await prisma.commitment.update({
      where: { goalId: goal.id },
      data: { onchainCommitmentId: 3n },
    });

    const result = await claimRewardTool.handler(
      claimRewardTool.input.parse({ goalId: goal.id }),
      ctx,
    );

    expect(result.configured).toBe(true);
    expect(result.prepared).toBe(true);
    expect(result.onchainCommitmentId).toBe("3");
    expect(result.transaction?.to).toBe(VAULT);
    expect(result.transaction?.value).toBe("0"); // a withdrawal sends no value in

    const decoded = decodeFunctionData({
      abi: commitmentVaultAbi,
      data: result.transaction!.data as `0x${string}`,
    });
    expect(decoded.functionName).toBe("claimReward");
    const cargs = decoded.args as readonly [bigint];
    expect(cargs[0]).toBe(3n);
  });
});
