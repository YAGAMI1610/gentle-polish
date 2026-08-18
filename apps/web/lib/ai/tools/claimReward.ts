import { z } from "zod";
import { getCommitmentByGoal, logDecision } from "@/lib/db";
import { isChainConfigured, prepareClaimReward, readChainConfig } from "@/lib/chain";
import type { PreparedTxResult } from "./createCommitment";
import type { ToolDefinition } from "./types";

/**
 * `claimReward` — PREPARE ONLY (build-prompt §3, §14.8; CLAUDE.md rules 1–3).
 *
 * Withdrawals are pull-based and depositor-signed: the contract requires
 * `msg.sender == depositor` and only pays out an APPROVED commitment. This tool
 * therefore never broadcasts and the backend holds no key that could — it just
 * returns the encoded `claimReward` calldata for the depositor's own wallet to
 * sign (step 9). `value` is "0" (a withdrawal sends no value in). If the chain
 * isn't configured or there is no on-chain commitment yet, it says so honestly.
 */

const input = z.object({
  goalId: z.string().trim().min(1).max(64),
});

export interface ClaimRewardResult {
  goalId: string;
  configured: boolean;
  prepared: boolean;
  reason: string | null;
  onchainCommitmentId: string | null;
  transaction: PreparedTxResult | null;
}

const parameters: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    goalId: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      description: "Goal whose commitment reward to claim.",
    },
  },
  required: ["goalId"],
};

export const claimRewardTool: ToolDefinition<typeof input, ClaimRewardResult> = {
  name: "claimReward",
  description:
    "Prepare (do NOT send) a reward claim for a goal's commitment: return the transaction for the " +
    "user's own wallet to sign. This never moves funds and never broadcasts — the contract only pays " +
    "the depositor, on an approved commitment, and the user signs the withdrawal themselves.",
  input,
  parameters,
  async handler(args, ctx): Promise<ClaimRewardResult> {
    // Honest not-configured before any DB work (rule 1).
    if (!isChainConfigured()) {
      return {
        goalId: args.goalId,
        configured: false,
        prepared: false,
        reason: "chain not configured (no deployed CommitmentVault) — see LIMITATIONS.md step 8",
        onchainCommitmentId: null,
        transaction: null,
      };
    }

    const commitment = await getCommitmentByGoal(ctx.walletAddress, args.goalId);
    if (!commitment || commitment.onchainCommitmentId === null) {
      return {
        goalId: args.goalId,
        configured: true,
        prepared: false,
        reason: "no on-chain commitment exists for this goal yet — nothing to claim",
        onchainCommitmentId: null,
        transaction: null,
      };
    }

    const config = readChainConfig();
    const prepared = prepareClaimReward(commitment.onchainCommitmentId, config);

    await logDecision(ctx.walletAddress, {
      toolName: "claimReward",
      action: "reward.prepare",
      decision: `Prepared claimReward for goal ${args.goalId} for the depositor to sign.`,
      goalId: args.goalId,
      modelVersion: ctx.modelVersion,
    });

    return {
      goalId: args.goalId,
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
  },
};
