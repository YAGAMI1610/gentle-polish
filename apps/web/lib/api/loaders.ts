/**
 * View loaders (build step 9, phase 2) — the impure composition layer.
 *
 * Each loader fetches the wallet-scoped rows a UI view needs (via the existing
 * `lib/db` repositories, which enforce ownership) and hands them to the pure
 * serializers in `lib/api/serializers.ts`. Keeping composition here means the
 * route handlers stay thin (auth + call a loader + JSON) and the serializers stay
 * unit-testable with no DB.
 *
 * Wallet scoping is inherited: every repository call takes `wallet` first and
 * returns only that wallet's rows, so a loader can never assemble a view from
 * another wallet's data. `getGoal`/`getCommitment` returning null for a
 * cross-wallet id is what lets the detail routes answer 404 (non-leak).
 *
 * List loaders are batched (build-prompt §16 / item 6): `loadGoalViews` fetches
 * every goal's milestones, verification records, strategy, and commitment with one
 * grouped query each (five queries total regardless of goal count), and the
 * commitment/reward loaders resolve all goal titles in a single `getGoalsForIds`.
 * The single-item detail loaders (`loadGoalView`, `loadCommitmentView`) keep their
 * direct per-id reads — a handful of queries for the one row a detail route needs.
 */
import { GoalStatus, VerificationStatus } from "@prisma/client";
import type {
  Commitment as CommitmentRow,
  Goal as GoalRow,
  Milestone as MilestoneRow,
  VerificationRecord,
  VerificationStrategy,
} from "@prisma/client";
import {
  computeAccountabilityScore,
  getCommitmentByGoal,
  getCommitmentsForGoals,
  getGoal,
  getGoalsForIds,
  getVerificationStrategiesForGoals,
  getVerificationStrategy,
  isCommitmentLocked,
  listChainTxs,
  listCommitments,
  listDecisions,
  listEarnedAchievements,
  listGoals,
  listLockedCommitmentIds,
  listMilestones,
  listMilestonesForGoals,
  listVerificationRecords,
  listVerificationRecordsForGoals,
  listWalletCheckIns,
  listWalletVerifications,
  recordEarnedAchievements,
} from "@/lib/db";
import {
  computeCheckInStreakWeeks,
  deriveAchievements,
  toActivityViews,
  toCommitmentView,
  toGoalView,
  toRewardView,
  toWalletProfileView,
} from "@/lib/api/serializers";
import type {
  Achievement,
  ActivityEvent,
  Commitment,
  Goal,
  Reward,
  WalletProfile,
} from "@/lib/types/view";
import { earnedAchievementIds } from "@/lib/achievements/catalog";

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

/**
 * Pure assembly of one goal's detail view from its already-fetched related rows.
 * Shared by the single-goal loader and the batched list loader so both build the
 * view identically — the only difference between them is HOW the rows are fetched
 * (per-goal reads vs one grouped query), never how they are shaped.
 *
 * Verification records arrive newest-first, so the first one seen per milestone is
 * the latest verification for that milestone.
 */
function assembleGoalView(
  goal: GoalRow,
  milestones: MilestoneRow[],
  verifications: VerificationRecord[],
  strategy: VerificationStrategy | null,
  commitment: { id: string } | null,
): Goal {
  const byMilestone = new Map<string, VerificationRecord>();
  for (const v of verifications) {
    if (v.milestoneId && !byMilestone.has(v.milestoneId)) {
      byMilestone.set(v.milestoneId, v);
    }
  }
  return toGoalView(goal, milestones, byMilestone, strategy, commitment);
}

/** Compose the full detail view for one goal this wallet owns. */
export async function loadGoalView(wallet: string, goal: GoalRow): Promise<Goal> {
  const [milestones, verifications, strategy, commitment] = await Promise.all([
    listMilestones(wallet, goal.id),
    listVerificationRecords(wallet, goal.id),
    getVerificationStrategy(wallet, goal.id),
    getCommitmentByGoal(wallet, goal.id),
  ]);
  return assembleGoalView(
    goal,
    milestones,
    verifications,
    strategy,
    commitment ? { id: commitment.id } : null,
  );
}

/**
 * All of this wallet's goals as full detail views, newest first. Batched: one
 * `listGoals` plus one grouped query each for milestones, verification records,
 * strategies, and commitments — five queries total, independent of goal count
 * (build-prompt §16 / item 6 N+1 fix), versus the old four-reads-per-goal.
 */
export async function loadGoalViews(wallet: string): Promise<Goal[]> {
  const goals = await listGoals(wallet);
  if (goals.length === 0) return [];
  const ids = goals.map((g) => g.id);

  const [milestonesByGoal, verificationsByGoal, strategyByGoal, commitmentByGoal] =
    await Promise.all([
      listMilestonesForGoals(wallet, ids),
      listVerificationRecordsForGoals(wallet, ids),
      getVerificationStrategiesForGoals(wallet, ids),
      getCommitmentsForGoals(wallet, ids),
    ]);

  return goals.map((g) => {
    const commitment = commitmentByGoal.get(g.id);
    return assembleGoalView(
      g,
      milestonesByGoal.get(g.id) ?? [],
      verificationsByGoal.get(g.id) ?? [],
      strategyByGoal.get(g.id) ?? null,
      commitment ? { id: commitment.id } : null,
    );
  });
}

