import type { Commitment } from "@prisma/client";
import { prisma } from "../client";
import { evmAddressSchema } from "../schemas";

/**
 * Wallet-scoped commitment access — READ-ONLY this pass.
 *
 * A Commitment row is an off-chain index of an on-chain commitment; the chain is
 * the source of truth for money (CLAUDE.md rule 2). Creating/funding/broadcasting
 * a commitment makes a REAL testnet transaction and belongs to build step 8 (the
 * contract client), so it is intentionally NOT implemented here — no invented tx
 * hashes (rule 1). See LIMITATIONS.md. These reads let the AI report status
 * without ever moving value.
 */

/** The commitment indexed for a goal this wallet owns, or null. */
export async function getCommitmentByGoal(
  walletAddress: string,
  goalId: string,
): Promise<Commitment | null> {
  const addr = evmAddressSchema.parse(walletAddress);
  return prisma.commitment.findFirst({ where: { goalId, walletAddress: addr } });
}

/** A commitment by id, but only if this wallet owns it (null otherwise). */
export async function getCommitment(
  walletAddress: string,
  commitmentId: string,
): Promise<Commitment | null> {
  const addr = evmAddressSchema.parse(walletAddress);
  return prisma.commitment.findFirst({ where: { id: commitmentId, walletAddress: addr } });
}

/** All commitments this wallet owns, newest first (empty if none). */
export async function listCommitments(walletAddress: string): Promise<Commitment[]> {
  const addr = evmAddressSchema.parse(walletAddress);
  return prisma.commitment.findMany({
    where: { walletAddress: addr },
    orderBy: { createdAt: "desc" },
  });
}
