import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CommitmentStatus, GoalMode } from "@prisma/client";
import { prisma } from "../client";
import { probeDatabaseReady } from "../probe";
import {
  createDraftCommitment,
  createGoal,
  ensureWallet,
  getCommitment,
  getGoal,
  setOnchainCommitmentId,
  setOnchainGoalId,
} from "./index";

/**
 * DB-gated integration tests for the on-chain-id back-fill setters (build-prompt §14.8;
 * LIMITATIONS §17). Real Prisma against real Postgres — no mocks. Gated by
 * `probeDatabaseReady()`: when no migrated database is reachable (the common case here —
 * see LIMITATIONS.md step 3) the suite skips with a printed reason rather than failing.
 *
 * These prove the three properties the back-fill relies on: first-writer-wins (the id is
 * write-once, so a replayed/re-recorded event never clobbers it), wallet-scoping (a
 * cross-wallet call touches zero rows), and — for commitments — that only the id is
 * written while `status` stays CREATED, which is exactly what the Lock button (item 5)
 * keys off.
 */

const dbReady = await probeDatabaseReady();
if (!dbReady) {
  console.info(
    "[onchainId.integration] SKIPPED — no migrated Postgres reachable at DATABASE_URL.\n" +
      "  To run these: `docker compose up -d db`, then " +
      "`pnpm --filter web exec prisma migrate deploy`, then `pnpm --filter web test`.",
  );
}

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";

const goalFor = (title: string) => ({
  title,
  summary: `${title} — onchain-id back-fill fixture`,
  mode: GoalMode.SELF_COMMITMENT,
  checkInFrequency: "Every week",
});

const draftFor = (goalId: string) => ({
  goalId,
  principalWei: "1000000000000000",
  rewardWei: "0",
  gracePeriodSeconds: 0,
  confidenceThreshold: 70,
  releaseCondition: "Ship the feature",
  failurePath: "Principal returns to the depositor",
});

describe.skipIf(!dbReady)("on-chain-id back-fill setters (integration)", () => {
  beforeAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: { in: [A, B] } } });
    await ensureWallet(A);
    await ensureWallet(B);
  });

  afterAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: { in: [A, B] } } });
    await prisma.$disconnect();
  });

  it("setOnchainGoalId is first-writer-wins and idempotent, scoped to the owner", async () => {
    const g = await createGoal(A, goalFor("A-goal-backfill"));
    expect((await getGoal(A, g.id))?.onchainGoalId).toBeNull();

    // First back-fill writes the id.
    expect(await setOnchainGoalId(A, g.id, 7n)).toBe(1);
    expect((await getGoal(A, g.id))?.onchainGoalId).toBe(7n);

    // Idempotent: a replayed / re-recorded event never clobbers a set id.
    expect(await setOnchainGoalId(A, g.id, 999n)).toBe(0);
    expect((await getGoal(A, g.id))?.onchainGoalId).toBe(7n);

    // Cross-wallet: B cannot back-fill A's goal (zero rows, value untouched).
    const g2 = await createGoal(A, goalFor("A-goal-crosswallet"));
    expect(await setOnchainGoalId(B, g2.id, 5n)).toBe(0);
    expect((await getGoal(A, g2.id))?.onchainGoalId).toBeNull();
  });

  it("setOnchainGoalId rejects a negative id", async () => {
    const g = await createGoal(A, goalFor("A-goal-negative"));
    await expect(setOnchainGoalId(A, g.id, -1n)).rejects.toThrow();
  });

  it("setOnchainCommitmentId writes the id but LEAVES status CREATED (item 5 gating)", async () => {
    const g = await createGoal(A, goalFor("A-commit-backfill"));
    const c = await createDraftCommitment(A, draftFor(g.id));
    expect(c.onchainCommitmentId).toBeNull();
    expect(c.status).toBe(CommitmentStatus.CREATED);

    expect(await setOnchainCommitmentId(A, c.id, 3n)).toBe(1);
    const after = await getCommitment(A, c.id);
    expect(after?.onchainCommitmentId).toBe(3n);
    // The status MUST stay CREATED — funds lock only in a later `lockFunds`, and the
    // Lock button (§17 / item 5) gates on exactly this, not on "has an on-chain id".
    expect(after?.status).toBe(CommitmentStatus.CREATED);

    // Idempotent + cross-wallet.
    expect(await setOnchainCommitmentId(A, c.id, 42n)).toBe(0);
    expect((await getCommitment(A, c.id))?.onchainCommitmentId).toBe(3n);
    expect(await setOnchainCommitmentId(B, c.id, 8n)).toBe(0);
    expect((await getCommitment(A, c.id))?.onchainCommitmentId).toBe(3n);
  });

  it("setOnchainCommitmentId rejects a negative id", async () => {
    const g = await createGoal(A, goalFor("A-commit-negative"));
    const c = await createDraftCommitment(A, draftFor(g.id));
    await expect(setOnchainCommitmentId(A, c.id, -1n)).rejects.toThrow();
  });
});