// ---------------------------------------------------------------------------
// Commitments / Rewards
// ---------------------------------------------------------------------------

/**
 * Compose the view for one commitment this wallet owns (with its goal title and
 * its real on-chain locked state). `locked` may be supplied by the caller when it
 * has already batched the lookup (the list loader does this to avoid an N+1);
 * omitted, it is resolved with a single wallet-scoped query for the indexed
 * `LOCK_FUNDS` transaction.
 */
export async function loadCommitmentView(
  wallet: string,
  commitment: CommitmentRow,
  locked?: boolean,
): Promise<Commitment> {
  const [goal, isLocked] = await Promise.all([
    getGoal(wallet, commitment.goalId),
    locked === undefined ? isCommitmentLocked(wallet, commitment.id) : Promise.resolve(locked),
  ]);
  return toCommitmentView(commitment, goal?.title ?? "", isLocked);
}

/**
 * All of this wallet's commitments as views, newest first. Batched: `listCommitments`
 * plus two grouped queries — one for every commitment's locked state, one for every
 * goal title — instead of a locked-check and a `getGoal` per commitment (§16 / item 6).
 */
export async function loadCommitmentViews(wallet: string): Promise<Commitment[]> {
  const commitments = await listCommitments(wallet);
  if (commitments.length === 0) return [];
  const [lockedIds, goalsById] = await Promise.all([
    listLockedCommitmentIds(wallet),
    getGoalsForIds(
      wallet,
      commitments.map((c) => c.goalId),
    ),
  ]);
  return commitments.map((c) =>
    toCommitmentView(c, goalsById.get(c.goalId)?.title ?? "", lockedIds.has(c.id)),
  );
}

/**
 * Rewards are a view over the reward leg of this wallet's commitments (schema
 * comment — no dedicated Reward table). A commitment yields a reward row only
 * when it is claimable (APPROVED + not withdrawn) or already claimed. Batched: one
 * `getGoalsForIds` for every goal title instead of a `getGoal` per commitment.
 */
export async function loadRewardViews(wallet: string): Promise<Reward[]> {
  const commitments = await listCommitments(wallet);
  if (commitments.length === 0) return [];
  const goalsById = await getGoalsForIds(
    wallet,
    commitments.map((c) => c.goalId),
  );
  return commitments
    .map((c) => toRewardView(c, goalsById.get(c.goalId)?.title ?? ""))
    .filter((r): r is Reward => r !== null);
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

/** Merged AI-decision + on-chain-transaction feed for this wallet, newest first. */
export async function loadActivityViews(wallet: string): Promise<ActivityEvent[]> {
  const [decisions, chainTxs] = await Promise.all([listDecisions(wallet), listChainTxs(wallet)]);
  return toActivityViews(decisions, chainTxs);
}

// ---------------------------------------------------------------------------
// Profile / Achievements
// ---------------------------------------------------------------------------

/** The wallet's accountability profile — live-computed score + goal counts + streak. */
export async function loadWalletProfileView(wallet: string): Promise<WalletProfile> {
  const [{ score, breakdown }, goals, checkIns] = await Promise.all([
    computeAccountabilityScore(wallet),
    listGoals(wallet),
    listWalletCheckIns(wallet),
  ]);
  const currentStreak = computeCheckInStreakWeeks(
    checkIns.map((c) => c.createdAt),
    new Date(),
  );
  return toWalletProfileView({
    address: wallet,
    score,
    breakdown,
    goalStatuses: goals.map((g) => g.status),
    currentStreak,
  });
}

/**
 * Achievements derived from this wallet's real counts (never stored `earned`
 * flags). The `earned` state is recomputed live here; the earned-AT timestamp is
 * persisted (build item 7): the first time a wallet is observed to have crossed a
 * threshold we record that crossing (idempotent, first-writer-wins), then read the
 * stored crossings back so each earned achievement carries its genuine
 * first-observation time. A regression below the threshold hides the timestamp but
 * never erases it — re-earning shows the original crossing.
 */
export async function loadAchievementViews(wallet: string): Promise<Achievement[]> {
  const [checkIns, verifications, commitments, goals] = await Promise.all([
    listWalletCheckIns(wallet),
    listWalletVerifications(wallet),
    listCommitments(wallet),
    listGoals(wallet),
  ]);

  const verifiedMilestoneIds = new Set<string>();
  for (const v of verifications) {
    if (v.status === VerificationStatus.VERIFIED && v.milestoneId) {
      verifiedMilestoneIds.add(v.milestoneId);
    }
  }

  const streakWeeks = computeCheckInStreakWeeks(
    checkIns.map((c) => c.createdAt),
    new Date(),
  );

  const counts = {
    checkIns: checkIns.length,
    verifiedMilestones: verifiedMilestoneIds.size,
    onChainCommitments: commitments.filter((c) => c.onchainCommitmentId !== null).length,
    goalsCompleted: goals.filter((g) => g.status === GoalStatus.COMPLETED).length,
    streakWeeks,
  };

  // Persist the crossing for anything now earned, then read the stored first-seen
  // timestamps back so earned achievements report WHEN they were earned.
  await recordEarnedAchievements(wallet, earnedAchievementIds(counts));
  const earnedAt = await listEarnedAchievements(wallet);

  return deriveAchievements(counts, earnedAt);
}
