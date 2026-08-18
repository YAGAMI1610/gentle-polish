import { z } from "zod";
import { getCommitmentByGoal } from "@/lib/db";
import type { ToolDefinition } from "./types";

/**
 * `getCommitmentStatus` — read the on-chain-indexed commitment for a goal.
 *
 * Read-only, wallet-scoped, no decision-log entry. Money amounts are returned as
 * strings (Decimal/BigInt) so full uint256 precision survives JSON. This reports
 * status only — creating/funding/claiming a commitment moves real value and is
 * build step 8 (the contract client), never here (CLAUDE.md rules 1–3).
 */

const input = z.object({
  goalId: z.string().trim().min(1).max(64),
});

export interface GetCommitmentStatusResult {
  goalId: string;
  exists: boolean;
  status: string | null;
  principalWei: string | null;
  rewardWei: string | null;
  token: string | null;
  releaseCondition: string | null;
  failurePath: string | null;
  onchainCommitmentId: string | null;
  txHash: string | null;
}

const parameters: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    goalId: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      description: "Goal whose commitment to look up.",
    },
  },
  required: ["goalId"],
};

export const getCommitmentStatusTool: ToolDefinition<typeof input, GetCommitmentStatusResult> = {
  name: "getCommitmentStatus",
  description:
    "Report the status of the financial commitment attached to a goal (amounts, release " +
    "condition, failure path, on-chain id). Read-only — it never creates, funds, or claims a " +
    "commitment.",
  input,
  parameters,
  async handler(args, ctx) {
    const commitment = await getCommitmentByGoal(ctx.walletAddress, args.goalId);
    if (!commitment) {
      return {
        goalId: args.goalId,
        exists: false,
        status: null,
        principalWei: null,
        rewardWei: null,
        token: null,
        releaseCondition: null,
        failurePath: null,
        onchainCommitmentId: null,
        txHash: null,
      };
    }

    return {
      goalId: args.goalId,
      exists: true,
      status: commitment.status,
      principalWei: commitment.principalWei.toString(),
      rewardWei: commitment.rewardWei.toString(),
      token: commitment.token,
      releaseCondition: commitment.releaseCondition,
      failurePath: commitment.failurePath,
      onchainCommitmentId:
        commitment.onchainCommitmentId !== null ? commitment.onchainCommitmentId.toString() : null,
      txHash: commitment.txHash ?? null,
    };
  },
};
