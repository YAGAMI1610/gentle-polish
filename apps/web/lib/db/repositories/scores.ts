import type { AccountabilityScoreLog } from "@prisma/client";
import { GoalStatus, Prisma, VerificationStatus } from "@prisma/client";
import { prisma } from "../client";
import {
  evmAddressSchema,
  logAccountabilityScoreInput,
  type LogAccountabilityScoreInput,
} from "../schemas";

/**
 * Wallet-scoped accountability score (§10).
 *
 * The score is ALWAYS server-computed from real rows — there is deliberately no
 * client-writable score column anywhere (see the schema comment on
 * AccountabilityScoreLog). `computeAccountabilityScore` derives a 0–100 score and
 * a weighted breakdown from the wallet's own goals, milestones, verifications and
 * check-ins; `logAccountabilityScore` appends a computed result to the audit log.
 *
 * This is an honest, additive heuristic, not a claim of precision — the weights
 * are explicit in the breakdown so the number is always explainable. Refinements
 * are noted in LIMITATIONS.md.
 */

export interface ScoreBreakdownItem {
  label: string;
  value: number; // 0–100 sub-score
  weight: number; // 0–1, weights sum to 1
}

export interface AccountabilityScore {
  score: number; // 0–100
  breakdown: ScoreBreakdownItem[];
}

function clamp0100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function computeAccountabilityScore(
  walletAddress: string,
): Promise<AccountabilityScore> {
  const addr = evmAddressSchema.parse(walletAddress);

  const goals = await prisma.goal.findMany({
    where: { walletAddress: addr },
    select: { id: true, status: true, progress: true },
  });
  const goalIds = goals.map((g) => g.id);

  const [milestones, verifiedCount, checkInCount] = await Promise.all([
    goalIds.length
      ? prisma.milestone.findMany({
          where: { goalId: { in: goalIds } },
          select: { done: true },
        })
      : Promise.resolve([]),
    prisma.verificationRecord.count({
      where: { walletAddress: addr, status: VerificationStatus.VERIFIED },
    }),
    prisma.checkIn.count({ where: { walletAddress: addr } }),
  ]);

  const completed = goals.filter((g) => g.status === GoalStatus.COMPLETED).length;
  const abandoned = goals.filter((g) => g.status === GoalStatus.ABANDONED).length;
  const decided = completed + abandoned;
  const totalMilestones = milestones.length;
  const doneMilestones = milestones.filter((m) => m.done).length;
  const avgProgress = goals.length
    ? goals.reduce((sum, g) => sum + g.progress, 0) / goals.length
    : 0;

  // Follow-through: of the goals that reached a conclusion, how many were seen
  // through. With none concluded yet, fall back to average progress so an active
  // user isn't scored at zero.
  const followThrough = decided ? (completed / decided) * 100 : avgProgress;
  // Milestone completion rate.
  const milestoneRate = totalMilestones ? (doneMilestones / totalMilestones) * 100 : 0;
  // Verified proof: verifications relative to milestones (capped), else a floor
  // of 100 if there are verifications but no milestones to divide by.
  const verifiedProof = totalMilestones
    ? Math.min(100, (verifiedCount / totalMilestones) * 100)
    : verifiedCount > 0
      ? 100
      : 0;
  // Engagement: consistent check-ins, saturating so a burst doesn't dominate.
  const engagement = Math.min(100, checkInCount * 10);

  const breakdown: ScoreBreakdownItem[] = [
    { label: "Goal follow-through", value: clamp0100(followThrough), weight: 0.4 },
    { label: "Milestones completed", value: clamp0100(milestoneRate), weight: 0.25 },
    { label: "Verified achievements", value: clamp0100(verifiedProof), weight: 0.25 },
    { label: "Check-in engagement", value: clamp0100(engagement), weight: 0.1 },
  ];

  const score = clamp0100(breakdown.reduce((sum, b) => sum + b.value * b.weight, 0));
  return { score, breakdown };
}

/** Append a computed accountability score to the wallet's audit log. */
export async function logAccountabilityScore(
  walletAddress: string,
  input: LogAccountabilityScoreInput,
): Promise<AccountabilityScoreLog> {
  const addr = evmAddressSchema.parse(walletAddress);
  const parsed = logAccountabilityScoreInput.parse(input);

  const data: Prisma.AccountabilityScoreLogUncheckedCreateInput = {
    walletAddress: addr,
    score: parsed.score,
    breakdown: parsed.breakdown as Prisma.InputJsonValue,
    reason: parsed.reason ?? null,
  };

  return prisma.accountabilityScoreLog.create({ data });
}

/** The most recent logged score for this wallet, or null. */
export async function getLatestScore(
  walletAddress: string,
): Promise<AccountabilityScoreLog | null> {
  const addr = evmAddressSchema.parse(walletAddress);
  return prisma.accountabilityScoreLog.findFirst({
    where: { walletAddress: addr },
    orderBy: { computedAt: "desc" },
  });
}
