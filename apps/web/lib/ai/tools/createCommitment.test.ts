import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { CommitmentStatus } from "@prisma/client";
import { createGoal, ensureWallet, getCommitmentByGoal, prisma } from "@/lib/db";
import { probeDatabaseReady } from "@/lib/db/probe";
import { commitmentVaultAbi } from "@/lib/chain";
import { createCommitmentTool } from "./createCommitment";
import type { ToolContext } from "./types";

/**
 * `createCommitment` is PREPARE-ONLY (CLAUDE.md rules 1–3): it never broadcasts and
 * never moves funds. These tests prove that — the always-on ones need no chain and no
 * DB; the DB-gated ones assert the returned calldata really encodes `createCommitment`
 * with value "0" and that only a DRAFT row (status CREATED, no on-chain anchors) is
 * written.
 */

const VAULT = "0x1111111111111111111111111111111111111111";
const WALLET = "0xc011700100000000000000000000000000000000";

describe("createCommitment tool — schema & advertised parameters", () => {
  it("is prepare-only in name and description, requiring the pre-sign terms", () => {
    expect(createCommitmentTool.name).toBe("createCommitment");
    const d = createCommitmentTool.description.toLowerCase();
    expect(d).toContain("do not send");
    expect(d).toContain("never moves funds");
    const params = createCommitmentTool.parameters as { required: string[] };
    expect(params.required).toEqual(
      expect.arrayContaining(["goalId", "principalWei", "releaseCondition", "failurePath"]),
    );
  });
});

// Always-on: with no deployed contract the tool declines honestly and writes NO draft
// (rule 1). Force the unconfigured state regardless of the ambient environment.
describe("createCommitment tool — unconfigured (always-on, no DB)", () => {
  const saved = process.env["COMMITMENT_VAULT_ADDRESS"];
  beforeAll(() => {
    delete process.env["COMMITMENT_VAULT_ADDRESS"];
  });
  afterAll(() => {
    if (saved === undefined) delete process.env["COMMITMENT_VAULT_ADDRESS"];
    else process.env["COMMITMENT_VAULT_ADDRESS"] = saved;
  });

  it("returns configured:false and prepares nothing, echoing the terms for review", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const result = await createCommitmentTool.handler(
      createCommitmentTool.input.parse({
        goalId: "no-such-goal",
        principalWei: "1000000",
        releaseCondition: "Release the stake when the goal is verified complete.",
        failurePath: "Forfeit per the terms if the goal is not met by the deadline.",
      }),
      ctx,
    );
    expect(result.configured).toBe(false);
    expect(result.prepared).toBe(false);
    expect(result.transaction).toBeNull();
    expect(result.draftCommitmentId).toBeNull();
    // The human-readable terms are still surfaced for the user to review.
    expect(result.terms?.principalWei).toBe("1000000");
  });
});

const dbReady = await probeDatabaseReady();
if (!dbReady) {
  console.info(
    "[createCommitment.tool] handler tests SKIPPED — no migrated Postgres reachable at DATABASE_URL.",
  );
}

describe.skipIf(!dbReady)("createCommitment tool — handler (integration)", () => {
  const saved = process.env["COMMITMENT_VAULT_ADDRESS"];
  beforeAll(async () => {
    // A dummy (but valid) deployed-vault address makes the chain "configured" so the
    // pure calldata encoders run; no network is touched (encoding is offline).
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

  it("prepares createCommitment calldata (value 0) once the goal is on-chain, saving a draft", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const goal = await createGoal(WALLET, {
      title: "Ship the side project",
      summary: "Ship it before the deadline.",
      mode: "SELF_COMMITMENT",
      category: "GENERIC",
      checkInFrequency: "Weekly",
    });
    // Simulate the goal already being registered on-chain (id 7).
    await prisma.goal.update({ where: { id: goal.id }, data: { onchainGoalId: 7n } });

    const result = await createCommitmentTool.handler(
      createCommitmentTool.input.parse({
        goalId: goal.id,
        principalWei: "1000000",
        rewardWei: "500",
        gracePeriodSeconds: 3600,
        confidenceThreshold: 80,
        releaseCondition: "Release the stake when the goal is verified complete.",
        failurePath: "Forfeit per the terms if the goal is not met by the deadline.",
      }),
      ctx,
    );

    expect(result.configured).toBe(true);
    expect(result.prepared).toBe(true);
    expect(result.onchainGoalId).toBe("7");
    expect(result.transaction).not.toBeNull();
    expect(result.transaction?.to).toBe(VAULT);
    // Creation attaches NO value — the principal is locked later by the user's own tx.
    expect(result.transaction?.value).toBe("0");

    // The calldata really is createCommitment(7, 1_000_000, 500, ...) — decoded from ABI.
    const decoded = decodeFunctionData({
      abi: commitmentVaultAbi,
      data: result.transaction!.data as `0x${string}`,
    });
    expect(decoded.functionName).toBe("createCommitment");
    const cargs = decoded.args as readonly [bigint, bigint, bigint, bigint, bigint, number];
    expect(cargs[0]).toBe(7n);
    expect(cargs[1]).toBe(1_000_000n);
    expect(cargs[2]).toBe(500n);

    // Only a DRAFT row was written — no on-chain anchors, no invented hash (rule 1).
    const draft = await getCommitmentByGoal(WALLET, goal.id);
    expect(draft?.id).toBe(result.draftCommitmentId);
    expect(draft?.status).toBe(CommitmentStatus.CREATED);
    expect(draft?.onchainCommitmentId).toBeNull();
    expect(draft?.txHash).toBeNull();
    expect(draft?.principalWei.toString()).toBe("1000000");
  });

  it("still saves the draft but prepares nothing when the goal is not yet on-chain", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const goal = await createGoal(WALLET, {
      title: "Learn to freedive",
      summary: "Not registered on-chain yet.",
      mode: "SELF_COMMITMENT",
      category: "GENERIC",
      checkInFrequency: "Weekly",
    });

    const result = await createCommitmentTool.handler(
      createCommitmentTool.input.parse({
        goalId: goal.id,
        principalWei: "250",
        releaseCondition: "Release when verified.",
        failurePath: "Forfeit if not met.",
      }),
      ctx,
    );

    expect(result.configured).toBe(true);
    expect(result.prepared).toBe(false);
    expect(result.transaction).toBeNull();
    expect(result.reason).toMatch(/register the goal/i);
    // The draft terms are persisted for review even though nothing is broadcastable yet.
    expect(result.draftCommitmentId).not.toBeNull();
    const draft = await getCommitmentByGoal(WALLET, goal.id);
    expect(draft?.status).toBe(CommitmentStatus.CREATED);
    expect(draft?.onchainCommitmentId).toBeNull();
  });
});
