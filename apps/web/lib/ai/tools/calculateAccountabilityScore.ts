import { z } from "zod";
import { computeAccountabilityScore, logAccountabilityScore, logDecision } from "@/lib/db";
import type { LogAccountabilityScoreInput } from "@/lib/db/schemas";
import type { ToolDefinition } from "./types";

/**
 * `calculateAccountabilityScore` — recompute and log the user's score (§10).
 *
 * The score is derived server-side from the wallet's own goals / milestones /
 * verifications / check-ins — there is no client-writable total the model could
 * inflate. The tool recomputes, appends the result (with its weighted breakdown)
 * to the audit log, and records a decision entry. No funds, no key.
 */

const input = z.object({
  reason: z.string().trim().max(2000).optional(),
});

export interface CalculateAccountabilityScoreResult {
  score: number;
  breakdown: Array<{ label: string; value: number; weight: number }>;
  computedAt: string;
}

const parameters: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    reason: {
      type: "string",
      maxLength: 2000,
      description: "Optional note for why the score is being recomputed now.",
    },
  },
  required: [],
};

export const calculateAccountabilityScoreTool: ToolDefinition<
  typeof input,
  CalculateAccountabilityScoreResult
> = {
  name: "calculateAccountabilityScore",
  description:
    "Recompute the user's accountability score from their real goal/milestone/verification " +
    "history and log it. The score is always server-computed; it cannot be set directly.",
  input,
  parameters,
  async handler(args, ctx) {
    const { score, breakdown } = await computeAccountabilityScore(ctx.walletAddress);

    const logInput: LogAccountabilityScoreInput = { score, breakdown };
    if (args.reason !== undefined) {
      logInput.reason = args.reason;
    }
    const logRow = await logAccountabilityScore(ctx.walletAddress, logInput);

    await logDecision(ctx.walletAddress, {
      toolName: "calculateAccountabilityScore",
      action: "score.calculate",
      decision: `Computed accountability score ${score}/100.`,
      confidence: score,
      modelVersion: ctx.modelVersion,
    });

    return { score, breakdown, computedAt: logRow.computedAt.toISOString() };
  },
};
