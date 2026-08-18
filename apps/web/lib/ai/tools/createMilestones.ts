import { createMilestones as createMilestonesRows, logDecision } from "@/lib/db";
import { createMilestonesInput } from "@/lib/db/schemas";
import type { ToolDefinition } from "./types";

/**
 * `createMilestones` — add checkpoints to a goal the user owns.
 *
 * `createMilestonesRows` verifies goal ownership (throws `WalletScopeError` on a
 * cross-wallet attempt) and returns the goal's full milestone list in display
 * order. Adding milestones is a material change, so it's audit-logged with the
 * number added. No funds, no key (rule 3).
 */

export interface CreateMilestonesResult {
  goalId: string;
  milestones: Array<{
    id: string;
    title: string;
    orderIndex: number;
    done: boolean;
    dueDate: string | null;
  }>;
}

const parameters: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    goalId: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      description: "Goal to add milestones to.",
    },
    milestones: {
      type: "array",
      minItems: 1,
      maxItems: 50,
      description: "Ordered checkpoints toward the goal.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: {
            type: "string",
            minLength: 1,
            maxLength: 200,
            description: "What this checkpoint is.",
          },
          dueDate: {
            type: "string",
            format: "date-time",
            description: "Optional ISO 8601 due date.",
          },
          orderIndex: {
            type: "integer",
            minimum: 0,
            maximum: 10000,
            description: "Optional explicit ordering; defaults to array order.",
          },
        },
        required: ["title"],
      },
    },
  },
  required: ["goalId", "milestones"],
};

export const createMilestonesTool: ToolDefinition<
  typeof createMilestonesInput,
  CreateMilestonesResult
> = {
  name: "createMilestones",
  description:
    "Break a goal into ordered milestones once the user has agreed to a plan. Each milestone " +
    "is a concrete checkpoint. Do not use this to record progress — only to lay out the plan.",
  input: createMilestonesInput,
  parameters,
  async handler(args, ctx) {
    const milestones = await createMilestonesRows(ctx.walletAddress, args);

    await logDecision(ctx.walletAddress, {
      toolName: "createMilestones",
      action: "milestones.create",
      decision: `Added ${args.milestones.length} milestone(s) to the goal.`,
      goalId: args.goalId,
      modelVersion: ctx.modelVersion,
    });

    return {
      goalId: args.goalId,
      milestones: milestones.map((m) => ({
        id: m.id,
        title: m.title,
        orderIndex: m.orderIndex,
        done: m.done,
        dueDate: m.dueDate ? m.dueDate.toISOString() : null,
      })),
    };
  },
};
