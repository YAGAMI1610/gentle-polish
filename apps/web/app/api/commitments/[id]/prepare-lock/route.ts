import { NextResponse } from "next/server";
import { toHttpError } from "@/lib/auth/errors";
import { assertSameOrigin } from "@/lib/auth/origin";
import { requireWallet } from "@/lib/auth/session";
import { getCommitment } from "@/lib/db";
import { isChainConfigured, prepareLockFunds } from "@/lib/chain";
import type { PrepareSignResult } from "@/lib/api/dto";

/**
 * POST /api/commitments/[id]/prepare-lock — PREPARE ONLY (build step 9, phase 3;
 * CLAUDE.md rules 1–3). Returns the ENCODED `lockFunds` calldata (with the
 * principal as `value`) for the DEPOSITOR's own wallet to sign — the backend
 * holds no key that could send it and never broadcasts. If the chain isn't
 * configured, or the commitment isn't on-chain yet, it says so honestly (no fake
 * calldata) rather than pretending. The contract requires `msg.sender == depositor`.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const wallet = await requireWallet();
    const { id } = await ctx.params;

    const commitment = await getCommitment(wallet, id);
    if (!commitment) {
      // Non-leak: absent and not-yours are indistinguishable (reads return null).
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
        reason: "commitment is not on-chain yet — sign createCommitment before locking funds",
        onchainCommitmentId: null,
        transaction: null,
      };
      return NextResponse.json(body);
    }

    // Decimal(78,0) → base-10 integer string → bigint wei for the payable deposit.
    const principalWei = BigInt(commitment.principalWei.toString());
    const prepared = prepareLockFunds(commitment.onchainCommitmentId, principalWei);
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
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
