import { z } from "zod";
import { getGoal, logDecision, WalletScopeError } from "@/lib/db";
import { buildStrategy } from "@/lib/ai/verification";
import type { ToolDefinition } from "./types";

/**
 * `generateVerificationQuestions` — produce category-appropriate scaffold
 * questions for verifying a goal (§6.2).
 *
 * The questions come deterministically from the strategy engine's per-category
 * seed set; the conversational model personalises them for the specific goal. The
 * questions are designed to surface genuine familiarity (e.g. content recall,
 * implementation detail), not to trap the user. Read of the goal is wallet-scoped;
 * the audit entry records the generation. No funds, no key.
 */

const input = z.object({
  goalId: z.string().trim().min(1).max(64),
});

export interface GenerateVerificationQuestionsResult {
  goalId: string;
  category: string;
  questions: string[];
}

const parameters: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    goalId: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      description: "Goal to generate verification questions for.",
    },
  },
  required: ["goalId"],
};

export const generateVerificationQuestionsTool: ToolDefinition<
  typeof input,
  GenerateVerificationQuestionsResult
> = {
  name: "generateVerificationQuestions",
  description:
    "Generate verification questions appropriate to a goal's category (e.g. content-recall for " +
    "reading, implementation detail for coding). Use these as a starting point and adapt them to " +
    "the specific goal before asking the user.",
  input,
  parameters,
  async handler(args, ctx) {
    const goal = await getGoal(ctx.walletAddress, args.goalId);
    if (!goal) {
      throw new WalletScopeError("goal not found for this wallet");
    }

    const strategy = buildStrategy(goal.id, goal.category, `${goal.title} ${goal.summary}`);

    await logDecision(ctx.walletAddress, {
      toolName: "generateVerificationQuestions",
      action: "questions.generate",
      decision: `Generated ${strategy.verificationQuestions.length} verification question(s) for category ${goal.category}.`,
      goalId: goal.id,
      modelVersion: ctx.modelVersion,
    });

    return {
      goalId: goal.id,
      category: goal.category,
      questions: strategy.verificationQuestions,
    };
  },
};
