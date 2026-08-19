import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChainTxKind, GoalMode } from "@prisma/client";
import {
  createDraftCommitment,
  createGoal,
  ensureWallet,
  getChainTxByHash,
  isCommitmentLocked,
  listChainTxs,
  listLockedCommitmentIds,
  prisma,
  recordChainTx,
  WalletScopeError,
} from "@/lib/db";
import { probeDatabaseReady } from "@/lib/db/probe";

/**
 * Chain-tx indexer (build step 8). A row is a receipt for a REAL broadcast (rule 1),
 * globally unique on its hash. These DB-gated tests prove the two invariants the repo
 * promises: idempotency on the hash (re-recording to add a block number updates the
 * same row) and strict wallet scoping (one wallet can neither see nor rebind another's
 * transaction).
 */

const WALLET_A = "0xc7a7000100000000000000000000000000000000";
const WALLET_B = "0xc7a7000200000000000000000000000000000000";
const TX_HASH = `0x${"a".repeat(64)}`;

const dbReady = await probeDatabaseReady();
if (!dbReady) {
  console.info("[chainTx.repo] tests SKIPPED — no migrated Postgres reachable at DATABASE_URL.");
}

describe.skipIf(!dbReady)("recordChainTx (chain-tx indexer)", () => {
  beforeAll(async () => {
    await prisma.chainTransaction.deleteMany({ where: { txHash: TX_HASH } });
    await prisma.wallet.deleteMany({ where: { address: { in: [WALLET_A, WALLET_B] } } });
    await ensureWallet(WALLET_A);
    await ensureWallet(WALLET_B);
  });
  afterAll(async () => {
    await prisma.chainTransaction.deleteMany({ where: { txHash: TX_HASH } });
    await prisma.wallet.deleteMany({ where: { address: { in: [WALLET_A, WALLET_B] } } });
    await prisma.$disconnect();
  });

  it("is idempotent on txHash: a re-record updates the same row (e.g. to add block number)", async () => {
    const first = await recordChainTx(WALLET_A, {
      kind: ChainTxKind.REQUEST_COMPLETION,
      txHash: TX_HASH,
      title: "Completion requested",
    });
    expect(first.txHash).toBe(TX_HASH);
    expect(first.blockNumber).toBeNull();

    const second = await recordChainTx(WALLET_A, {
      kind: ChainTxKind.REQUEST_COMPLETION,
      txHash: TX_HASH,
      title: "Completion requested (mined)",
      blockNumber: 123n,
    });
    // Same row (same id), now carrying the block number.
    expect(second.id).toBe(first.id);
    expect(second.blockNumber).toBe(123n);
    expect(second.title).toBe("Completion requested (mined)");

    const mine = await listChainTxs(WALLET_A);
    expect(mine.filter((t) => t.txHash === TX_HASH)).toHaveLength(1);
  });

  it("is wallet-scoped: another wallet neither sees nor can rebind the hash", async () => {
    // B sees nothing of A's.
    expect(await listChainTxs(WALLET_B)).toEqual([]);
    expect(await getChainTxByHash(WALLET_B, TX_HASH)).toBeNull();
    // A can find its own by hash.
    expect((await getChainTxByHash(WALLET_A, TX_HASH))?.txHash).toBe(TX_HASH);

    // B cannot rebind A's globally-unique hash to itself.
    await expect(
      recordChainTx(WALLET_B, {
        kind: ChainTxKind.REQUEST_COMPLETION,
        txHash: TX_HASH,
        title: "Trying to steal the hash",
      }),
    ).rejects.toBeInstanceOf(WalletScopeError);
  });
});

/**
 * Commitment lock state (build-prompt §17 / item 5). The DB commitment status stays
 * CREATED after a lock, so "locked" is derived from an indexed LOCK_FUNDS transaction
 * instead. These prove the two repo helpers the Lock-button gate depends on:
 * `isCommitmentLocked` (detail view) and `listLockedCommitmentIds` (list view, one
 * grouped query — no N+1). Independent wallet addresses so this block cannot interact
 * with the indexer block above regardless of ordering.
 */
const WALLET_C = "0xc7a7000300000000000000000000000000000000";
const WALLET_D = "0xc7a7000400000000000000000000000000000000";
const LOCK_HASH = `0x${"b".repeat(64)}`;

const lockGoal = {
  title: "lock-state fixture",
  summary: "lock-state fixture — commitment lock helpers",
  mode: GoalMode.SELF_COMMITMENT,
  checkInFrequency: "Every week",
};
const lockDraft = (goalId: string) => ({
  goalId,
  principalWei: "1000000000000000",
  rewardWei: "0",
  gracePeriodSeconds: 0,
  confidenceThreshold: 70,
  releaseCondition: "Ship the feature",
  failurePath: "Principal returns to the depositor",
});

describe.skipIf(!dbReady)("commitment lock state (LOCK_FUNDS index)", () => {
  let lockedId = "";
  let unlockedId = "";

  beforeAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: { in: [WALLET_C, WALLET_D] } } });
    await ensureWallet(WALLET_C);
    await ensureWallet(WALLET_D);
    // Two goals: a Commitment's `goalId` is unique, so two distinct commitments
    // require two goals (re-drafting one goal would just overwrite the same row).
    const goalLocked = await createGoal(WALLET_C, lockGoal);
    const goalUnlocked = await createGoal(WALLET_C, lockGoal);
    const locked = await createDraftCommitment(WALLET_C, lockDraft(goalLocked.id));
    const unlocked = await createDraftCommitment(WALLET_C, lockDraft(goalUnlocked.id));
    lockedId = locked.id;
    unlockedId = unlocked.id;
    // Only `locked` gets a LOCK_FUNDS receipt (a real broadcast would produce one).
    await recordChainTx(WALLET_C, {
      kind: ChainTxKind.LOCK_FUNDS,
      txHash: LOCK_HASH,
      title: "Locked principal",
      commitmentId: locked.id,
    });
  });
  afterAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: { in: [WALLET_C, WALLET_D] } } });
    await prisma.$disconnect();
  });

  it("isCommitmentLocked reflects an indexed LOCK_FUNDS tx, not the DB status", async () => {
    // Both commitments are CREATED in the DB; only the one with a LOCK_FUNDS receipt
    // reads as locked — exactly the distinction status alone cannot make.
    expect(await isCommitmentLocked(WALLET_C, lockedId)).toBe(true);
    expect(await isCommitmentLocked(WALLET_C, unlockedId)).toBe(false);
  });

  it("isCommitmentLocked is wallet-scoped (never sees another wallet's lock)", async () => {
    expect(await isCommitmentLocked(WALLET_D, lockedId)).toBe(false);
  });

  it("listLockedCommitmentIds returns exactly this wallet's locked ids, de-duplicated", async () => {
    const ids = await listLockedCommitmentIds(WALLET_C);
    expect(ids.has(lockedId)).toBe(true);
    expect(ids.has(unlockedId)).toBe(false);

    // Re-recording the same lock hash (e.g. once mined) must not duplicate the id.
    await recordChainTx(WALLET_C, {
      kind: ChainTxKind.LOCK_FUNDS,
      txHash: LOCK_HASH,
      title: "Locked principal (mined)",
      commitmentId: lockedId,
      blockNumber: 5n,
    });
    const again = await listLockedCommitmentIds(WALLET_C);
    expect([...again].filter((id) => id === lockedId)).toHaveLength(1);

    // A wallet with no locks gets an empty set.
    expect((await listLockedCommitmentIds(WALLET_D)).size).toBe(0);
  });
});
