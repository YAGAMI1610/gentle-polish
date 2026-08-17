import { CheckInFrequency, GoalCategory, GoalMode } from "@prisma/client";
import { createGoal as createGoalRow, logDecision } from "@/lib/db";
import { createGoalInput } from "@/lib/db/schemas";
import type { ToolDefinition } from "./types";

/**
 * `createGoal` — the one end-to-end AI tool for build step 4.
 *
 * The model calls this once the user has actually decided on a concrete goal.
 * The flow is deliberately whole:
 *   1. `createGoalInput` re-validates the model's arguments (untrusted, §7).
 *   2. `createGoalRow` writes the goal, wallet-scoped to `ctx.walletAddress`.
 *   3. `logDecision` records an audit entry (§4/§10) — creating a goal is a
 *      material state change, so it belongs in the decision log.
 *
 * The tool takes no key and moves no funds (CLAUDE.md rule 3); it only writes
 * off-chain rows for the authenticated wallet.
 */

export interface CreateGoalResult {
  goalId: string;
  title: string;
  category: GoalCategory;
  mode: GoalMode;
  status: string;
}

/**
 * JSON Schema advertised to the model. Hand-authored (not machine-generated) so
 * the shape stays legible and stable. Only fields the AI should set at creation
 * are exposed: `status`/`progress`/`nextCheckIn` are server-controlled (a new
 * goal is ACTIVE at 0 %), which is an intentional scoping, not a silent cut —
 * `createGoalInput` still defaults them.
 */
const parameters: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: {
      type: "string",
      minLength: 1,
      maxLength: 200,
      description: "Short title for the goal, e.g. 'Run a 10k'.",
    },
    summary: {
      type: "string",
      minLength: 1,
      maxLength: 2000,
      description: "One or two sentences describing the goal in the user's own terms.",
    },
    mode: {
      type: "string",
      enum: [...Object.values(GoalMode)],
      description:
        "ACCOUNTABILITY = a third party verifies; SELF_COMMITMENT = the user holds themselves to it.",
    },
    category: {
      type: "string",
      enum: [...Object.values(GoalCategory)],
      description: "Best-fit category. Use GENERIC if none clearly applies.",
    },
    checkInFrequency: {
      type: "string",
      minLength: 1,
      maxLength: 100,
      description: "Human-readable cadence label shown in the UI, e.g. 'Every weekday'.",
    },
    checkInCadence: {
      type: "string",
      enum: [...Object.values(CheckInFrequency)],
      description: "Structured cadence used by scheduling. Defaults to WEEKLY if omitted.",
    },
    currentState: {
      type: "string",
      maxLength: 2000,
      description: "Where the user is starting from, if they said.",
    },
    desiredState: {
      type: "string",
      maxLength: 2000,
      description: "The concrete end state that counts as done.",
    },
    successMetric: {
      type: "string",
      maxLength: 2000,
      description: "How success is measured, e.g. 'GPS-tracked 10k under 60 min'.",
    },
    deadline: {
      type: "string",
      format: "date-time",
      description: "ISO 8601 deadline, if the user gave one.",
    },
  },
  required: ["title", "summary", "mode", "checkInFrequency"],
};

export const createGoalTool: ToolDefinition<typeof createGoalInput, CreateGoalResult> = {
  name: "createGoal",
  description:
    "Create a new goal for the current user once they have decided on a concrete, " +
    "specific commitment. Do not call this to brainstorm or clarify — only when the " +
    "user's own message clearly asks to commit to a defined goal.",
  input: createGoalInput,
  parameters,
  async handler(args, ctx) {
    const goal = await createGoalRow(ctx.walletAddress, args);

    await logDecision(ctx.walletAddress, {
      toolName: "createGoal",
      action: "goal.create",
      decision: `Created goal "${goal.title}" (mode ${goal.mode}, category ${goal.category}).`,
      goalId: goal.id,
      modelVersion: ctx.modelVersion,
    });

    return {
      goalId: goal.id,
      title: goal.title,
      category: goal.category,
      mode: goal.mode,
      status: goal.status,
    };
  },
};
