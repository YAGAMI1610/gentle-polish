import { SignalLevel } from "@prisma/client";
import { getGoal, logDecision, updateGoalShaping } from "@/lib/db";
import { analyzeGoalInput } from "@/lib/db/schemas";
import { WalletScopeError } from "@/lib/db";
import type { ToolDefinition } from "./types";

/**
 * `analyzeGoal` — record the AI's structured read of a goal (§5) and persist any
 * shaping slots it pinned down.
 *
 * The three coarse signals (realism / safety / verifiability) are the model's
 * judgement expressed on a fixed scale — kept coarse because the AI is not a
 * precise oracle (§6). Persisting the optional current/desired/success fields is a
 * material change, so it's audit-logged. The tool moves no funds and holds no key
 * (rule 3).
 */

export interface AnalyzeGoalResult {
  goalId: string;
  realism: SignalLevel;
  safety: SignalLevel;
  verifiability: SignalLevel;
  shapingUpdated: boolean;
}

const parameters: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    goalId: { type: "string", minLength: 1, maxLength: 64, description: "Goal being analyzed." },
    realism: {
      type: "string",
      enum: [...Object.values(SignalLevel)],
      description: "How achievable the goal looks as stated.",
    },
    safety: {
      type: "string",
      enum: [...Object.values(SignalLevel)],
      description: "HIGH = clearly safe/healthy; LOW = potentially harmful or extreme.",
    },
    verifiability: {
      type: "string",
      enum: [...Object.values(SignalLevel)],
      description: "How readily progress can be evidenced and checked.",
    },
    assessment: {
      type: "string",
      minLength: 1,
      maxLength: 5000,
      description: "Plain-language analysis to share with the user.",
    },
    currentState: {
      type: "string",
      maxLength: 2000,
      description: "Where the user is starting from.",
    },
    desiredState: {
      type: "string",
      maxLength: 2000,
      description: "The concrete end state that counts as done.",
    },
    successMetric: { type: "string", maxLength: 2000, description: "How success is measured." },
  },
  required: ["goalId", "realism", "safety", "verifiability", "assessment"],
};

export const analyzeGoalTool: ToolDefinition<typeof analyzeGoalInput, AnalyzeGoalResult> = {
  name: "analyzeGoal",
  description:
    "Record a structured analysis of a goal (realism, safety, verifiability) and optionally " +
    "save the shaped current/desired state and success metric. Call after discussing a goal " +
    "with the user, not to move money or mark anything verified.",
  input: analyzeGoalInput,
  parameters,
  async handler(args, ctx) {
    const goal = await getGoal(ctx.walletAddress, args.goalId);
    if (!goal) {
      throw new WalletScopeError("goal not found for this wallet");
    }

    const shaping: { currentState?: string; desiredState?: string; successMetric?: string } = {};
    if (args.currentState !== undefined) shaping.currentState = args.currentState;
    if (args.desiredState !== undefined) shaping.desiredState = args.desiredState;
    if (args.successMetric !== undefined) shaping.successMetric = args.successMetric;

    let shapingUpdated = false;
    if (Object.keys(shaping).length > 0) {
      const count = await updateGoalShaping(ctx.walletAddress, args.goalId, shaping);
      shapingUpdated = count > 0;
    }

    await logDecision(ctx.walletAddress, {
      toolName: "analyzeGoal",
      action: "goal.analyze",
      decision:
        `Analyzed goal: realism ${args.realism}, safety ${args.safety}, ` +
        `verifiability ${args.verifiability}. ${args.assessment}`,
      goalId: args.goalId,
      modelVersion: ctx.modelVersion,
    });

    return {
      goalId: args.goalId,
      realism: args.realism,
      safety: args.safety,
      verifiability: args.verifiability,
      shapingUpdated,
    };
  },
};
