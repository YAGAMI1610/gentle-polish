import { CheckInFrequency } from "@prisma/client";
import { z } from "zod";
import { getGoal, logDecision, upsertVerificationStrategy, WalletScopeError } from "@/lib/db";
import type { CreateVerificationStrategyInput } from "@/lib/db/schemas";
import { buildStrategy } from "@/lib/ai/verification";
import type { ToolDefinition } from "./types";

/**
 * `createVerificationStrategy` — set HOW a goal will be verified (§6.1).
 *
 * The strategy engine supplies category-appropriate defaults (which always
 * combine ≥2 independent signals); the model may override any field. Anything the
 * model omits falls back to the engine default, so a strategy is never left
 * half-specified. Persisted via `upsertVerificationStrategy` (goal-ownership
 * enforced), then audit-logged. No funds, no key.
 */

const input = z.object({
  goalId: z.string().trim().min(1).max(64),
  measurement: z.string().trim().min(1).max(2000).optional(),
  methods: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  requiredEvidence: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  frequency: z.nativeEnum(CheckInFrequency).optional(),
  confidenceThreshold: z.number().int().min(0).max(100).optional(),
  fallbackPlan: z.string().trim().max(2000).optional(),
  rationale: z.string().trim().max(2000).optional(),
});

export interface CreateVerificationStrategyResult {
  goalId: string;
  measurement: string;
  methods: string[];
  requiredEvidence: string[];
  frequency: CheckInFrequency;
  confidenceThreshold: number;
}

const parameters: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    goalId: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      description: "Goal to set a strategy for.",
    },
    measurement: {
      type: "string",
      maxLength: 2000,
      description: "What concretely gets measured. Omit to use the category default.",
    },
    methods: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 100 },
      description: "Signals combined to verify (≥2). Omit to use the category default.",
    },
    requiredEvidence: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 100 },
      description: "Evidence types to request. Omit to use the category default.",
    },
    frequency: {
      type: "string",
      enum: [...Object.values(CheckInFrequency)],
      description: "How often to check in. Omit to use the category default.",
    },
    confidenceThreshold: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      description: "Confidence bar a verification must clear. Omit to use the default (70).",
    },
    fallbackPlan: {
      type: "string",
      maxLength: 2000,
      description: "What to do if primary evidence is unavailable.",
    },
    rationale: { type: "string", maxLength: 2000, description: "Why this strategy fits the goal." },
  },
  required: ["goalId"],
};

export const createVerificationStrategyTool: ToolDefinition<
  typeof input,
  CreateVerificationStrategyResult
> = {
  name: "createVerificationStrategy",
  description:
    "Define how a goal will be verified — what to measure, which evidence to require, how often, " +
    "and the confidence bar. Category-appropriate defaults are filled in for anything you omit. " +
    "Set this after the user agrees on the goal, before asking for evidence.",
  input,
  parameters,
  async handler(args, ctx) {
    const goal = await getGoal(ctx.walletAddress, args.goalId);
    if (!goal) {
      throw new WalletScopeError("goal not found for this wallet");
    }

    const defaults = buildStrategy(goal.id, goal.category, `${goal.title} ${goal.summary}`);

    const merged: CreateVerificationStrategyInput = {
      goalId: goal.id,
      measurement: args.measurement ?? defaults.measurement,
      methods: args.methods && args.methods.length > 0 ? args.methods : defaults.methods,
      requiredEvidence:
        args.requiredEvidence && args.requiredEvidence.length > 0
          ? args.requiredEvidence
          : defaults.requiredEvidence,
      frequency: args.frequency ?? defaults.frequency,
      confidenceThreshold: args.confidenceThreshold ?? defaults.confidenceThreshold,
      fallbackPlan: args.fallbackPlan ?? defaults.fallback,
    };
    if (args.rationale !== undefined) {
      merged.rationale = args.rationale;
    }

    const strategy = await upsertVerificationStrategy(ctx.walletAddress, merged);

    await logDecision(ctx.walletAddress, {
      toolName: "createVerificationStrategy",
      action: "strategy.upsert",
      decision:
        `Set verification strategy: ${strategy.methods.join(", ")}; ` +
        `requires ${strategy.requiredEvidence.join(", ")}; threshold ${strategy.confidenceThreshold}.`,
      goalId: goal.id,
      modelVersion: ctx.modelVersion,
    });

    return {
      goalId: goal.id,
      measurement: strategy.measurement,
      methods: strategy.methods,
      requiredEvidence: strategy.requiredEvidence,
      frequency: strategy.frequency,
      confidenceThreshold: strategy.confidenceThreshold,
    };
  },
};
