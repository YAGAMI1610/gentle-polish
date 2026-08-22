import { NextResponse } from "next/server";
import { toHttpError } from "@/lib/auth/errors";
import { assertSameOrigin } from "@/lib/auth/origin";
import { requireWallet } from "@/lib/auth/session";
import { readJsonBody } from "@/lib/api/http";
import { loadCommitmentViews } from "@/lib/api/loaders";
import { createDraftCommitment, getGoal, WalletScopeError } from "@/lib/db";
import { createDraftCommitmentInput } from "@/lib/db";
import { isChainConfigured, prepareCreateCommitment } from "@/lib/chain";
import type { CommitmentTermsDto, PrepareCommitmentResult } from "@/lib/api/dto";

/** GET /api/commitments — the authenticated wallet's commitments (build step 9, phase 2). */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const wallet = await requireWallet();
    return NextResponse.json(await loadCommitmentViews(wallet));
  } catch (err) {
    const { status, body } = toHttpError(err, "api/commitments");
    return NextResponse.json(body, { status });
  }
}

/**
 * POST /api/commitments — PREPARE ONLY (build step 9, phase 3; CLAUDE.md rules 1–3).
 *
 * The REST twin of the `createCommitment` AI tool: always saves the DRAFT terms so
 * the user can review `releaseCondition` / `failurePath` before signing (§3), and
 * returns the ENCODED `createCommitment` calldata for the user's OWN wallet to sign
 * — only when the goal is already registered on-chain. It never broadcasts and the
 * backend holds no key that could. Honest `{prepared:false, reason}` (never fake
 * calldata) when the chain isn't configured or the goal isn't on-chain yet.
 *
 * (Provenance logging — `logDecision` — is intentionally the AI tool's job; this
 * REST path is a direct user action, not an AI decision, so the activity feed's
 * "ai" entries stay reserved for real model decisions.)
 */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const wallet = await requireWallet();
    const args = createDraftCommitmentInput.parse(await readJsonBody(req));

    const terms: CommitmentTermsDto = {
      principalWei: args.principalWei,
      // Reward removed (product decision) — always 0; the schema already coerces
      // args.rewardWei to "0", set here explicitly so the calldata can't carry a reward.
      rewardWei: "0",
      deadline: args.deadline ? new Date(args.deadline).toISOString() : null,
      gracePeriodSeconds: args.gracePeriodSeconds ?? 0,
      confidenceThreshold: args.confidenceThreshold ?? 70,
      releaseCondition: args.releaseCondition,
      failurePath: args.failurePath,
    };

    // Honest not-configured: no deployed contract means no calldata to prepare (rule 1).
    if (!isChainConfigured()) {
      const body: PrepareCommitmentResult = {
        goalId: args.goalId,
        configured: false,
        prepared: false,
        reason: "chain not configured (no deployed CommitmentVault) — see LIMITATIONS.md step 8",
        draftCommitmentId: null,
        onchainGoalId: null,
        transaction: null,
        terms,
      };
      return NextResponse.json(body, { status: 201 });
    }

    const goal = await getGoal(wallet, args.goalId);
    if (!goal) {
      throw new WalletScopeError("goal not found for this wallet");
    }

    // Persist the intended terms so the user can review them before signing (§3).
    const draft = await createDraftCommitment(wallet, args);

    // createCommitment needs the goal's on-chain id, which exists only after
    // registerGoal is broadcast + indexed. Until then, say so honestly.
    if (goal.onchainGoalId === null) {
      const body: PrepareCommitmentResult = {
        goalId: args.goalId,
        configured: true,
        prepared: false,
        reason:
          "goal is not registered on-chain yet — register the goal (registerGoal) before committing",
        draftCommitmentId: draft.id,
        onchainGoalId: null,
        transaction: null,
        terms,
      };
      return NextResponse.json(body, { status: 201 });
    }

    const deadlineUnix = args.deadline
      ? BigInt(Math.floor(new Date(args.deadline).getTime() / 1000))
      : 0n;
    const prepared = prepareCreateCommitment({
      goalId: goal.onchainGoalId,
      principalWei: BigInt(terms.principalWei),
      rewardWei: BigInt(terms.rewardWei),
      deadline: deadlineUnix,
      gracePeriodSeconds: BigInt(terms.gracePeriodSeconds),
      confidenceThreshold: terms.confidenceThreshold,
    });

    const body: PrepareCommitmentResult = {
      goalId: args.goalId,
      configured: true,
      prepared: true,
      reason: null,
      draftCommitmentId: draft.id,
      onchainGoalId: goal.onchainGoalId.toString(),
      transaction: {
        chainId: prepared.chainId,
        to: prepared.to,
        data: prepared.data,
        value: prepared.value.toString(),
      },
      terms,
    };
    return NextResponse.json(body, { status: 201 });
  } catch (err) {
    const { status, body } = toHttpError(err, "api/commitments");
    return NextResponse.json(body, { status });
  }
}
