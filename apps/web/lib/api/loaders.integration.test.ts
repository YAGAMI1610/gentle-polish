import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GoalMode, VerificationStatus } from "@prisma/client";
import {
  createDraftCommitment,
  createGoal,
  createMilestones,
  createVerificationRecord,
  ensureWallet,
  getCommitmentsForGoals,
  getGoalsForIds,
  getVerificationStrategiesForGoals,
  listGoals,
  listMilestonesForGoals,
  listVerificationRecordsForGoals,
  prisma,
  upsertVerificationStrategy,
} from "@/lib/db";
import { probeDatabaseReady } from "@/lib/db/probe";
import {
  loadCommitmentViews,
  loadGoalView,
  loadGoalViews,
  loadRewardViews,
} from "@/lib/api/loaders";

/**
 * Batched-loader integration tests (build-prompt §16 / item 6 — the N+1 fix).
 * Real Prisma against real Postgres, gated by `probeDatabaseReady()` like the other
 * integration suites: when no migrated database is reachable (the common case here —
 * see LIMITATIONS.md step 3) the whole suite skips with a printed reason.
 *
 * The load-bearing assertion is the EQUIVALENCE one: `loadGoalViews` (five grouped
 * queries, independent of goal count) must assemble byte-for-byte the same views as
 * calling the per-goal `loadGoalView` on each goal (the pre-batch behaviour). That is
 * what proves the N+1 rewrite changed only HOW rows are fetched, never the result.
 * The rest pins the properties that equivalence alone can't: milestone display order,
 * latest-verification-per-milestone, and — because a mis-scoped `IN (...)` query is a
 * cross-wallet leak — that every batch helper ignores a goalId this wallet doesn't own.
 */

const dbReady = await probeDatabaseReady();
if (!dbReady) {
  console.info(
    "[loaders.integration] SKIPPED — no migrated Postgres reachable at DATABASE_URL.\n" +
      "  To run these: `docker compose up -d db`, then " +
      "`pnpm --filter web exec prisma migrate deploy`, then `pnpm --filter web test`.",
  );
}

// Distinct prefix so this suite shares no wallet with the other integration files
// (they run against the same database).
const A = "0x10ade0a0000000000000000000000000000000aa";
const B = "0x10ade0b0000000000000000000000000000000bb";

