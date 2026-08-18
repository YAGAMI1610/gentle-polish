import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChainTxKind } from "@prisma/client";
import {
  ensureWallet,
  getChainTxByHash,
  listChainTxs,
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
