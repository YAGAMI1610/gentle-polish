import { NextResponse } from "next/server";
import { toHttpError } from "@/lib/auth/errors";
import { assertSameOrigin } from "@/lib/auth/origin";
import { requireWallet } from "@/lib/auth/session";
import { readJsonBody } from "@/lib/api/http";
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
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const wallet = await requireWallet();
    // Repo re-parses via `recordChainTxInput`; a bad shape throws ZodError → 400.
    const tx = await recordChainTx(wallet, (await readJsonBody(req)) as RecordChainTxInput);
    const body: ChainRecordResult = {
      id: tx.id,
      kind: tx.kind,
      txHash: tx.txHash,
      title: tx.title,
      detail: tx.detail ?? null,
      commitmentId: tx.commitmentId ?? null,
      goalId: tx.goalId ?? null,
      createdAt: tx.createdAt.toISOString(),
    };
    return NextResponse.json(body, { status: 201 });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
