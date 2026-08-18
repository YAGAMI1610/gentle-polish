/**
 * Prisma → UI-view serializers (build step 9, phase 2).
 *
 * Pure functions that map database rows onto the view types in
 * `lib/types/view.ts`. They translate the enum casing (Prisma UPPER_SNAKE → the
 * lowercase/hyphenated unions the UI uses), convert wei `Decimal(78,0)` amounts
 * to token numbers, and derive the few "view" shapes the schema deliberately
 * does NOT store as tables (Reward is a view over a commitment's reward leg;
 * Achievement is derived from real counts — see LIMITATIONS.md).
 *
 * Everything here is deterministic and side-effect free: no DB, no chain, no
 * clock except values passed in explicitly. The impure composition (fetching the
 * related rows a full view needs) lives in `lib/api/loaders.ts`; this module is
 * exhaustively unit-tested with in-memory rows.
 */
import { CommitmentStatus, GoalMode, GoalStatus, Prisma, VerificationStatus } from "@prisma/client";
import type {
  ChainTransaction,
  Commitment as CommitmentRow,
  DecisionLog,
  Goal as GoalRow,
  Milestone as MilestoneRow,
  VerificationRecord,
  VerificationStrategy,
} from "@prisma/client";
import { formatEther } from "viem";
import { z } from "zod";
import type {
  Achievement as AchievementView,
  ActivityEvent as ActivityEventView,
  Commitment as CommitmentView,
  Goal as GoalView,
  GoalMode as GoalModeView,
  GoalStatus as GoalStatusView,
  Milestone as MilestoneView,
  Reward as RewardView,
  Verification as VerificationView,
  VerificationStatus as VerificationStatusView,
  WalletProfile as WalletProfileView,
} from "@/lib/types/view";

// ---------------------------------------------------------------------------
// Enum translation (Prisma UPPER_SNAKE → UI union). Record over the full enum
// so a new enum member is a compile error here, not a silent passthrough.
// ---------------------------------------------------------------------------

const GOAL_MODE_VIEW: Record<GoalMode, GoalModeView> = {
  [GoalMode.ACCOUNTABILITY]: "accountability",
  [GoalMode.SELF_COMMITMENT]: "self-commitment",
};

const GOAL_STATUS_VIEW: Record<GoalStatus, GoalStatusView> = {
  [GoalStatus.ACTIVE]: "active",
  [GoalStatus.COMPLETED]: "completed",
  [GoalStatus.ABANDONED]: "abandoned",
};

/**
 * REJECTED_AS_INCONSISTENT collapses to "unverified" in the UI: the honest
 * outcome for contradictory evidence is "not verified", shown without accusation
 * (§6). PENDING is a real in-flight state, not a demo placeholder.
 */
const VERIFICATION_STATUS_VIEW: Record<VerificationStatus, VerificationStatusView> = {
  [VerificationStatus.PENDING]: "pending",
  [VerificationStatus.VERIFIED]: "verified",
  [VerificationStatus.NEEDS_MORE_EVIDENCE]: "needs-evidence",
  [VerificationStatus.UNVERIFIED]: "unverified",
  [VerificationStatus.REJECTED_AS_INCONSISTENT]: "unverified",
};

/**
 * The UI commitment card has three states; the on-chain lifecycle has seven.
 * A pre-broadcast draft (NONE/CREATED) and an in-flight commitment
 * (ACTIVE/COMPLETION_REQUESTED) are both "active" intent; APPROVED/CLOSED are
 * "completed"; CANCELLED is "cancelled".
 */
const COMMITMENT_STATUS_VIEW: Record<CommitmentStatus, CommitmentView["status"]> = {
  [CommitmentStatus.NONE]: "active",
  [CommitmentStatus.CREATED]: "active",
  [CommitmentStatus.ACTIVE]: "active",
  [CommitmentStatus.COMPLETION_REQUESTED]: "active",
  [CommitmentStatus.APPROVED]: "completed",
  [CommitmentStatus.CLOSED]: "completed",
  [CommitmentStatus.CANCELLED]: "cancelled",
};

