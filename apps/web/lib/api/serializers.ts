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
import {
  ACHIEVEMENT_CATALOG,
  isAchievementEarned,
  type AchievementCounts,
} from "@/lib/achievements/catalog";

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
 * narrows for DISPLAY only — fund flows use the wei string directly for calldata,
 * so this narrowing never touches a value that moves money. (Display of a very
 * large mainnet balance can lose low-order precision in the JS number, which is
 * a cosmetic rounding of the shown figure, not of any transacted amount.)
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

/**
 * `locked` is passed in by the loader from the indexed `LOCK_FUNDS` transaction
 * (see `lib/api/loaders.ts`), never inferred from `status`: the row stays at
 * `CREATED` after a lock, so status alone cannot distinguish "not yet locked"
 * from "locked". It defaults to `false` so a view built without chain context
 * (e.g. a pre-broadcast draft) is honestly "not locked".
 */
export function toCommitmentView(
  c: CommitmentRow,
  goalTitle: string,
  locked = false,
): CommitmentView {
  return {
    id: c.id,
    goalId: c.goalId,
    goalTitle,
    amountLocked: weiToTokenNumber(c.principalWei),
    token: c.token,
    status: commitmentStatusToView(c.status),
    locked,
    releaseCondition: c.releaseCondition,
    failurePath: c.failurePath,
    // Empty until a real broadcast fills it in (rule 1 — never a placeholder hash).
    txHash: c.txHash ?? "",
    createdAt: c.createdAt.toISOString(),
  };
}

/**
 * The success-payout view over a commitment (not a stored table). The reward
 * concept was removed as a product decision: completing a goal returns exactly the
 * staked PRINCIPAL — you get back what you put in, never a separate reward. So this
 * view represents the *returnable principal*, and its two flags mirror the
 * contract's `releasePrincipal` guard exactly, so the UI never offers a release the
 * chain would reject or mislabels a cancellation refund as a success payout:
 *   - claimable ⇐ APPROVED **and** principal not yet withdrawn. `releasePrincipal`
 *     reverts unless the commitment is `Approved` and pays out at most once, so an
 *     un-approved or already-released commitment shows nothing to release.
 *   - claimed ⇐ principalWithdrawn **and** not CANCELLED. `principalWithdrawn` is set
 *     true by BOTH `releasePrincipal` (success payout) and `cancelCommitment`
 *     (non-punitive refund); only the former is a success payout, so a cancelled
 *     commitment is never surfaced here.
 * A commitment that is neither claimable nor claimed yields no row (returns null).
 *
 * NOTE (LIMITATIONS item 12): the DB `status` is not yet reconciled from chain — it
 * stays `CREATED` until the approval/withdrawal reconciler lands — so like the old
 * reward surface, this lights up only once that sync exists. It is gated on the real
 * `APPROVED` status rather than faked (CLAUDE.md rule 1). `earnedAt`/`claimedAt`
 * derive from the commitment's `updatedAt`, the only real timestamp available.
 */
export function toRewardView(c: CommitmentRow, goalTitle: string): RewardView | null {
  const amount = weiToTokenNumber(c.principalWei);
  if (amount <= 0) return null;

  const claimed = c.principalWithdrawn && c.status !== CommitmentStatus.CANCELLED;
  const claimable = c.status === CommitmentStatus.APPROVED && !c.principalWithdrawn;
  if (!claimed && !claimable) return null;

  const at = c.updatedAt.toISOString();
  return {
    id: `${c.id}-payout`,
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

export type { AchievementCounts };

/**
 * Derive the achievement list from real per-wallet counts, using the shared
 * `ACHIEVEMENT_CATALOG` as the single source of truth for ids / metadata / the
 * `metric >= threshold` earn rule (build item 7 — the catalog is mirrored into the
 * `AchievementDefinition` table so code and DB can't drift).
 *
 * `earned` is a live function of the counts. `earnedAt`, when the caller supplies
 * the persisted first-observation map, is attached ONLY to already-earned entries —
 * it is a real recorded crossing timestamp, never fabricated (CLAUDE.md rule 1). A
 * caller with no persistence (or an entry with no recorded crossing yet) simply
 * omits the key.
 */
export function deriveAchievements(
  counts: AchievementCounts,
  earnedAt?: ReadonlyMap<string, Date>,
): AchievementView[] {
  return ACHIEVEMENT_CATALOG.map((def) => {
    const earned = isAchievementEarned(def, counts);
    const at = earned ? earnedAt?.get(def.id) : undefined;
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      earned,
      // exactOptionalPropertyTypes: only attach when a real crossing was recorded.
      ...(at ? { earnedAt: at.toISOString() } : {}),
    };
  });
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
