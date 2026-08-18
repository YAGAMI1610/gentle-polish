import { z } from "zod";
import { ChainTxKind } from "@prisma/client";
import { getCommitmentByGoal, getLatestVerification, logDecision, recordChainTx } from "@/lib/db";
import {
  explorerTxUrl,
  getAttestorClient,
  hashToBytes32,
  isAttestorConfigured,
  readChainConfig,
} from "@/lib/chain";
import type { ToolDefinition } from "./types";

/**
 * `requestCompletion` — a REAL attestor call when configured (build-prompt §6.5,
 * §14.8; CLAUDE.md rules 1–3).
 *
 * This is one of the few on-chain writes the backend can make, and it moves NO
 * funds: the contract's `requestCompletion` only transitions an Active commitment
 * to CompletionRequested and records the verification hash. The backend's attestor
 * key can call it (the contract allows attestor OR depositor) but has no path to
 * move value. When the chain/attestor isn't configured, it returns an honest
 * "not configured" result rather than a fake tx (rule 1). A `ChainTransaction` row
 * is written ONLY after a real broadcast returns a hash.
 */

const input = z.object({
  goalId: z.string().trim().min(1).max(64),
  // A 32-byte hash (64 hex, optional 0x). Defaults to the goal's latest verification.
  verificationHash: z
    .string()
    .trim()
    .regex(/^(0x)?[0-9a-fA-F]{64}$/, "must be a 32-byte (64 hex) verification hash")
    .optional(),
});

export interface RequestCompletionResult {
  goalId: string;
  configured: boolean;
  broadcast: boolean;
  reason: string | null;
  txHash: string | null;
  explorerUrl: string | null;
  onchainCommitmentId: string | null;
  verificationHash: string | null;
}

const parameters: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    goalId: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      description: "Goal whose commitment should be marked completion-requested.",
    },
    verificationHash: {
      type: "string",
      pattern: "^(0x)?[0-9a-fA-F]{64}$",
      description:
        "The §6.5 verification hash to anchor. Omit to use the goal's latest verification record.",
    },
  },
  required: ["goalId"],
};

export const requestCompletionTool: ToolDefinition<typeof input, RequestCompletionResult> = {
  name: "requestCompletion",
  description:
    "Submit an on-chain completion request for a goal's commitment, anchoring the verification hash. " +
    "This moves no funds — it only asks the contract to mark the commitment completion-requested. " +
    "Runs a real transaction when the chain is configured; otherwise reports that it is not configured.",
  input,
  parameters,
  async handler(args, ctx): Promise<RequestCompletionResult> {
    // Honest not-configured first — no attestor key / no deployed contract means no
    // fake tx and no reason to touch the DB (rule 1). This call moves no funds.
    if (!isAttestorConfigured()) {
      return {
        goalId: args.goalId,
        configured: false,
        broadcast: false,
        reason: "attestor not configured — see LIMITATIONS.md step 8 (this call moves no funds)",
        txHash: null,
        explorerUrl: null,
        onchainCommitmentId: null,
        verificationHash: null,
      };
    }

    const commitment = await getCommitmentByGoal(ctx.walletAddress, args.goalId);
    if (!commitment || commitment.onchainCommitmentId === null) {
      return {
        goalId: args.goalId,
        configured: true,
        broadcast: false,
        reason: "no on-chain commitment exists for this goal yet",
        txHash: null,
        explorerUrl: null,
        onchainCommitmentId: null,
        verificationHash: null,
      };
    }

    const resolvedHash =
      args.verificationHash ??
      (await getLatestVerification(ctx.walletAddress, args.goalId))?.verificationHash;
    if (!resolvedHash) {
      return {
        goalId: args.goalId,
        configured: true,
        broadcast: false,
        reason: "no verification hash available — run verification first",
        txHash: null,
        explorerUrl: null,
        onchainCommitmentId: commitment.onchainCommitmentId.toString(),
        verificationHash: null,
      };
    }

    const config = readChainConfig();
    const attestor = getAttestorClient(config);
    const txHash = await attestor.requestCompletion({
      commitmentId: commitment.onchainCommitmentId,
      verificationHash: hashToBytes32(resolvedHash),
    });

    // A row exists only now, after a real broadcast returned a hash (rule 1).
    await recordChainTx(ctx.walletAddress, {
      kind: ChainTxKind.REQUEST_COMPLETION,
      txHash,
      commitmentId: commitment.id,
      goalId: args.goalId,
      title: "Completion requested",
      detail: `Anchored verification hash for goal ${args.goalId}.`,
    });

    await logDecision(ctx.walletAddress, {
      toolName: "requestCompletion",
      action: "commitment.requestCompletion",
      decision: `Broadcast requestCompletion for goal ${args.goalId} (tx ${txHash}).`,
      goalId: args.goalId,
      verificationHash: resolvedHash,
      modelVersion: ctx.modelVersion,
    });

    return {
      goalId: args.goalId,
      configured: true,
      broadcast: true,
      reason: null,
      txHash,
      explorerUrl: explorerTxUrl(txHash, config.explorerUrl),
      onchainCommitmentId: commitment.onchainCommitmentId.toString(),
      verificationHash: resolvedHash,
    };
  },
};
