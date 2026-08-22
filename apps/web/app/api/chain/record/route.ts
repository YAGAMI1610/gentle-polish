import { NextResponse } from "next/server";
import { toHttpError } from "@/lib/auth/errors";
import { assertSameOrigin } from "@/lib/auth/origin";
import { requireWallet } from "@/lib/auth/session";
import { readJsonBody } from "@/lib/api/http";
import { backfillOnchainId, type OnchainBackfillResult } from "@/lib/api/onchainBackfill";
import { recordChainTx } from "@/lib/db";
import type { RecordChainTxInput } from "@/lib/db";
import type { ChainRecordResult } from "@/lib/api/dto";

/**
 * POST /api/chain/record — index a REAL broadcast transaction (build step 9,
 * phase 3; CLAUDE.md rule 1). The client calls this ONLY after the user's own
 * wallet returns a real hash from a `prepare*` transaction (see `useChainTx`).
 * The backend never invents a hash and never broadcasts — it only records what
 * the wallet already sent. `recordChainTx` is an idempotent upsert on `txHash`
 * and rejects cross-wallet / rebound hashes (`WalletScopeError` → 403).
 *
 * After the row is safely indexed, we attempt the on-chain-id back-fill
 * (build-prompt §14.8; LIMITATIONS §17): re-read the receipt and write the emitted
 * `goalId` / `commitmentId` back onto the owning row so `prepare*` stops answering
 * `{prepared:false}`. This is BEST-EFFORT — the index write is the durable result,
 * so a transient chain-read failure is caught and reported in `backfillReason`
 * rather than failing the request (a later re-record or the reconciler fills it in).
 */
export const dynamic = "force-dynamic";

const NO_BACKFILL: OnchainBackfillResult = {
  backfilled: false,
  onchainGoalId: null,
  onchainCommitmentId: null,
  reason: null,
};

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const wallet = await requireWallet();
    // Repo re-parses via `recordChainTxInput`; a bad shape throws ZodError → 400.
    const tx = await recordChainTx(wallet, (await readJsonBody(req)) as RecordChainTxInput);

    let backfill = NO_BACKFILL;
    try {
      backfill = await backfillOnchainId(wallet, {
        kind: tx.kind,
        txHash: tx.txHash,
        goalId: tx.goalId ?? null,
        commitmentId: tx.commitmentId ?? null,
      });
    } catch (backfillErr) {
      // The tx is already indexed; a receipt-read failure only defers the id.
      backfill = {
        ...NO_BACKFILL,
        reason: `receipt not readable yet: ${
          backfillErr instanceof Error ? backfillErr.message : "unknown chain-read error"
        }`,
      };
    }

    const body: ChainRecordResult = {
      id: tx.id,
      kind: tx.kind,
      txHash: tx.txHash,
      title: tx.title,
      detail: tx.detail ?? null,
      commitmentId: tx.commitmentId ?? null,
      goalId: tx.goalId ?? null,
      createdAt: tx.createdAt.toISOString(),
      backfilled: backfill.backfilled,
      onchainGoalId: backfill.onchainGoalId,
      onchainCommitmentId: backfill.onchainCommitmentId,
      backfillReason: backfill.reason,
    };
    return NextResponse.json(body, { status: 201 });
  } catch (err) {
    const { status, body } = toHttpError(err, "api/chain/record");
    return NextResponse.json(body, { status });
  }
}
