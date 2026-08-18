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
 * These loaders use the per-goal repositories, so a list loader issues a query
 * per goal (N+1). At the testnet demo scale (a handful of goals per wallet) this
 * is fine; batching is noted as a future optimization in LIMITATIONS.md.
 */
import { GoalStatus, VerificationStatus } from "@prisma/client";
import type {
  Commitment as CommitmentRow,
  Goal as GoalRow,
  VerificationRecord,
} from "@prisma/client";
import {
  computeAccountabilityScore,
  getCommitmentByGoal,
  getGoal,
  getVerificationStrategy,
  listChainTxs,
  listCommitments,
  listDecisions,
  listGoals,
  listMilestones,
  listVerificationRecords,
  listWalletCheckIns,
  listWalletVerifications,
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

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

/** Compose the full detail view for one goal this wallet owns. */
export async function loadGoalView(wallet: string, goal: GoalRow): Promise<Goal> {
  const [milestones, verifications, strategy, commitment] = await Promise.all([
    listMilestones(wallet, goal.id),
    listVerificationRecords(wallet, goal.id),
    getVerificationStrategy(wallet, goal.id),
    getCommitmentByGoal(wallet, goal.id),
  ]);

  // Records come back newest-first, so the first one seen per milestone is the
  // latest verification for that milestone.
  const byMilestone = new Map<string, VerificationRecord>();
  for (const v of verifications) {
    if (v.milestoneId && !byMilestone.has(v.milestoneId)) {
      byMilestone.set(v.milestoneId, v);
    }
  }

  return toGoalView(
    goal,
    milestones,
    byMilestone,
    strategy,
    commitment ? { id: commitment.id } : null,
  );
}

/** All of this wallet's goals as full detail views, newest first. */
export async function loadGoalViews(wallet: string): Promise<Goal[]> {
  const goals = await listGoals(wallet);
  return Promise.all(goals.map((g) => loadGoalView(wallet, g)));
}

// ---------------------------------------------------------------------------
// Commitments / Rewards
// ---------------------------------------------------------------------------

/** Compose the view for one commitment this wallet owns (with its goal title). */
export async function loadCommitmentView(
  wallet: string,
  commitment: CommitmentRow,
): Promise<Commitment> {
  const goal = await getGoal(wallet, commitment.goalId);
  return toCommitmentView(commitment, goal?.title ?? "");
}

/** All of this wallet's commitments as views, newest first. */
export async function loadCommitmentViews(wallet: string): Promise<Commitment[]> {
  const commitments = await listCommitments(wallet);
  return Promise.all(commitments.map((c) => loadCommitmentView(wallet, c)));
}

/**
 * Rewards are a view over the reward leg of this wallet's commitments (schema
 * comment — no dedicated Reward table). A commitment yields a reward row only
 * when it is claimable (APPROVED + not withdrawn) or already claimed.
 */
export async function loadRewardViews(wallet: string): Promise<Reward[]> {
  const commitments = await listCommitments(wallet);
  const rewards = await Promise.all(
    commitments.map(async (c) => {
      const goal = await getGoal(wallet, c.goalId);
      return toRewardView(c, goal?.title ?? "");
    }),
  );
  return rewards.filter((r): r is Reward => r !== null);
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

/** Achievements derived from this wallet's real counts (never stored `earned` flags). */
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

  return deriveAchievements({
    checkIns: checkIns.length,
    verifiedMilestones: verifiedMilestoneIds.size,
    onChainCommitments: commitments.filter((c) => c.onchainCommitmentId !== null).length,
    goalsCompleted: goals.filter((g) => g.status === GoalStatus.COMPLETED).length,
    streakWeeks,
  });
}
