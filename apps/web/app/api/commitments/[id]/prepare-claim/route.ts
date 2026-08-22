import { NextResponse } from "next/server";
import { toHttpError } from "@/lib/auth/errors";
import { assertSameOrigin } from "@/lib/auth/origin";
import { requireWallet } from "@/lib/auth/session";
import { getCommitment } from "@/lib/db";
import { isChainConfigured, prepareReleasePrincipal } from "@/lib/chain";
import type { PrepareSignResult } from "@/lib/api/dto";

/**
 * POST /api/commitments/[id]/prepare-claim — PREPARE ONLY (build step 9, phase 3;
 * CLAUDE.md rules 1–3). Returns the ENCODED `releasePrincipal` calldata (`value` 0
 * — a withdrawal sends nothing in) for the DEPOSITOR's own wallet to sign.
 *
 * Reward concept removed (product decision): completing a goal returns exactly the
 * staked PRINCIPAL, never a separate reward. So the success payout is
 * `releasePrincipal`, not `claimReward`. The contract pays only the depositor, and
 * only on an APPROVED commitment; if it isn't approved yet the user's own signed tx
 * reverts on-chain — we never fake success here. Honest reason when the chain isn't
 * configured or there is no on-chain commitment.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const wallet = await requireWallet();
    const { id } = await ctx.params;

    const commitment = await getCommitment(wallet, id);
    if (!commitment) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    if (!isChainConfigured()) {
      const body: PrepareSignResult = {
        commitmentId: id,
        configured: false,
        prepared: false,
        reason: "chain not configured (no deployed CommitmentVault) — see LIMITATIONS.md step 8",
        onchainCommitmentId: null,
        transaction: null,
      };
      return NextResponse.json(body);
    }

    if (commitment.onchainCommitmentId === null) {
      const body: PrepareSignResult = {
        commitmentId: id,
        configured: true,
        prepared: false,
        reason: "no on-chain commitment exists for this goal yet — nothing to release",
        onchainCommitmentId: null,
        transaction: null,
      };
      return NextResponse.json(body);
    }

    const prepared = prepareReleasePrincipal(commitment.onchainCommitmentId);
    const body: PrepareSignResult = {
      commitmentId: id,
      configured: true,
      prepared: true,
      reason: null,
      onchainCommitmentId: commitment.onchainCommitmentId.toString(),
      transaction: {
        chainId: prepared.chainId,
        to: prepared.to,
        data: prepared.data,
        value: prepared.value.toString(),
      },
    };
    return NextResponse.json(body);
  } catch (err) {
    const { status, body } = toHttpError(err, "api/commitments/[id]/prepare-claim");
    return NextResponse.json(body, { status });
  }
}
