import { NextResponse } from "next/server";
import { z } from "zod";
import { toHttpError, BadRequestError } from "@/lib/auth/errors";
import { assertSameOrigin } from "@/lib/auth/origin";
import { requireWallet } from "@/lib/auth/session";
import { reconcileChainTransactions } from "@/lib/api/chainReconciler";
import type { ChainReconcileResult } from "@/lib/api/dto";

/**
 * POST /api/chain/reconcile — replay the vault's past events and reconstruct this
 * wallet's `ChainTransaction` rows (LIMITATIONS.md item 12).
 *
 * The complement to `POST /api/chain/record`: that one indexes a transaction at broadcast
 * time, this one recovers the ones nobody was there to record — sent while the app was
 * down, from another browser, or straight from a wallet / `cast`.
 *
 * It is a POST because it writes, so it carries the same `assertSameOrigin` +
 * `requireWallet` boundary as every other write. Everything it writes is derived from
 * mined logs the configured vault itself emitted and is attributed by the vault's own
 * per-wallet index, so a caller cannot inject a transaction, claim a stranger's, or move
 * any funds with it (CLAUDE.md rules 1–3). Rows the app already recorded are never
 * overwritten. Safe to call repeatedly: `recordChainTx` is an idempotent upsert.
 *
 * A body is optional; `{}` (or no body) replays from `COMMITMENT_VAULT_DEPLOYMENT_BLOCK`
 * (else block 0) to the chain head. Block bounds are base-10 strings because a block
 * number is a uint256 on the wire.
 */
export const dynamic = "force-dynamic";

const uint = z
  .string()
  .trim()
  .regex(/^(0|[1-9][0-9]*)$/, "must be a non-negative base-10 integer");

const reconcileRequest = z
  .object({
    fromBlock: uint.optional(),
    toBlock: uint.optional(),
    // Bounded so one request cannot ask for an unreasonable per-query span; the
    // reconciler chunks the range with whatever value lands here.
    chunkBlocks: uint.optional(),
  })
  .strict();

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const wallet = await requireWallet();

    // An absent/empty body means "replay everything" — not a malformed request.
    const text = await req.text();
    let raw: unknown = {};
    if (text.trim() !== "") {
      try {
        raw = JSON.parse(text) as unknown;
      } catch {
        throw new BadRequestError("request body must be valid JSON");
      }
    }
    const parsed = reconcileRequest.parse(raw);

    const report = await reconcileChainTransactions(wallet, {
      ...(parsed.fromBlock === undefined ? {} : { fromBlock: BigInt(parsed.fromBlock) }),
      ...(parsed.toBlock === undefined ? {} : { toBlock: BigInt(parsed.toBlock) }),
      ...(parsed.chunkBlocks === undefined
        ? {}
        : { chunkBlocks: BigInt(parsed.chunkBlocks) === 0n ? 1n : BigInt(parsed.chunkBlocks) }),
    });

    const body: ChainReconcileResult = {
      configured: report.configured,
      fromBlock: report.fromBlock,
      toBlock: report.toBlock,
      chunks: report.chunks,
      eventsSeen: report.eventsSeen,
      eventsForWallet: report.eventsForWallet,
      recorded: report.recorded,
      blockNumbersFilled: report.blockNumbersFilled,
      alreadyIndexed: report.alreadyIndexed,
      skipped: report.skipped,
      transactions: report.transactions.map((t) => ({
        txHash: t.txHash,
        kind: t.kind,
        eventName: t.eventName,
        blockNumber: t.blockNumber,
        outcome: t.outcome,
        goalId: t.goalId,
        commitmentId: t.commitmentId,
        reason: t.reason,
      })),
      unmapped: report.unmapped.map((u) => ({
        eventName: u.eventName,
        txHash: u.txHash,
        blockNumber: u.blockNumber,
        detail: u.detail,
      })),
      reason: report.reason,
    };
    return NextResponse.json(body, { status: 200 });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
