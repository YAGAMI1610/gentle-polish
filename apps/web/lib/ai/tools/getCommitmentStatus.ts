import { z } from "zod";
import { getCommitmentByGoal } from "@/lib/db";
import {
  commitmentStatusName,
  isChainConfigured,
  readChainConfig,
  readCommitmentStatus,
} from "@/lib/chain";
import type { ToolDefinition } from "./types";

/**
 * `getCommitmentStatus` — read the on-chain-indexed commitment for a goal.
 *
 * Read-only, wallet-scoped, no decision-log entry. Money amounts are returned as
 * strings (Decimal/BigInt) so full uint256 precision survives JSON. The DB row is
 * the primary answer; when the chain is configured and the commitment has an
 * on-chain id, it additionally does a best-effort live status read (a view call —
 * it moves nothing). A live read failure never breaks the tool; `onchainStatus`
 * is simply left null. Creating/funding/claiming a commitment moves real value and
 * is prepared for the user's own wallet to sign, never done here (rules 1–3).
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
  /** Live on-chain status name, when a configured chain read succeeded (else null). */
  onchainStatus: string | null;
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
        onchainStatus: null,
      };
    }

    // Best-effort live status: a view call (no funds, no key). Never fatal — if the
    // RPC is unreachable or the contract isn't deployed, we fall back to the DB row.
    let onchainStatus: string | null = null;
    if (isChainConfigured() && commitment.onchainCommitmentId !== null) {
      try {
        const raw = await readCommitmentStatus(commitment.onchainCommitmentId, readChainConfig());
        onchainStatus = commitmentStatusName(raw);
      } catch {
        onchainStatus = null;
      }
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
      onchainStatus,
    };
  },
};
