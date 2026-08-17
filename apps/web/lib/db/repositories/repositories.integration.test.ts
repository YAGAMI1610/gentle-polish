import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EvidenceType, GoalMode, GoalStatus } from "@prisma/client";
import { prisma } from "../client";
import { WalletScopeError } from "../errors";
import { probeDatabaseReady } from "../probe";
import {
  createCheckIn,
  createEvidence,
  createGoal,
  ensureWallet,
  getGoal,
  listCheckIns,
  listEvidence,
  listGoals,
  setGoalProgress,
  setGoalStatus,
} from "./index";

/**
 * Wallet-isolation integration tests. Real Prisma against a real Postgres — no
 * mocks. They are gated by `probeDatabaseReady()`: when no migrated database is
 * reachable (the common case in this environment — see LIMITATIONS.md step 3)
 * the whole suite skips with a printed reason rather than failing.
 *
 * Every assertion turns on the boundary between two wallets: nothing owned by A
 * may be read or mutated through B, or vice versa (build-prompt §9).
 */

const dbReady = await probeDatabaseReady();

if (!dbReady) {
  console.info(
    "[repositories.integration] SKIPPED — no migrated Postgres reachable at DATABASE_URL.\n" +
      "  To run these: `docker compose up -d db`, then " +
      "`pnpm --filter web exec prisma migrate deploy`, then `pnpm --filter web test`.",
  );
}

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";

const goalFor = (title: string) => ({
  title,
  summary: `${title} — integration fixture`,
  mode: GoalMode.SELF_COMMITMENT,
  checkInFrequency: "Every week",
});

describe.skipIf(!dbReady)("wallet-scoped repositories (integration)", () => {
  beforeAll(async () => {
    // Clean slate; the wallet cascade removes goals/check-ins/evidence.
    await prisma.wallet.deleteMany({ where: { address: { in: [A, B] } } });
    await ensureWallet(A);
    await ensureWallet(B);
  });

  afterAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: { in: [A, B] } } });
    await prisma.$disconnect();
  });

  it("lists only the calling wallet's goals", async () => {
    const gA = await createGoal(A, goalFor("A-goal"));
    const gB = await createGoal(B, goalFor("B-goal"));

    const aIds = (await listGoals(A)).map((g) => g.id);
    const bIds = (await listGoals(B)).map((g) => g.id);

    expect(aIds).toContain(gA.id);
    expect(aIds).not.toContain(gB.id);
    expect(bIds).toContain(gB.id);
    expect(bIds).not.toContain(gA.id);
  });

  it("getGoal returns the goal for its owner and null cross-wallet", async () => {
    const gA = await createGoal(A, goalFor("A-visible"));

    expect(await getGoal(A, gA.id)).not.toBeNull();
    // B asking for A's goal must be indistinguishable from "does not exist".
    expect(await getGoal(B, gA.id)).toBeNull();
  });

  it("setGoalProgress / setGoalStatus mutate only for the owner", async () => {
    const gA = await createGoal(A, goalFor("A-progress"));

    expect(await setGoalProgress(A, gA.id, 42)).toBe(1);
    expect((await getGoal(A, gA.id))?.progress).toBe(42);

    // Cross-wallet writes touch zero rows and leave the value intact.
    expect(await setGoalProgress(B, gA.id, 99)).toBe(0);
    expect((await getGoal(A, gA.id))?.progress).toBe(42);

    expect(await setGoalStatus(B, gA.id, GoalStatus.COMPLETED)).toBe(0);
    expect((await getGoal(A, gA.id))?.status).toBe(GoalStatus.ACTIVE);
  });

  it("createCheckIn throws WalletScopeError on a non-owned goal", async () => {
    const gA = await createGoal(A, goalFor("A-checkins"));

    await createCheckIn(A, { goalId: gA.id, message: "did the thing" });
    await expect(createCheckIn(B, { goalId: gA.id, message: "not mine" })).rejects.toBeInstanceOf(
      WalletScopeError,
    );

    expect(await listCheckIns(A, gA.id)).toHaveLength(1);
    expect(await listCheckIns(B, gA.id)).toHaveLength(0);
  });

  it("createEvidence throws cross-wallet and stores raw content off-chain", async () => {
    const gA = await createGoal(A, goalFor("A-evidence"));
    const contentHash = "a".repeat(64);

    const ev = await createEvidence(A, {
      goalId: gA.id,
      type: EvidenceType.TEXT,
      contentText: "raw proof text — off-chain only",
      contentHash,
    });
    expect(ev.contentHash).toBe(contentHash);
    expect(ev.contentText).toBe("raw proof text — off-chain only");

    await expect(
      createEvidence(B, { goalId: gA.id, type: EvidenceType.TEXT, contentHash }),
    ).rejects.toBeInstanceOf(WalletScopeError);

    expect(await listEvidence(A, gA.id)).toHaveLength(1);
    expect(await listEvidence(B, gA.id)).toHaveLength(0);
  });

  it("deleting a wallet cascades to its goals, check-ins and evidence", async () => {
    const gA = await createGoal(A, goalFor("A-cascade"));
    await createCheckIn(A, { goalId: gA.id, message: "note" });
    await createEvidence(A, {
      goalId: gA.id,
      type: EvidenceType.TEXT,
      contentHash: "c".repeat(64),
    });

    await prisma.wallet.delete({ where: { address: A } });

    expect(await prisma.goal.count({ where: { walletAddress: A } })).toBe(0);
    expect(await prisma.checkIn.count({ where: { walletAddress: A } })).toBe(0);
    expect(await prisma.evidence.count({ where: { walletAddress: A } })).toBe(0);

    // Recreate A so afterAll cleanup stays uniform.
    await ensureWallet(A);
  });
});