/** Guarantee two verification records get strictly ordered `submittedAt` timestamps. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

const goalFor = (title: string) => ({
  title,
  summary: `${title} — loaders integration fixture`,
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

describe.skipIf(!dbReady)("batched view loaders (integration)", () => {
  // A's two goals; G1 is fully populated, G2 is bare (no strategy/commitment/records).
  let g1Id = "";
  let g2Id = "";
  let g1Title = "";
  let g1MilestoneAId = "";
  let g1CommitmentId = "";
  // B's single goal, used to prove the batch helpers are wallet-scoped.
  let gbId = "";

  beforeAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: { in: [A, B] } } });
    await ensureWallet(A);
    await ensureWallet(B);

    // --- Wallet A, goal 1: milestones + strategy + two verifications + a commitment.
    const g1 = await createGoal(A, goalFor("G1 — fully populated"));
    g1Id = g1.id;
    g1Title = g1.title;
    const milestones = await createMilestones(A, {
      goalId: g1.id,
      milestones: [
        { title: "Milestone A", orderIndex: 0 },
        { title: "Milestone B", orderIndex: 1 },
      ],
    });
    const [milestoneA] = milestones; // orderIndex 0
    g1MilestoneAId = milestoneA?.id ?? "";

    await upsertVerificationStrategy(A, {
      goalId: g1.id,
      measurement: "commits merged to main",
      methods: ["commit-log"],
      requiredEvidence: ["screenshot"],
    });

    // Two verifications on Milestone A; the LATER one (confidence 90) must win.
    await createVerificationRecord(A, {
      goalId: g1.id,
      milestoneId: g1MilestoneAId,
      status: VerificationStatus.NEEDS_MORE_EVIDENCE,
      confidence: 40,
      reasoning: "older verification — should be superseded",
      verificationHash: "vhash-old",
    });
    await tick();
    await createVerificationRecord(A, {
      goalId: g1.id,
      milestoneId: g1MilestoneAId,
      status: VerificationStatus.VERIFIED,
      confidence: 90,
      reasoning: "latest verification — should be the one shown",
      verificationHash: "vhash-new",
    });

    const commitment = await createDraftCommitment(A, draftFor(g1.id));
    g1CommitmentId = commitment.id;

    // --- Wallet A, goal 2: bare (proves the "absent → default" branches).
    const g2 = await createGoal(A, goalFor("G2 — bare"));
    g2Id = g2.id;
    await createMilestones(A, { goalId: g2.id, milestones: [{ title: "Solo milestone" }] });

    // --- Wallet B: a fully-populated goal that must never bleed into A's views.
    const gb = await createGoal(B, goalFor("GB — other wallet"));
    gbId = gb.id;
    await createMilestones(B, { goalId: gb.id, milestones: [{ title: "B milestone" }] });
    await upsertVerificationStrategy(B, {
      goalId: gb.id,
      measurement: "B measurement",
      methods: ["b-method"],
      requiredEvidence: ["b-evidence"],
    });
    await createDraftCommitment(B, draftFor(gb.id));
  });

  afterAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: { in: [A, B] } } });
    await prisma.$disconnect();
  });

  it("loadGoalViews assembles identically to per-goal loadGoalView (the N+1-rewrite equivalence)", async () => {
    // Same goal source and order both ways (`listGoals`, newest first).
    const goals = await listGoals(A);
    const perGoal = await Promise.all(goals.map((g) => loadGoalView(A, g)));
    const batched = await loadGoalViews(A);

    // Byte-for-byte identical: batching changed only the number of queries.
    expect(batched).toEqual(perGoal);
    expect(batched.map((v) => v.id)).toEqual(goals.map((g) => g.id));
  });

  it("assembles the populated goal's related rows correctly (order, latest verification, strategy, commitment)", async () => {
    const views = await loadGoalViews(A);
    const g1 = views.find((v) => v.id === g1Id);
    expect(g1).toBeDefined();

    // Milestones keep SQL display order (orderIndex asc).
    expect(g1?.milestones.map((m) => m.title)).toEqual(["Milestone A", "Milestone B"]);

    // Latest-verification-per-milestone: the confidence-90 record wins over the 40 one.
    const mA = g1?.milestones[0];
    expect(mA?.verification?.confidence).toBe(90);
    expect(mA?.verification?.status).toBe("verified");
    // The second milestone has no verification.
    expect(g1?.milestones[1]?.verification).toBeUndefined();

    // Strategy is the union of methods + required evidence; commitment id is attached.
    expect(g1?.verificationStrategy).toEqual(expect.arrayContaining(["commit-log", "screenshot"]));
    expect(g1?.commitmentId).toBe(g1CommitmentId);
  });

  it("assembles the bare goal with the correct empty defaults", async () => {
    const views = await loadGoalViews(A);
    const g2 = views.find((v) => v.id === g2Id);
    expect(g2).toBeDefined();
    expect(g2?.milestones).toHaveLength(1);
    expect(g2?.milestones[0]?.verification).toBeUndefined();
    expect(g2?.verificationStrategy).toEqual([]);
    expect(g2?.commitmentId).toBeUndefined();
  });

  it("commitment/reward loaders resolve goal titles through the batched getGoalsForIds", async () => {
    const commitments = await loadCommitmentViews(A);
    const c1 = commitments.find((c) => c.goalId === g1Id);
    expect(c1?.goalTitle).toBe(g1Title);
    // No LOCK_FUNDS receipt was indexed, so the composed locked flag stays honest.
    expect(c1?.locked).toBe(false);

    // rewardWei is 0 and the commitment is not APPROVED, so no reward row surfaces —
    // the loader must still run without throwing (title batch path exercised).
    await expect(loadRewardViews(A)).resolves.toEqual([]);
  });

  it("batch helpers ignore a goalId this wallet does not own (no cross-wallet leak)", async () => {
    const foreign = [gbId];
    expect((await listMilestonesForGoals(A, foreign)).size).toBe(0);
    expect((await listVerificationRecordsForGoals(A, foreign)).size).toBe(0);
    expect((await getVerificationStrategiesForGoals(A, foreign)).size).toBe(0);
    expect((await getCommitmentsForGoals(A, foreign)).size).toBe(0);
    expect((await getGoalsForIds(A, foreign)).size).toBe(0);

    // Mixed set: only the owned id comes back.
    const mixed = await getGoalsForIds(A, [g1Id, gbId]);
    expect([...mixed.keys()]).toEqual([g1Id]);

    // And the whole view for B contains only B's goal, never any of A's.
    const bViews = await loadGoalViews(B);
    expect(bViews.map((v) => v.id)).toEqual([gbId]);
  });

  it("batch helpers short-circuit an empty id list to an empty map (no query)", async () => {
    expect((await listMilestonesForGoals(A, [])).size).toBe(0);
    expect((await listVerificationRecordsForGoals(A, [])).size).toBe(0);
    expect((await getVerificationStrategiesForGoals(A, [])).size).toBe(0);
    expect((await getCommitmentsForGoals(A, [])).size).toBe(0);
    expect((await getGoalsForIds(A, [])).size).toBe(0);
  });
});
