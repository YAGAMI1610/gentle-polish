import { logDecision, setGoalProgress, setMilestoneDone, WalletScopeError } from "@/lib/db";
import { updateProgressInput } from "@/lib/db/schemas";
import type { ToolDefinition } from "./types";

/**
 * `updateProgress` — record real progress: a new goal percentage and/or a
 * milestone's done state.
 *
 * This records self-reported progress; it does NOT mark anything verified — that
 * only happens through the reality-check engine (`analyzeEvidence`/`runRealityCheck`).
 * Each write is wallet-scoped and returns a row count; a zero count (not owned /
 * not found) fails closed as a `WalletScopeError`. Audit-logged. No funds, no key.
 */

export interface UpdateProgressResult {
  goalId: string;
  updated: string[];
}

const parameters: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    goalId: { type: "string", minLength: 1, maxLength: 64, description: "Goal to update." },
    progress: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      description: "New overall progress percentage (0–100).",
    },
    milestoneId: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      description: "Milestone to mark; required if setting milestoneDone.",
    },
    milestoneDone: {
      type: "boolean",
      description:
        "Whether the referenced milestone is done. Defaults to true when a milestoneId is given.",
    },
  },
  required: ["goalId"],
};

export const updateProgressTool: ToolDefinition<typeof updateProgressInput, UpdateProgressResult> =
  {
    name: "updateProgress",
    description:
      "Record self-reported progress on a goal: set an overall percentage and/or mark a milestone " +
      "done. This is NOT verification — it does not confirm the claim, only logs the reported " +
      "progress. Provide progress, a milestoneId, or both.",
    input: updateProgressInput,
    parameters,
    async handler(args, ctx) {
      const updated: string[] = [];

      if (args.progress !== undefined) {
        const count = await setGoalProgress(ctx.walletAddress, args.goalId, args.progress);
        if (count === 0) {
          throw new WalletScopeError("goal not found for this wallet");
        }
        updated.push(`progress ${args.progress}%`);
      }

      if (args.milestoneId !== undefined) {
        const done = args.milestoneDone ?? true;
        const count = await setMilestoneDone(
          ctx.walletAddress,
          args.goalId,
          args.milestoneId,
          done,
        );
        if (count === 0) {
          throw new WalletScopeError("milestone not found for this goal");
        }
        updated.push(`milestone ${args.milestoneId} ${done ? "done" : "reopened"}`);
      }

      await logDecision(ctx.walletAddress, {
        toolName: "updateProgress",
        action: "progress.update",
        decision: `Recorded ${updated.join(", ")}.`,
        goalId: args.goalId,
        ...(args.milestoneId !== undefined ? { milestoneId: args.milestoneId } : {}),
        modelVersion: ctx.modelVersion,
      });

      return { goalId: args.goalId, updated };
    },
  };
