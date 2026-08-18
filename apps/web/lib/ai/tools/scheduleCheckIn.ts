import { CheckInFrequency } from "@prisma/client";
import { logDecision, scheduleCheckIn as scheduleCheckInRow, WalletScopeError } from "@/lib/db";
import { scheduleCheckInInput } from "@/lib/db/schemas";
import type { ToolDefinition } from "./types";

/**
 * `scheduleCheckIn` — set when the user should next check in on a goal.
 *
 * Wallet-scoped: `scheduleCheckInRow` updates zero rows for a goal the caller
 * doesn't own, which we surface as a `WalletScopeError` (fails closed rather than
 * pretending to have scheduled something). Audit-logged. No funds, no key.
 */

export interface ScheduleCheckInResult {
  goalId: string;
  nextCheckIn: string;
  cadence: CheckInFrequency | null;
}

const parameters: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    goalId: { type: "string", minLength: 1, maxLength: 64, description: "Goal to schedule for." },
    nextCheckIn: {
      type: "string",
      format: "date-time",
      description: "ISO 8601 timestamp for the next check-in.",
    },
    cadence: {
      type: "string",
      enum: [...Object.values(CheckInFrequency)],
      description: "Optional: also update the recurring cadence.",
    },
  },
  required: ["goalId", "nextCheckIn"],
};

export const scheduleCheckInTool: ToolDefinition<
  typeof scheduleCheckInInput,
  ScheduleCheckInResult
> = {
  name: "scheduleCheckIn",
  description:
    "Set the next check-in time for a goal (and optionally its recurring cadence). Use when " +
    "the user agrees on when they'll next report progress.",
  input: scheduleCheckInInput,
  parameters,
  async handler(args, ctx) {
    const count = await scheduleCheckInRow(
      ctx.walletAddress,
      args.goalId,
      args.nextCheckIn,
      args.cadence,
    );
    if (count === 0) {
      throw new WalletScopeError("goal not found for this wallet");
    }

    await logDecision(ctx.walletAddress, {
      toolName: "scheduleCheckIn",
      action: "checkin.schedule",
      decision:
        `Next check-in set to ${args.nextCheckIn.toISOString()}` +
        (args.cadence ? ` (cadence ${args.cadence}).` : "."),
      goalId: args.goalId,
      modelVersion: ctx.modelVersion,
    });

    return {
      goalId: args.goalId,
      nextCheckIn: args.nextCheckIn.toISOString(),
      cadence: args.cadence ?? null,
    };
  },
};
