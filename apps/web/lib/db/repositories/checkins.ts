import type { CheckIn } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../client";
import { WalletScopeError } from "../errors";
import { createCheckInInput, evmAddressSchema, type CreateCheckInInput } from "../schemas";

/**
 * Wallet-scoped check-in access.
 *
 * A check-in is a progress note against a goal. Writing one first verifies the
 * target goal (and optional milestone) belongs to the calling wallet; a
 * cross-wallet attempt throws `WalletScopeError` (→ HTTP 403 at the API layer)
 * rather than silently creating an orphan row. `message` is untrusted user text
 * (CLAUDE.md rule 5): it is length-bounded here and stored as data, never
 * interpreted.
 */
export async function createCheckIn(
  walletAddress: string,
  input: CreateCheckInInput,
): Promise<CheckIn> {
  const addr = evmAddressSchema.parse(walletAddress);
  const parsed = createCheckInInput.parse(input);

  const goal = await prisma.goal.findFirst({
    where: { id: parsed.goalId, walletAddress: addr },
    select: { id: true },
  });
  if (!goal) {
    throw new WalletScopeError("cannot check in on a goal that is not yours");
  }

  // A milestone, if referenced, must belong to that same goal.
  if (parsed.milestoneId) {
    const milestone = await prisma.milestone.findFirst({
      where: { id: parsed.milestoneId, goalId: parsed.goalId },
      select: { id: true },
    });
    if (!milestone) {
      throw new WalletScopeError("milestone does not belong to that goal");
    }
  }

  const data: Prisma.CheckInUncheckedCreateInput = {
    goalId: parsed.goalId,
    walletAddress: addr,
    milestoneId: parsed.milestoneId ?? null,
    message: parsed.message,
  };

  return prisma.checkIn.create({ data });
}

/** Check-ins for a goal this wallet owns, newest first (empty if not owned). */
export async function listCheckIns(walletAddress: string, goalId: string): Promise<CheckIn[]> {
  const addr = evmAddressSchema.parse(walletAddress);
  return prisma.checkIn.findMany({
    where: { goalId, walletAddress: addr },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Every check-in this wallet has logged, across all its goals, newest first
 * (empty if none). Wallet-scoped like the rest — a caller only ever sees its own
 * check-ins. Used to derive the accountability profile's check-in streak (§10).
 */
export async function listWalletCheckIns(walletAddress: string): Promise<CheckIn[]> {
  const addr = evmAddressSchema.parse(walletAddress);
  return prisma.checkIn.findMany({
    where: { walletAddress: addr },
    orderBy: { createdAt: "desc" },
  });
}
