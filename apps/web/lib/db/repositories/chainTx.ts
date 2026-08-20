import { ChainTxKind, type ChainTransaction } from "@prisma/client";
import { prisma } from "../client";
import { WalletScopeError } from "../errors";
import {
  evmAddressSchema,
  recordChainTxInput,
  txHashSchema,
  type RecordChainTxInput,
} from "../schemas";

/**
 * Index of REAL broadcast transactions (build-prompt §14.8, schema `ChainTransaction`).
 *
 * A row here is a receipt, not a promise: per CLAUDE.md rule 1 it is written ONLY
 * after a real broadcast has returned a tx hash — the backend never invents one, and
 * a merely *prepared* (unsigned) action never lands here. `txHash` is globally unique,
 * so `recordChainTx` is idempotent: re-recording the same hash (e.g. to add a block
 * number once the tx is mined) updates the existing row instead of duplicating it.
 *
 * Everything is wallet-scoped. A referenced commitment or goal must belong to the same
 * wallet (they are real FKs, so the row must also exist) or the call throws
 * `WalletScopeError`; and a hash already recorded under another wallet can never be
 * rebound. Reads are scoped by wallet and return null / an empty list otherwise.
 */
export async function recordChainTx(
  walletAddress: string,
  input: RecordChainTxInput,
): Promise<ChainTransaction> {
  const addr = evmAddressSchema.parse(walletAddress);
  const parsed = recordChainTxInput.parse(input);

  // A referenced commitment/goal must be this wallet's own (real FKs → must exist).
  if (parsed.commitmentId) {
    const commitment = await prisma.commitment.findFirst({
      where: { id: parsed.commitmentId, walletAddress: addr },
      select: { id: true },
    });
    if (!commitment) {
      throw new WalletScopeError(
        "cannot record a transaction against a commitment that is not yours",
      );
    }
  }
  if (parsed.goalId) {
    const goal = await prisma.goal.findFirst({
      where: { id: parsed.goalId, walletAddress: addr },
      select: { id: true },
    });
    if (!goal) {
      throw new WalletScopeError("cannot record a transaction against a goal that is not yours");
    }
  }

  // A tx hash is globally unique; never let one wallet's hash be rebound to another.
  const existing = await prisma.chainTransaction.findUnique({
    where: { txHash: parsed.txHash },
    select: { walletAddress: true },
  });
  if (existing && existing.walletAddress !== addr) {
    throw new WalletScopeError("this transaction is already recorded under a different wallet");
  }

  const fields = {
    kind: parsed.kind,
    title: parsed.title,
    commitmentId: parsed.commitmentId ?? null,
    goalId: parsed.goalId ?? null,
    detail: parsed.detail ?? null,
    blockNumber: parsed.blockNumber ?? null,
  };

  // Idempotent on the unique txHash: first broadcast inserts; a later re-record
  // (e.g. once mined, to fill in the block number) updates the same row.
  return prisma.chainTransaction.upsert({
    where: { txHash: parsed.txHash },
    create: { walletAddress: addr, txHash: parsed.txHash, ...fields },
    update: fields,
  });
}

/** This wallet's recorded transactions, newest first (empty if none). */
export async function listChainTxs(walletAddress: string): Promise<ChainTransaction[]> {
  const addr = evmAddressSchema.parse(walletAddress);
  return prisma.chainTransaction.findMany({
    where: { walletAddress: addr },
    orderBy: { createdAt: "desc" },
  });
}

/** A recorded transaction by id, but only if this wallet owns it (null otherwise). */
export async function getChainTx(
  walletAddress: string,
  id: string,
): Promise<ChainTransaction | null> {
  const addr = evmAddressSchema.parse(walletAddress);
  return prisma.chainTransaction.findFirst({ where: { id, walletAddress: addr } });
}

/**
 * A recorded transaction by its (globally unique) hash, scoped to this wallet.
 * Lets a caller check "have we already indexed this broadcast?" without leaking
 * another wallet's transactions.
 */
export async function getChainTxByHash(
  walletAddress: string,
  txHash: string,
): Promise<ChainTransaction | null> {
  const addr = evmAddressSchema.parse(walletAddress);
  const hash = txHashSchema.parse(txHash);
  return prisma.chainTransaction.findFirst({ where: { txHash: hash, walletAddress: addr } });
}

/**
 * Whether this wallet has really locked the principal for a commitment — true iff a
 * `LOCK_FUNDS` transaction is indexed for it. This is the honest "locked" signal
 * (rule 1: it reflects a real broadcast receipt), NOT the commitment's DB status,
 * which stays `CREATED` after a lock (the on-chain id is back-filled without flipping
 * status — see `setOnchainCommitmentId`). Wallet-scoped, so it never observes another
 * wallet's locks. Used by the commitment detail view to gate the Lock button.
 */
export async function isCommitmentLocked(
  walletAddress: string,
  commitmentId: string,
): Promise<boolean> {
  const addr = evmAddressSchema.parse(walletAddress);
  const row = await prisma.chainTransaction.findFirst({
    where: { walletAddress: addr, commitmentId, kind: ChainTxKind.LOCK_FUNDS },
    select: { id: true },
  });
  return row !== null;
}

/**
 * The set of this wallet's commitment ids that have an indexed `LOCK_FUNDS`
 * transaction. One grouped query for the list view, so surfacing the locked state
 * across many commitments costs a single round-trip rather than a query per
 * commitment (no new N+1 — `distinct` collapses re-recorded hashes for the same
 * commitment). Wallet-scoped like every read here.
 */
export async function listLockedCommitmentIds(walletAddress: string): Promise<Set<string>> {
  const addr = evmAddressSchema.parse(walletAddress);
  const rows = await prisma.chainTransaction.findMany({
    where: { walletAddress: addr, kind: ChainTxKind.LOCK_FUNDS, commitmentId: { not: null } },
    select: { commitmentId: true },
    distinct: ["commitmentId"],
  });
  return new Set(rows.map((r) => r.commitmentId as string));
}
