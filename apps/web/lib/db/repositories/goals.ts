import type { CheckInFrequency, Goal, GoalStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../client";
import {
  createGoalInput,
  evmAddressSchema,
  progressSchema,
  type CreateGoalInput,
} from "../schemas";
import { indexByKey } from "./grouping";

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
 * Goals for a SET of ids this wallet owns, indexed by id — ONE query, not one per
 * id (build-prompt §16 / item 6 N+1 fix). Lets the commitment / reward list loaders
 * resolve every goal title in a single round-trip instead of a `getGoal` per row.
 * Wallet-scoped; an empty id list short-circuits with no query; an id this wallet
 * does not own is absent from the map.
 */
export async function getGoalsForIds(
  walletAddress: string,
  goalIds: readonly string[],
): Promise<Map<string, Goal>> {
  const addr = evmAddressSchema.parse(walletAddress);
  if (goalIds.length === 0) return new Map();
  const rows = await prisma.goal.findMany({
    where: { id: { in: [...goalIds] }, walletAddress: addr },
  });
  return indexByKey(rows, (g) => g.id);
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

/**
 * Back-fill the on-chain `goalId` the vault emitted (`GoalRegistered`) onto this
 * wallet's goal, after the depositor's own wallet broadcast `registerGoal` and the
 * receipt was indexed (build-prompt §14.8 back-fill seam; LIMITATIONS §17). This is
 * what lets `prepareCreateCommitment` stop returning `{prepared:false}` for a
 * freshly-registered goal.
 *
 * First-writer-wins and idempotent: the `onchainGoalId: null` guard means a re-record
 * or a replayed event never clobbers an id already set (the on-chain id is write-once
 * per goal), and — since `walletAddress` stays in the filter — a cross-wallet call
 * touches zero rows. Returns rows changed (1 on the first back-fill; 0 if already set /
 * not owned / not found).
 */
export async function setOnchainGoalId(
  walletAddress: string,
  goalId: string,
  onchainGoalId: bigint,
): Promise<number> {
  const addr = evmAddressSchema.parse(walletAddress);
  if (onchainGoalId < 0n) {
    throw new Error("onchainGoalId must be a non-negative uint256");
  }
  const result = await prisma.goal.updateMany({
    where: { id: goalId, walletAddress: addr, onchainGoalId: null },
    data: { onchainGoalId },
  });
  return result.count;
}

/**
 * Find this wallet's goal by the on-chain `goalId` the vault assigned, or null. The
 * inverse of `setOnchainGoalId`, and the link the chain-sync reconciler needs
 * (LIMITATIONS.md item 12): a replayed `GoalRegistered` / `MilestoneRegistered` log
 * carries only the on-chain id, so this is how a past event is attached to the right
 * DB row. Wallet-scoped, so a replayed event can never attach to a stranger's goal;
 * null when the id has not been back-filled onto any of this wallet's goals yet, which
 * the caller must report honestly rather than guessing at a row.
 */
export async function getGoalByOnchainId(
  walletAddress: string,
  onchainGoalId: bigint,
): Promise<Goal | null> {
  const addr = evmAddressSchema.parse(walletAddress);
  if (onchainGoalId < 0n) return null;
  return prisma.goal.findFirst({ where: { walletAddress: addr, onchainGoalId } });
}

/**
 * Set the next check-in time (and optionally the structured cadence) on a goal
 * this wallet owns. `updateMany` keeps the wallet in the filter so a cross-wallet
 * call touches zero rows. Returns rows changed (0 if not owned / not found).
 */
export async function scheduleCheckIn(
  walletAddress: string,
  goalId: string,
  nextCheckIn: Date,
  cadence?: CheckInFrequency,
): Promise<number> {
  const addr = evmAddressSchema.parse(walletAddress);
  const data: Prisma.GoalUpdateManyMutationInput = { nextCheckIn };
  // Conditional assignment (not `?? undefined`) keeps this clean under
  // exactOptionalPropertyTypes — we never write an explicit undefined.
  if (cadence !== undefined) {
    data.checkInCadence = cadence;
  }
  const result = await prisma.goal.updateMany({
    where: { id: goalId, walletAddress: addr },
    data,
  });
  return result.count;
}

/**
 * Persist the §5 goal-shaping slots (current state / desired state / success
 * metric) the AI pinned down. Only the fields provided are written. Wallet-scoped
 * `updateMany`; returns rows changed (0 if not owned / not found).
 */
export async function updateGoalShaping(
  walletAddress: string,
  goalId: string,
  shaping: { currentState?: string; desiredState?: string; successMetric?: string },
): Promise<number> {
  const addr = evmAddressSchema.parse(walletAddress);
  const data: Prisma.GoalUpdateManyMutationInput = {};
  if (shaping.currentState !== undefined) data.currentState = shaping.currentState;
  if (shaping.desiredState !== undefined) data.desiredState = shaping.desiredState;
  if (shaping.successMetric !== undefined) data.successMetric = shaping.successMetric;
  const result = await prisma.goal.updateMany({
    where: { id: goalId, walletAddress: addr },
    data,
  });
  return result.count;
}
