import { SignalLevel, VerificationStatus } from "@prisma/client";
import { z } from "zod";
import { createVerificationRecord, getVerificationStrategy, logDecision } from "@/lib/db";
import type { CreateVerificationRecordInput } from "@/lib/db/schemas";
import {
  computeVerificationHash,
  runRealityCheck as runRealityCheckEngine,
} from "@/lib/ai/verification";
import type { ToolDefinition } from "./types";

/**
 * `runRealityCheck` — combine independent signals into a verification verdict
 * (§6.3), optionally persisting it.
 *
 * The verdict comes from the deterministic engine, which applies hard gates
 * (contradiction / impossible delta / duplicate) that optimistic model signals
 * cannot override, and never returns VERIFIED on LOW evidence. Reasoning is
 * non-accusatory. When `persist` is set, a `VerificationRecord` is written with
 * the canonical §6.5 hash. Every path is audit-logged, and `logDecision` /
 * `createVerificationRecord` enforce that the goal belongs to this wallet. No
 * completion or fund side effect — anchoring/settlement is step 8.
 */

const input = z.object({
  goalId: z.string().trim().min(1).max(64),
  milestoneId: z.string().trim().min(1).max(64).optional(),
  plausibility: z.nativeEnum(SignalLevel).optional(),
  evidenceQuality: z.nativeEnum(SignalLevel).optional(),
  consistency: z.nativeEnum(SignalLevel).optional(),
  contradiction: z.boolean().optional(),
  duplicateEvidence: z.boolean().optional(),
  impossibleDelta: z.boolean().optional(),
  persist: z.boolean().optional(),
});

export interface RunRealityCheckResult {
  goalId: string;
  status: VerificationStatus;
  confidence: number;
  plausibility: SignalLevel;
  evidenceQuality: SignalLevel;
  consistency: SignalLevel;
  reasoning: string;
  verificationHash: string | null;
}

const signalEnum = [...Object.values(SignalLevel)];

const parameters: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    goalId: { type: "string", minLength: 1, maxLength: 64, description: "Goal being checked." },
    milestoneId: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      description: "Milestone being checked, if any.",
    },
    plausibility: {
      type: "string",
      enum: signalEnum,
      description: "How plausible the claimed progress is.",
    },
    evidenceQuality: {
      type: "string",
      enum: signalEnum,
      description: "Strength of evidence. VERIFIED is impossible when LOW.",
    },
    consistency: {
      type: "string",
      enum: signalEnum,
      description: "Agreement with prior check-ins.",
    },
    contradiction: {
      type: "boolean",
      description: "True if this directly contradicts prior recorded data (hard gate → rejected).",
    },
    duplicateEvidence: {
      type: "boolean",
      description: "True if the evidence was already submitted before.",
    },
    impossibleDelta: {
      type: "boolean",
      description:
        "True if the claimed progress jump is physically impossible in the time (hard gate).",
    },
    persist: {
      type: "boolean",
      description: "Whether to record this verdict as a VerificationRecord. Defaults to false.",
    },
  },
  required: ["goalId"],
};

export const runRealityCheckTool: ToolDefinition<typeof input, RunRealityCheckResult> = {
  name: "runRealityCheck",
  description:
    "Combine plausibility, evidence quality, consistency, and anti-gaming flags into a verdict " +
    "(verified / needs more / unverified / rejected-as-inconsistent) with non-accusatory " +
    "reasoning. Set persist=true to record the result. It never moves funds or completes a goal.",
  input,
  parameters,
  async handler(args, ctx) {
    const strategy = await getVerificationStrategy(ctx.walletAddress, args.goalId);
    const threshold = strategy?.confidenceThreshold ?? 70;

    const result = runRealityCheckEngine({
      ...(args.plausibility !== undefined ? { plausibility: args.plausibility } : {}),
      ...(args.evidenceQuality !== undefined ? { evidenceQuality: args.evidenceQuality } : {}),
      ...(args.consistency !== undefined ? { consistency: args.consistency } : {}),
      ...(args.contradiction !== undefined ? { contradiction: args.contradiction } : {}),
      ...(args.duplicateEvidence !== undefined
        ? { duplicateEvidence: args.duplicateEvidence }
        : {}),
      ...(args.impossibleDelta !== undefined ? { impossibleDelta: args.impossibleDelta } : {}),
      threshold,
    });

    let verificationHash: string | null = null;
    if (args.persist === true) {
      const timestamp = new Date().toISOString();
      verificationHash = computeVerificationHash({
        goalId: args.goalId,
        milestoneId: args.milestoneId ?? null,
        result: {
          status: result.status,
          confidence: result.confidence,
          plausibility: result.plausibility,
          evidenceQuality: result.evidenceQuality,
          consistency: result.consistency,
        },
        timestamp,
        modelVersion: ctx.modelVersion,
      });

      const recordInput: CreateVerificationRecordInput = {
        goalId: args.goalId,
        status: result.status,
        plausibility: result.plausibility,
        evidenceQuality: result.evidenceQuality,
        consistency: result.consistency,
        confidence: result.confidence,
        reasoning: result.reasoning,
        verificationHash,
        modelVersion: ctx.modelVersion,
      };
      if (args.milestoneId !== undefined) recordInput.milestoneId = args.milestoneId;

      await createVerificationRecord(ctx.walletAddress, recordInput);
    }

    await logDecision(ctx.walletAddress, {
      toolName: "runRealityCheck",
      action: "reality.check",
      decision: result.reasoning,
      goalId: args.goalId,
      ...(args.milestoneId !== undefined ? { milestoneId: args.milestoneId } : {}),
      confidence: result.confidence,
      ...(verificationHash !== null ? { verificationHash } : {}),
      modelVersion: ctx.modelVersion,
    });

    return {
      goalId: args.goalId,
      status: result.status,
      confidence: result.confidence,
      plausibility: result.plausibility,
      evidenceQuality: result.evidenceQuality,
      consistency: result.consistency,
      reasoning: result.reasoning,
      verificationHash,
    };
  },
};
