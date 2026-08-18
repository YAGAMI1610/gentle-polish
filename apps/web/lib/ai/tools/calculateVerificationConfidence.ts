import { SignalLevel, VerificationStatus } from "@prisma/client";
import { z } from "zod";
import { logDecision } from "@/lib/db";
import { calculateVerificationConfidence } from "@/lib/ai/verification";
import type { ToolDefinition } from "./types";

/**
 * `calculateVerificationConfidence` — combine three coarse signals into a 0–100
 * confidence and a status (§6.3/§15).
 *
 * Pure scoring over the deterministic engine: the model supplies its read of the
 * signals, but the mapping to confidence/status is fixed and auditable, and a
 * VERIFIED status still requires non-LOW evidence quality. Advisory (writes no
 * verification record); if a goalId is given, the calculation is audit-logged
 * (which also enforces that the goal belongs to this wallet). No funds, no key.
 */

const input = z.object({
  goalId: z.string().trim().min(1).max(64).optional(),
  plausibility: z.nativeEnum(SignalLevel),
  evidenceQuality: z.nativeEnum(SignalLevel),
  consistency: z.nativeEnum(SignalLevel),
  threshold: z.number().int().min(0).max(100).optional(),
});

export interface CalculateVerificationConfidenceResult {
  confidence: number;
  status: VerificationStatus;
}

const parameters: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    goalId: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      description: "Optional goal to associate the calculation with (for the audit log).",
    },
    plausibility: {
      type: "string",
      enum: [...Object.values(SignalLevel)],
      description: "How plausible the claimed progress is.",
    },
    evidenceQuality: {
      type: "string",
      enum: [...Object.values(SignalLevel)],
      description: "Strength of the supporting evidence. VERIFIED is impossible when this is LOW.",
    },
    consistency: {
      type: "string",
      enum: [...Object.values(SignalLevel)],
      description: "Agreement with prior check-ins and measurements.",
    },
    threshold: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      description: "Confidence bar to clear. Defaults to 70.",
    },
  },
  required: ["plausibility", "evidenceQuality", "consistency"],
};

export const calculateVerificationConfidenceTool: ToolDefinition<
  typeof input,
  CalculateVerificationConfidenceResult
> = {
  name: "calculateVerificationConfidence",
  description:
    "Combine plausibility, evidence quality, and consistency into a 0–100 confidence and a " +
    "status. Advisory scoring — it does not record a verification. A LOW evidence quality can " +
    "never produce VERIFIED.",
  input,
  parameters,
  async handler(args, ctx) {
    const result = calculateVerificationConfidence(
      {
        plausibility: args.plausibility,
        evidenceQuality: args.evidenceQuality,
        consistency: args.consistency,
      },
      args.threshold,
    );

    if (args.goalId !== undefined) {
      await logDecision(ctx.walletAddress, {
        toolName: "calculateVerificationConfidence",
        action: "confidence.calculate",
        decision: `Confidence ${result.confidence}/100 → ${result.status}.`,
        goalId: args.goalId,
        confidence: result.confidence,
        modelVersion: ctx.modelVersion,
      });
    }

    return result;
  },
};
