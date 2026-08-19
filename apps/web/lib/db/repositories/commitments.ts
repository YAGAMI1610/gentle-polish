import type { Commitment } from "@prisma/client";
import { CommitmentStatus, Prisma } from "@prisma/client";
import { prisma } from "../client";
import { WalletScopeError, CommitmentTermsLockedError } from "../errors";
import {
  createDraftCommitmentInput,
  evmAddressSchema,
  type CreateDraftCommitmentInput,
} from "../schemas";
import { indexByKey } from "./grouping";

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

/**
 * Commitments for a SET of goals this wallet owns, indexed by goalId — ONE query,
 * not one per goal (build-prompt §16 / item 6 N+1 fix). A goal has at most one
 * commitment (unique `goalId`), so this is a plain id→commitment map. Wallet-scoped
 * by `walletAddress`; an empty id list short-circuits with no query; a goal with no
 * commitment is absent from the map (caller defaults to null).
 */
export async function getCommitmentsForGoals(
  walletAddress: string,
  goalIds: readonly string[],
): Promise<Map<string, Commitment>> {
  const addr = evmAddressSchema.parse(walletAddress);
  if (goalIds.length === 0) return new Map();
  const rows = await prisma.commitment.findMany({
    where: { goalId: { in: [...goalIds] }, walletAddress: addr },
  });
  return indexByKey(rows, (c) => c.goalId);
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

/**
 * Back-fill the on-chain `commitmentId` the vault emitted (`CommitmentCreated`) onto
 * this wallet's DRAFT commitment, after the depositor's own wallet broadcast
 * `createCommitment` and the receipt was indexed (build-prompt §14.8 back-fill seam;
 * LIMITATIONS §17). This is what lets `prepareLockFunds` / `prepareClaimReward` stop
 * returning `{prepared:false}` for a freshly-created commitment.
 *
 * Only the id is written — NOT the status. On-chain, `createCommitment` leaves the
 * commitment in `Created`; it becomes `Active` only after the depositor's separate
 * `lockFunds` (indexed as its own `LOCK_FUNDS` tx). Flipping the status here would
 * falsely imply funds are already locked, which is exactly the signal the Lock-button
 * gating (§17 / item 5) depends on. So the DRAFT's `CREATED` status is left intact.
 *
 * First-writer-wins and idempotent: the `onchainCommitmentId: null` guard means a
 * re-record or replayed event never clobbers an id already set (terms are write-once
 * on-chain), and — with `walletAddress` in the filter — a cross-wallet call touches
 * zero rows. Returns rows changed (1 on the first back-fill; 0 if already set / not
 * owned / not found).
 */
export async function setOnchainCommitmentId(
  walletAddress: string,
  commitmentId: string,
  onchainCommitmentId: bigint,
): Promise<number> {
  const addr = evmAddressSchema.parse(walletAddress);
  if (onchainCommitmentId < 0n) {
    throw new Error("onchainCommitmentId must be a non-negative uint256");
  }
  const result = await prisma.commitment.updateMany({
    where: { id: commitmentId, walletAddress: addr, onchainCommitmentId: null },
    data: { onchainCommitmentId },
  });
  return result.count;
}
