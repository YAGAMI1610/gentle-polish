import type { Commitment } from "@prisma/client";
import { CommitmentStatus, Prisma } from "@prisma/client";
import { prisma } from "../client";
import { WalletScopeError, CommitmentTermsLockedError } from "../errors";
import {
  createDraftCommitmentInput,
  evmAddressSchema,
  type CreateDraftCommitmentInput,
} from "../schemas";

/**
 * Wallet-scoped commitment access.
 *
 * A Commitment row is an off-chain index of an on-chain commitment; the chain is
 * the source of truth for money (CLAUDE.md rule 2). Broadcasting a commitment
 * makes a REAL testnet transaction signed by the DEPOSITOR's own wallet (step 9),
 * so nothing here broadcasts or moves value and no tx hash is ever invented
 * (rule 1). `createDraftCommitment` writes only the intended terms for pre-sign
 * review (§3); `onchainCommitmentId`/`txHash` stay null until a real broadcast is
 * indexed. The reads let the AI report status without moving value.
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

/**
 * Create (or refresh) the DRAFT commitment for a goal this wallet owns — an
 * off-chain record of the terms the user will review before signing (§3). This is
 * NOT an on-chain action: `status` is CREATED and both `onchainCommitmentId` and
 * `txHash` stay null until the depositor's own wallet broadcasts `createCommitment`
 * and that tx is indexed (rule 1 — no invented hashes; rule 2 — the chain owns money).
 *
 * A goal has at most one commitment (`goalId` is unique). Re-drafting is allowed
 * while the commitment is still off-chain; once it has an `onchainCommitmentId` the
 * terms are fixed on-chain and this refuses to overwrite them.
 */
export async function createDraftCommitment(
  walletAddress: string,
  input: CreateDraftCommitmentInput,
): Promise<Commitment> {
  const addr = evmAddressSchema.parse(walletAddress);
  const parsed = createDraftCommitmentInput.parse(input);

  const goal = await prisma.goal.findFirst({
    where: { id: parsed.goalId, walletAddress: addr },
    select: { id: true },
  });
  if (!goal) {
    throw new WalletScopeError("cannot create a commitment for a goal that is not yours");
  }

  const existing = await prisma.commitment.findUnique({
    where: { goalId: parsed.goalId },
    select: { id: true, onchainCommitmentId: true },
  });
  if (existing && existing.onchainCommitmentId !== null) {
    throw new CommitmentTermsLockedError();
  }

  // Only the off-chain terms are written; the on-chain anchors stay null (rule 1).
  const terms = {
    depositor: addr,
    principalWei: new Prisma.Decimal(parsed.principalWei),
    rewardWei: new Prisma.Decimal(parsed.rewardWei),
    deadline: parsed.deadline ?? null,
    gracePeriodSeconds: parsed.gracePeriodSeconds,
    confidenceThreshold: parsed.confidenceThreshold,
    status: CommitmentStatus.CREATED,
    releaseCondition: parsed.releaseCondition,
    failurePath: parsed.failurePath,
  };

  if (existing) {
    return prisma.commitment.update({ where: { goalId: parsed.goalId }, data: terms });
  }
  return prisma.commitment.create({
    data: { goalId: parsed.goalId, walletAddress: addr, ...terms },
  });
}