export function goalModeToView(mode: GoalMode): GoalModeView {
  return GOAL_MODE_VIEW[mode];
}
export function goalStatusToView(status: GoalStatus): GoalStatusView {
  return GOAL_STATUS_VIEW[status];
}
export function verificationStatusToView(status: VerificationStatus): VerificationStatusView {
  return VERIFICATION_STATUS_VIEW[status];
}
export function commitmentStatusToView(status: CommitmentStatus): CommitmentView["status"] {
  return COMMITMENT_STATUS_VIEW[status];
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

/**
 * Convert a wei `Decimal(78,0)` amount to a token number for display. The UI's
 * `amountLocked`/`reward`/`amount` fields are token-denominated numbers; the DB
 * and chain hold wei. `formatEther` gives the exact decimal string; `Number`
 * narrows for display (token amounts on this testnet are small — full-precision
 * wei never leaves the string boundary in fund flows, which use the wei string
 * directly for calldata).
 */
export function weiToTokenNumber(wei: Prisma.Decimal): number {
  return Number(formatEther(BigInt(wei.toString())));
}

// ---------------------------------------------------------------------------
// Verification / Milestone / Goal
// ---------------------------------------------------------------------------

export function toVerificationView(v: VerificationRecord): VerificationView {
  return {
    id: v.id,
    submittedAt: v.submittedAt.toISOString(),
    status: verificationStatusToView(v.status),
    confidence: v.confidence,
    reasoning: v.reasoning,
    evidenceSummary: v.evidenceSummary ?? "",
    evidenceHash: v.evidenceHash ?? "",
  };
}

export function toMilestoneView(
  m: MilestoneRow,
  verification?: VerificationRecord | null,
): MilestoneView {
  return {
    id: m.id,
    title: m.title,
    dueDate: m.dueDate ? m.dueDate.toISOString() : "",
    done: m.done,
    // exactOptionalPropertyTypes: only attach the key when a record exists.
    ...(verification ? { verification: toVerificationView(verification) } : {}),
  };
}

/**
 * The UI's `verificationStrategy: string[]` is the union of the strategy's
 * methods and required-evidence items (deduped, order preserved). Null strategy
 * → empty list.
 */
export function deriveVerificationStrategy(strategy: VerificationStrategy | null): string[] {
  if (!strategy) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...strategy.methods, ...strategy.requiredEvidence]) {
    const trimmed = item.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

export function toGoalView(
  goal: GoalRow,
  milestones: MilestoneRow[],
  verificationsByMilestone: Map<string, VerificationRecord>,
  strategy: VerificationStrategy | null,
  commitment: { id: string } | null,
): GoalView {
  return {
    id: goal.id,
    title: goal.title,
    summary: goal.summary,
    mode: goalModeToView(goal.mode),
    status: goalStatusToView(goal.status),
    progress: goal.progress,
    nextCheckIn: goal.nextCheckIn ? goal.nextCheckIn.toISOString() : "",
    checkInFrequency: goal.checkInFrequency,
    deadline: goal.deadline ? goal.deadline.toISOString() : "",
    verificationStrategy: deriveVerificationStrategy(strategy),
    milestones: milestones.map((m) =>
      toMilestoneView(m, verificationsByMilestone.get(m.id) ?? null),
    ),
    ...(commitment ? { commitmentId: commitment.id } : {}),
  };
}

// ---------------------------------------------------------------------------
// Commitment / Reward
// ---------------------------------------------------------------------------

export function toCommitmentView(c: CommitmentRow, goalTitle: string): CommitmentView {
  return {
    id: c.id,
    goalId: c.goalId,
    goalTitle,
    amountLocked: weiToTokenNumber(c.principalWei),
    reward: weiToTokenNumber(c.rewardWei),
    token: c.token,
    status: commitmentStatusToView(c.status),
    releaseCondition: c.releaseCondition,
    failurePath: c.failurePath,
    // Empty until a real broadcast fills it in (rule 1 — never a placeholder hash).
    txHash: c.txHash ?? "",
    createdAt: c.createdAt.toISOString(),
  };
}

/**
 * Reward is a VIEW over a commitment's reward leg, not a stored table (schema
 * comment): APPROVED + not-withdrawn ⇒ claimable; rewardWithdrawn ⇒ claimed.
 * A commitment with no reward, or one not yet approved/withdrawn, yields no
 * reward row (returns null). `earnedAt`/`claimedAt` derive from the commitment's
 * `updatedAt` — the only real timestamp available without a dedicated column
 * (limitation noted in LIMITATIONS.md).
 */
export function toRewardView(c: CommitmentRow, goalTitle: string): RewardView | null {
  const amount = weiToTokenNumber(c.rewardWei);
  if (amount <= 0) return null;

  const claimed = c.rewardWithdrawn;
  const claimable = c.status === CommitmentStatus.APPROVED && !c.rewardWithdrawn;
  if (!claimed && !claimable) return null;

  const at = c.updatedAt.toISOString();
  return {
    id: `${c.id}-reward`,
    goalTitle,
    commitmentId: c.id,
    amount,
    token: c.token,
    state: claimed ? "claimed" : "claimable",
    earnedAt: at,
    ...(claimed ? { claimedAt: at } : {}),
  };
}

// ---------------------------------------------------------------------------
// Activity (DecisionLog "ai" + ChainTransaction "chain", newest first)
// ---------------------------------------------------------------------------

export function toActivityViews(
  decisions: DecisionLog[],
  chainTxs: ChainTransaction[],
): ActivityEventView[] {
  const ai = decisions.map<ActivityEventView>((d) => ({
    id: d.id,
    type: "ai",
    title: d.action,
    detail: d.decision,
    at: d.createdAt.toISOString(),
  }));
  const chain = chainTxs.map<ActivityEventView>((t) => ({
    id: t.id,
    type: "chain",
    title: t.title,
    detail: t.detail ?? "",
    at: t.createdAt.toISOString(),
    txHash: t.txHash,
  }));
  return [...ai, ...chain].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

// ---------------------------------------------------------------------------
// Profile / accountability score
// ---------------------------------------------------------------------------

export interface WalletProfileInput {
  address: string;
  score: number;
  /** Weighted components; `weight` is a 0–1 fraction (as computed by scores.ts). */
  breakdown: { label: string; value: number; weight: number }[];
  goalStatuses: GoalStatus[];
  currentStreak: number;
}

export function toWalletProfileView(input: WalletProfileInput): WalletProfileView {
  return {
    address: input.address,
    // This view is only ever built for the authenticated wallet.
    connected: true,
    accountabilityScore: input.score,
    scoreBreakdown: input.breakdown.map((b) => ({
      label: b.label,
      value: b.value,
      weight: `${Math.round(b.weight * 100)}% of score`,
    })),
    goalsCompleted: input.goalStatuses.filter((s) => s === GoalStatus.COMPLETED).length,
    goalsActive: input.goalStatuses.filter((s) => s === GoalStatus.ACTIVE).length,
    goalsAbandoned: input.goalStatuses.filter((s) => s === GoalStatus.ABANDONED).length,
    currentStreak: input.currentStreak,
  };
}

/**
 * Consecutive-week check-in streak, derived from real check-in timestamps.
 * Weeks are fixed 7-day windows (UTC epoch aligned) — consistent, not ISO-week
 * accurate, which is all a streak needs. The streak is the run of consecutive
 * weeks ending at the current week (or last week, a one-week grace); a stale
 * history (no check-in this week or last) yields 0 so we never overclaim.
 */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
function weekIndex(d: Date): number {
  return Math.floor(d.getTime() / WEEK_MS);
}
export function computeCheckInStreakWeeks(checkInDates: Date[], now: Date): number {
  if (checkInDates.length === 0) return 0;
  const weeks = new Set(checkInDates.map(weekIndex));
  const current = weekIndex(now);
  let cursor: number;
  if (weeks.has(current)) cursor = current;
  else if (weeks.has(current - 1)) cursor = current - 1;
  else return 0;
  let streak = 0;
  while (weeks.has(cursor)) {
    streak += 1;
    cursor -= 1;
  }
  return streak;
}

// ---------------------------------------------------------------------------
// Achievements — derived from REAL counts, never stored `earned` flags.
// ---------------------------------------------------------------------------

export interface AchievementCounts {
  checkIns: number;
  verifiedMilestones: number;
  onChainCommitments: number;
  goalsCompleted: number;
  streakWeeks: number;
}

/**
 * Derive the achievement list from real per-wallet counts. Thresholds are the
 * catalog (a dedicated catalog table is deferred — see LIMITATIONS.md). No
 * `earnedAt` is fabricated: `earned` is a live function of the counts, and the
 * optional timestamp is simply omitted (we don't persist the crossing moment).
 */
export function deriveAchievements(counts: AchievementCounts): AchievementView[] {
  return [
    {
      id: "first-check-in",
      name: "First honest check-in",
      description: "Logged your first check-in against a goal.",
      earned: counts.checkIns >= 1,
    },
    {
      id: "ten-verified-milestones",
      name: "Ten verified milestones",
      description: "Ten milestones passed verification with evidence.",
      earned: counts.verifiedMilestones >= 10,
    },
    {
      id: "skin-in-the-game",
      name: "Skin in the game",
      description: "Opened your first on-chain self-commitment.",
      earned: counts.onChainCommitments >= 1,
    },
    {
      id: "finished-what-you-started",
      name: "Finished what you started",
      description: "Completed a goal all the way to its deadline.",
      earned: counts.goalsCompleted >= 1,
    },
    {
      id: "season-of-consistency",
      name: "A season of consistency",
      description: "Twelve consecutive weeks with a check-in.",
      earned: counts.streakWeeks >= 12,
    },
  ];
}

/**
 * Defensive parse of a stored `AccountabilityScoreLog.breakdown` (Json) back into
 * the weighted-component shape. Unused by the live profile route (which recomputes
 * from `computeAccountabilityScore`), but kept for consumers that read the audit
 * log; tolerates malformed JSON by returning an empty list.
 */
const storedBreakdownSchema = z.array(
  z.object({ label: z.string(), value: z.number(), weight: z.number() }),
);
export function parseStoredBreakdown(
  breakdown: unknown,
): { label: string; value: number; weight: number }[] {
  const parsed = storedBreakdownSchema.safeParse(breakdown);
  return parsed.success ? parsed.data : [];
}
