import { z } from "zod";
import { ChainTxKind } from "@prisma/client";
import {
  getGoal,
  getLatestVerification,
  listMilestones,
  logDecision,
  recordChainTx,
  setMilestoneAnchor,
  setVerificationAnchor,
  WalletScopeError,
} from "@/lib/db";
import {
  explorerTxUrl,
  getAttestorClient,
  hashToBytes32,
  isAttestorConfigured,
  milestoneRefFromId,
  readChainConfig,
} from "@/lib/chain";
import type { ToolDefinition } from "./types";

/**
 * `anchorMilestone` — a REAL attestor call when configured (build-prompt §6.5,
 * §14.8; CLAUDE.md rules 1–3).
 *
 * Anchors a milestone's verification on-chain via the contract's
 * `registerMilestone`, which the attestor (or goal owner) may call and which moves
 * NO funds — it only records the milestone reference, verification hash, and
 * attested confidence. On a real broadcast this stamps the DB milestone with its
 * on-chain anchor and (optionally) the verification record with the tx hash, and
 * indexes the transaction. Unconfigured → honest "not configured" (rule 1); a row
 * is written only after a broadcast returns a hash.
 */

const input = z.object({
  goalId: z.string().trim().min(1).max(64),
  milestoneId: z.string().trim().min(1).max(64),
  confidence: z.number().int().min(0).max(100),
  verificationHash: z
    .string()
    .trim()
    .regex(/^(0x)?[0-9a-fA-F]{64}$/, "must be a 32-byte (64 hex) verification hash")
    .optional(),
  // If given, this verification record is stamped with the anchoring tx hash.
  verificationRecordId: z.string().trim().min(1).max(64).optional(),
});

export interface AnchorMilestoneResult {
  goalId: string;
  milestoneId: string;
  configured: boolean;
  broadcast: boolean;
  reason: string | null;
  txHash: string | null;
  explorerUrl: string | null;
  milestoneRef: string | null;
  verificationHash: string | null;
  confidence: number;
}

const parameters: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    goalId: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      description: "Goal the milestone belongs to.",
    },
    milestoneId: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      description: "Milestone to anchor.",
    },
    confidence: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      description: "Attested verification confidence (0–100) to record on-chain.",
    },
    verificationHash: {
      type: "string",
      pattern: "^(0x)?[0-9a-fA-F]{64}$",
      description:
        "The §6.5 verification hash to anchor. Omit to use the goal's latest verification.",
    },
    verificationRecordId: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      description: "Optional verification record to stamp with the resulting tx hash.",
    },
  },
  required: ["goalId", "milestoneId", "confidence"],
};

export const anchorMilestoneTool: ToolDefinition<typeof input, AnchorMilestoneResult> = {
  name: "anchorMilestone",
  description:
    "Anchor a milestone's verification on-chain (records reference, verification hash, and confidence). " +
    "This moves no funds. Runs a real transaction when the chain is configured; otherwise reports that " +
    "it is not configured.",
  input,
  parameters,
  async handler(args, ctx): Promise<AnchorMilestoneResult> {
    // Honest not-configured first — no fake tx, no DB work needed (rule 1).
    if (!isAttestorConfigured()) {
      return {
        goalId: args.goalId,
        milestoneId: args.milestoneId,
        configured: false,
        broadcast: false,
        reason: "attestor not configured — see LIMITATIONS.md step 8 (this call moves no funds)",
        txHash: null,
        explorerUrl: null,
        milestoneRef: null,
        verificationHash: null,
        confidence: args.confidence,
      };
    }

    const goal = await getGoal(ctx.walletAddress, args.goalId);
    if (!goal) {
      throw new WalletScopeError("goal not found for this wallet");
    }
    if (goal.onchainGoalId === null) {
      return {
        goalId: args.goalId,
        milestoneId: args.milestoneId,
        configured: true,
        broadcast: false,
        reason: "goal is not registered on-chain yet — register the goal (registerGoal) first",
        txHash: null,
        explorerUrl: null,
        milestoneRef: null,
        verificationHash: null,
        confidence: args.confidence,
      };
    }

    // The milestone must belong to this goal before we broadcast anything.
    const milestones = await listMilestones(ctx.walletAddress, args.goalId);
    if (!milestones.some((m) => m.id === args.milestoneId)) {
      throw new WalletScopeError("milestone not found for this goal");
    }

    const resolvedHash =
      args.verificationHash ??
      (await getLatestVerification(ctx.walletAddress, args.goalId))?.verificationHash;
    if (!resolvedHash) {
      return {
        goalId: args.goalId,
        milestoneId: args.milestoneId,
        configured: true,
        broadcast: false,
        reason: "no verification hash available — run verification first",
        txHash: null,
        explorerUrl: null,
        milestoneRef: null,
        verificationHash: null,
        confidence: args.confidence,
      };
    }

    const config = readChainConfig();
    const milestoneRef = milestoneRefFromId(args.milestoneId);
    const attestor = getAttestorClient(config);
    const txHash = await attestor.registerMilestone({
      goalId: goal.onchainGoalId,
      milestoneRef,
      verificationHash: hashToBytes32(resolvedHash),
      confidence: args.confidence,
    });

    // Persist the anchor only now that a real broadcast returned a hash (rule 1).
    await setMilestoneAnchor(ctx.walletAddress, args.goalId, args.milestoneId, {
      milestoneRef,
      verificationHash: resolvedHash,
      onchainConfidence: args.confidence,
    });
    if (args.verificationRecordId) {
      await setVerificationAnchor(ctx.walletAddress, args.verificationRecordId, txHash);
    }
    await recordChainTx(ctx.walletAddress, {
      kind: ChainTxKind.REGISTER_MILESTONE,
      txHash,
      goalId: args.goalId,
      title: "Milestone anchored",
      detail: `Registered milestone ${args.milestoneId} on-chain (confidence ${args.confidence}).`,
    });

    await logDecision(ctx.walletAddress, {
      toolName: "anchorMilestone",
      action: "milestone.anchor",
      decision: `Anchored milestone ${args.milestoneId} on-chain (tx ${txHash}, confidence ${args.confidence}).`,
      goalId: args.goalId,
      milestoneId: args.milestoneId,
      confidence: args.confidence,
      verificationHash: resolvedHash,
      modelVersion: ctx.modelVersion,
    });

    return {
      goalId: args.goalId,
      milestoneId: args.milestoneId,
      configured: true,
      broadcast: true,
      reason: null,
      txHash,
      explorerUrl: explorerTxUrl(txHash, config.explorerUrl),
      milestoneRef,
      verificationHash: resolvedHash,
      confidence: args.confidence,
    };
  },
};
