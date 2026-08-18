import { getGoal, createDraftCommitment, logDecision, WalletScopeError } from "@/lib/db";
import { createDraftCommitmentInput } from "@/lib/db/schemas";
import { isChainConfigured, prepareCreateCommitment, readChainConfig } from "@/lib/chain";
import type { ToolDefinition } from "./types";

/**
 * `createCommitment` — PREPARE ONLY (build-prompt §3, §14.8; CLAUDE.md rules 1–3).
 *
 * This never broadcasts and never moves funds. It records the intended terms as a
 * DRAFT commitment (so the user can review `releaseCondition` / `failurePath`
 * before signing) and returns the ENCODED `createCommitment` calldata for the
 * DEPOSITOR's own wallet to sign in step 9. The backend holds no key that could
 * send it — the contract requires `msg.sender == goal.owner`, i.e. the user.
 *
 * `value` is always "0": `createCommitment` fixes terms only; the principal is
 * attached later by the depositor's own signed `lockFunds`. If the chain isn't
 * configured, or the goal isn't registered on-chain yet, it says so honestly
 * (no fake calldata) — while still saving the draft terms for review.
 */

export interface PreparedTxResult {
  chainId: number;
  to: string;
  data: string;
  /** Wei to attach, as a string. Always "0" here — creation moves no funds. */
  value: string;
}

export interface CommitmentTermsResult {
  principalWei: string;
  rewardWei: string;
  deadline: string | null;
  gracePeriodSeconds: number;
  confidenceThreshold: number;
  releaseCondition: string;
  failurePath: string;
}

export interface CreateCommitmentResult {
  goalId: string;
  configured: boolean;
  prepared: boolean;
  reason: string | null;
  draftCommitmentId: string | null;
  onchainGoalId: string | null;
  transaction: PreparedTxResult | null;
  terms: CommitmentTermsResult | null;
}

const parameters: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    goalId: { type: "string", minLength: 1, maxLength: 64, description: "Goal to commit to." },
    principalWei: {
      type: "string",
      pattern: "^\\d+$",
      description:
        "Principal to stake, in wei (base-10 string). Locked later by the user's own tx.",
    },
    rewardWei: {
      type: "string",
      pattern: "^\\d+$",
      description: "Optional reward, in wei (base-10 string). Defaults to 0.",
    },
    deadline: {
      type: "string",
      format: "date-time",
      description: "Optional ISO deadline. Omit for open-ended.",
    },
    gracePeriodSeconds: {
      type: "integer",
      minimum: 0,
      maximum: 315360000,
      description: "Grace period in seconds after the deadline. Defaults to 0.",
    },
    confidenceThreshold: {
      type: "integer",
      minimum: 1,
      maximum: 100,
      description:
        "Verification confidence (1–100) required to approve completion. Defaults to 70.",
    },
    releaseCondition: {
      type: "string",
      minLength: 1,
      maxLength: 2000,
      description:
        "Human-readable condition for releasing the principal. Shown to the user pre-sign.",
    },
    failurePath: {
      type: "string",
      minLength: 1,
      maxLength: 2000,
      description: "Human-readable outcome if the goal is not met. Shown to the user pre-sign.",
    },
  },
  required: ["goalId", "principalWei", "releaseCondition", "failurePath"],
};

export const createCommitmentTool: ToolDefinition<
  typeof createDraftCommitmentInput,
  CreateCommitmentResult
> = {
  name: "createCommitment",
  description:
    "Prepare (do NOT send) a financial commitment for a goal: save the draft terms for the user to " +
    "review and return the transaction for the user's own wallet to sign. This never moves funds and " +
    "never broadcasts — the user signs it themselves. Requires release condition and failure path.",
  input: createDraftCommitmentInput,
  parameters,
  async handler(args, ctx): Promise<CreateCommitmentResult> {
    const terms: CommitmentTermsResult = {
      principalWei: args.principalWei,
      rewardWei: args.rewardWei ?? "0",
      deadline: args.deadline ? new Date(args.deadline).toISOString() : null,
      gracePeriodSeconds: args.gracePeriodSeconds ?? 0,
      confidenceThreshold: args.confidenceThreshold ?? 70,
      releaseCondition: args.releaseCondition,
      failurePath: args.failurePath,
    };

    // Honest not-configured: no deployed contract means no calldata to prepare (rule 1).
    if (!isChainConfigured()) {
      return {
        goalId: args.goalId,
        configured: false,
        prepared: false,
        reason: "chain not configured (no deployed CommitmentVault) — see LIMITATIONS.md step 8",
        draftCommitmentId: null,
        onchainGoalId: null,
        transaction: null,
        terms,
      };
    }

    const goal = await getGoal(ctx.walletAddress, args.goalId);
    if (!goal) {
      throw new WalletScopeError("goal not found for this wallet");
    }

    // Persist the intended terms so the user can review them before signing (§3).
    const draft = await createDraftCommitment(ctx.walletAddress, args);

    // The on-chain createCommitment requires the goal's on-chain id, which exists
    // only after registerGoal is broadcast+indexed. Until then, say so honestly.
    if (goal.onchainGoalId === null) {
      await logDecision(ctx.walletAddress, {
        toolName: "createCommitment",
        action: "commitment.draft",
        decision: `Drafted commitment terms (principal ${terms.principalWei} wei); goal not yet on-chain.`,
        goalId: args.goalId,
        modelVersion: ctx.modelVersion,
      });
      return {
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
    }

    const config = readChainConfig();
    const deadlineUnix = args.deadline
      ? BigInt(Math.floor(new Date(args.deadline).getTime() / 1000))
      : 0n;
    const prepared = prepareCreateCommitment(
      {
        goalId: goal.onchainGoalId,
        principalWei: BigInt(terms.principalWei),
        rewardWei: BigInt(terms.rewardWei),
        deadline: deadlineUnix,
        gracePeriodSeconds: BigInt(terms.gracePeriodSeconds),
        confidenceThreshold: terms.confidenceThreshold,
      },
      config,
    );

    await logDecision(ctx.walletAddress, {
      toolName: "createCommitment",
      action: "commitment.prepare",
      decision: `Prepared createCommitment for goal ${args.goalId} (principal ${terms.principalWei} wei) for the user to sign.`,
      goalId: args.goalId,
      modelVersion: ctx.modelVersion,
    });

    return {
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
  },
};
