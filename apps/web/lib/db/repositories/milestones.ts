import type { Milestone } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../client";
import { WalletScopeError } from "../errors";
import { createMilestonesInput, evmAddressSchema, type CreateMilestonesInput } from "../schemas";

/**
 * Wallet-scoped milestone access.
 *
 * A Milestone carries no walletAddress of its own — it hangs off a Goal — so
 * ownership is enforced through the goal: writes verify the goal is owned (and
 * throw `WalletScopeError` otherwise), and reads/updates scope through the
 * `goal.walletAddress` relation filter so a cross-wallet call returns nothing /
 * touches zero rows. Same isolation guarantee as `goals.ts` (§9).
 */

/**
 * Create a batch of milestones on a goal this wallet owns. Verifies ownership
 * first (createMany can't carry a relation filter), then refetches the goal's
 * milestones ordered for display.
 */
export async function createMilestones(
  walletAddress: string,
  input: CreateMilestonesInput,
): Promise<Milestone[]> {
  const addr = evmAddressSchema.parse(walletAddress);
  const parsed = createMilestonesInput.parse(input);

  const goal = await prisma.goal.findFirst({
    where: { id: parsed.goalId, walletAddress: addr },
    select: { id: true },
  });
  if (!goal) {
    throw new WalletScopeError("cannot add milestones to a goal that is not yours");
  }

  const data: Prisma.MilestoneCreateManyInput[] = parsed.milestones.map((m, i) => ({
    goalId: parsed.goalId,
    title: m.title,
    dueDate: m.dueDate ?? null,
    orderIndex: m.orderIndex ?? i,
  }));

  await prisma.milestone.createMany({ data });

  return prisma.milestone.findMany({
    where: { goalId: parsed.goalId },
    orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
  });
}

/** Milestones for a goal this wallet owns, in display order (empty if not owned). */
export async function listMilestones(walletAddress: string, goalId: string): Promise<Milestone[]> {
  const addr = evmAddressSchema.parse(walletAddress);
  return prisma.milestone.findMany({
    where: { goalId, goal: { walletAddress: addr } },
    orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Mark a milestone done / not-done. Scoped through the goal relation so a
 * cross-wallet call updates zero rows. Returns rows changed (0 if not owned /
 * not found / not part of that goal).
 */
export async function setMilestoneDone(
  walletAddress: string,
  goalId: string,
  milestoneId: string,
  done: boolean,
): Promise<number> {
  const addr = evmAddressSchema.parse(walletAddress);
  const result = await prisma.milestone.updateMany({
    where: { id: milestoneId, goalId, goal: { walletAddress: addr } },
    data: { done },
  });
  return result.count;
}

/**
 * Record the on-chain anchor of a milestone after a REAL `registerMilestone`
 * broadcast (build step 8): its bytes32 `milestoneRef`, the anchored
 * `verificationHash`, and the attested `onchainConfidence`. Scoped through the
 * goal relation, so a cross-wallet call updates zero rows. Returns rows changed
 * (0 if not owned / not found). Writes no funds and no key — the values come from
 * a broadcast the attestor already made; per rule 1 this is only called with a
 * real result, never to pre-populate an anchor that hasn't happened.
 */
export async function setMilestoneAnchor(
  walletAddress: string,
  goalId: string,
  milestoneId: string,
  anchor: { milestoneRef: string; verificationHash: string; onchainConfidence: number },
): Promise<number> {
  const addr = evmAddressSchema.parse(walletAddress);
  const result = await prisma.milestone.updateMany({
    where: { id: milestoneId, goalId, goal: { walletAddress: addr } },
    data: {
      milestoneRef: anchor.milestoneRef,
      verificationHash: anchor.verificationHash,
      onchainConfidence: anchor.onchainConfidence,
    },
  });
  return result.count;
}
