import { getGoal, getVerificationStrategy, logDecision, WalletScopeError } from "@/lib/db";
import { requestEvidenceInput } from "@/lib/db/schemas";
import type { ToolDefinition } from "./types";

/**
 * `requestEvidence` — ask the user for the evidence a goal's strategy calls for.
 *
 * This is the prompt half of verification; it stores nothing new beyond an audit
 * entry and never itself verifies anything (that's the reality-check engine).
 * Goal ownership is enforced via `getGoal` (fails closed), then the goal's
 * strategy — if set — tells the user exactly what to provide. No funds, no key.
 */

export interface RequestEvidenceResult {
  goalId: string;
  requiredEvidence: string[];
  hasStrategy: boolean;
  note: string | null;
}

const parameters: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    goalId: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      description: "Goal to request evidence for.",
    },
    note: {
      type: "string",
      maxLength: 2000,
      description: "Optional context for the user about what to send.",
    },
  },
  required: ["goalId"],
};

export const requestEvidenceTool: ToolDefinition<
  typeof requestEvidenceInput,
  RequestEvidenceResult
> = {
  name: "requestEvidence",
  description:
    "Ask the user to provide evidence for a goal, based on its verification strategy. Returns " +
    "the required evidence types to prompt for. Does not verify anything on its own.",
  input: requestEvidenceInput,
  parameters,
  async handler(args, ctx) {
    const goal = await getGoal(ctx.walletAddress, args.goalId);
    if (!goal) {
      throw new WalletScopeError("goal not found for this wallet");
    }

    const strategy = await getVerificationStrategy(ctx.walletAddress, args.goalId);
    const requiredEvidence = strategy?.requiredEvidence ?? [];

    await logDecision(ctx.walletAddress, {
      toolName: "requestEvidence",
      action: "evidence.request",
      decision:
        `Requested evidence: ${requiredEvidence.length ? requiredEvidence.join(", ") : "(no strategy set yet)"}` +
        (args.note ? ` — ${args.note}` : "."),
      goalId: args.goalId,
      modelVersion: ctx.modelVersion,
    });

    return {
      goalId: args.goalId,
      requiredEvidence,
      hasStrategy: strategy !== null,
      note: args.note ?? null,
    };
  },
};
