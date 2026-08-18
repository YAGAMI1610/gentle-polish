import { GoalStatus } from "@prisma/client";
import { listGoals } from "@/lib/db";
import type { ToolDefinition } from "./types";
import { z } from "zod";

/**
 * `getWalletGoals` — read the current user's goals (optionally filtered by status).
 *
 * Read-only: it writes no rows and therefore records no decision-log entry (the
 * log is for material state changes, §4/§10). Wallet-scoped by `listGoals`, so it
 * can only ever return the caller's own goals. Returns a compact projection so the
 * model gets what it needs to reason without extra columns.
 */

const input = z.object({
  status: z.nativeEnum(GoalStatus).optional(),
});

export interface WalletGoalSummary {
  goalId: string;
  title: string;
  category: string;
  mode: string;
  status: string;
  progress: number;
}

export interface GetWalletGoalsResult {
  goals: WalletGoalSummary[];
}

const parameters: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: [...Object.values(GoalStatus)],
      description: "Optional filter: only return goals in this lifecycle status.",
    },
  },
  required: [],
};

export const getWalletGoalsTool: ToolDefinition<typeof input, GetWalletGoalsResult> = {
  name: "getWalletGoals",
  description:
    "List the current user's goals, optionally filtered by status (ACTIVE / COMPLETED / " +
    "ABANDONED). Use this to recall what the user is already working on before creating or " +
    "discussing goals. Read-only.",
  input,
  parameters,
  async handler(args, ctx) {
    const goals = await listGoals(ctx.walletAddress);
    const filtered = args.status ? goals.filter((g) => g.status === args.status) : goals;
    return {
      goals: filtered.map((g) => ({
        goalId: g.id,
        title: g.title,
        category: g.category,
        mode: g.mode,
        status: g.status,
        progress: g.progress,
      })),
    };
  },
};
