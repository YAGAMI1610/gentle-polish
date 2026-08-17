import type { Goal, GoalStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../client";
import {
  createGoalInput,
  evmAddressSchema,
  progressSchema,
  type CreateGoalInput,
} from "../schemas";

/**
 * Wallet-scoped goal access.
 *
 * `walletAddress` is the first argument of every function and is folded into
 * every `where` clause. Reads for a wallet that does not own a row return
 * null / an empty list; writes touch zero rows. There is no code path that
 * returns or mutates another wallet's goal — this is the query-isolation
 * guarantee from build-prompt §9, exercised by the integration tests.
 */

export async function createGoal(walletAddress: string, input: CreateGoalInput): Promise<Goal> {
  const addr = evmAddressSchema.parse(walletAddress);
  const parsed = createGoalInput.parse(input);

  const data: Prisma.GoalUncheckedCreateInput = {
    walletAddress: addr,
    title: parsed.title,
    summary: parsed.summary,
    mode: parsed.mode,
    category: parsed.category,
    status: parsed.status,
    progress: parsed.progress,
    checkInFrequency: parsed.checkInFrequency,
    checkInCadence: parsed.checkInCadence,
    currentState: parsed.currentState ?? null,
    desiredState: parsed.desiredState ?? null,
    successMetric: parsed.successMetric ?? null,
    nextCheckIn: parsed.nextCheckIn ?? null,
    deadline: parsed.deadline ?? null,
  };

  return prisma.goal.create({ data });
}

/** All goals owned by this wallet, newest first. */
export async function listGoals(walletAddress: string): Promise<Goal[]> {
  const addr = evmAddressSchema.parse(walletAddress);
  return prisma.goal.findMany({
    where: { walletAddress: addr },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * A single goal, but only if this wallet owns it. Returns null otherwise — a
 * caller can never tell "not yours" apart from "does not exist".
 */
export async function getGoal(walletAddress: string, goalId: string): Promise<Goal | null> {
  const addr = evmAddressSchema.parse(walletAddress);
  return prisma.goal.findFirst({ where: { id: goalId, walletAddress: addr } });
}

/**
 * Set progress (0–100) on a goal this wallet owns. Uses `updateMany` with the
 * wallet in the filter so a cross-wallet call updates zero rows rather than
 * silently mutating another wallet's goal. Returns the number of rows changed
 * (1 on success, 0 if not owned / not found).
 */
export async function setGoalProgress(
  walletAddress: string,
  goalId: string,
  progress: number,
): Promise<number> {
  const addr = evmAddressSchema.parse(walletAddress);
  const value = progressSchema.parse(progress);
  const result = await prisma.goal.updateMany({
    where: { id: goalId, walletAddress: addr },
    data: { progress: value },
  });
  return result.count;
}

/**
 * Move a goal to a new lifecycle status (ACTIVE / COMPLETED / ABANDONED), scoped
 * to the owning wallet. Returns rows changed (0 if not owned / not found).
 */
export async function setGoalStatus(
  walletAddress: string,
  goalId: string,
  status: GoalStatus,
): Promise<number> {
  const addr = evmAddressSchema.parse(walletAddress);
  const result = await prisma.goal.updateMany({
    where: { id: goalId, walletAddress: addr },
    data: { status },
  });
  return result.count;
}
