import type { AIToolCall, ToolSpec } from "../provider";
import { createGoalTool } from "./createGoal";
// Build step 5 — remaining DB/AI tools.
import { getWalletGoalsTool } from "./getWalletGoals";
import { analyzeGoalTool } from "./analyzeGoal";
import { createMilestonesTool } from "./createMilestones";
import { scheduleCheckInTool } from "./scheduleCheckIn";
import { updateProgressTool } from "./updateProgress";
import { createVerificationStrategyTool } from "./createVerificationStrategy";
import { requestEvidenceTool } from "./requestEvidence";
import { getCommitmentStatusTool } from "./getCommitmentStatus";
import { calculateAccountabilityScoreTool } from "./calculateAccountabilityScore";
// Build step 6 — verification engines' tools.
import { generateVerificationQuestionsTool } from "./generateVerificationQuestions";
import { evaluateAnswersTool } from "./evaluateAnswers";
import { analyzeEvidenceTool } from "./analyzeEvidence";
import { runRealityCheckTool } from "./runRealityCheck";
import { calculateVerificationConfidenceTool } from "./calculateVerificationConfidence";
// Build step 8 — chain-aware tools (contract client). Attestor calls move no funds;
// fund operations are PREPARED for the user's own wallet to sign, never broadcast here.
import { createCommitmentTool } from "./createCommitment";
import { claimRewardTool } from "./claimReward";
import { requestCompletionTool } from "./requestCompletion";
import { anchorMilestoneTool } from "./anchorMilestone";
import type { AnyToolDefinition, ToolContext } from "./types";

/**
 * The tool registry — the single list of tools the model can call, plus the
 * dispatcher that turns a model-proposed `AIToolCall` into a real handler run.
 *
 * Every call is re-validated against the tool's own Zod schema here before its
 * handler runs (build-prompt §7): a tool call is never trusted just because the
 * model produced it. Unknown tools and invalid arguments fail closed as an error
 * result rather than throwing — the runner feeds that back to the model.
 *
 * NOTE (money safety, CLAUDE.md rules 2–3): no tool can move a user's funds.
 * The chain-aware tools split cleanly in two:
 *   - `requestCompletion` / `anchorMilestone` are REAL on-chain calls the backend
 *     attestor makes, and the contract permits the attestor ONLY value-neutral
 *     actions (mark completion-requested, register a milestone) — never a transfer.
 *   - `createCommitment` / `claimReward` are PREPARE-ONLY: they return encoded
 *     calldata for the DEPOSITOR's own wallet to sign (step 9) and never broadcast.
 * The backend holds no key that can move funds; the contract enforces it. See the
 * dedicated `contractClient.safety.test.ts`.
 */

const DEFINITIONS: readonly AnyToolDefinition[] = [
  createGoalTool,
  // Step 5
  getWalletGoalsTool,
  analyzeGoalTool,
  createMilestonesTool,
  scheduleCheckInTool,
  updateProgressTool,
  createVerificationStrategyTool,
  requestEvidenceTool,
  getCommitmentStatusTool,
  calculateAccountabilityScoreTool,
  // Step 6
  generateVerificationQuestionsTool,
  evaluateAnswersTool,
  analyzeEvidenceTool,
  runRealityCheckTool,
  calculateVerificationConfidenceTool,
  // Step 8 — chain-aware (see the money-safety note above)
  requestCompletionTool,
  anchorMilestoneTool,
  createCommitmentTool,
  claimRewardTool,
];

const BY_NAME: ReadonlyMap<string, AnyToolDefinition> = new Map(
  DEFINITIONS.map((def) => [def.name, def]),
);

/** Specs advertised to the model on each generate() call. */
export function toolSpecs(): ToolSpec[] {
  return DEFINITIONS.map((def) => ({
    name: def.name,
    description: def.description,
    parameters: def.parameters,
  }));
}

/** Look up a tool definition by name (undefined if not registered). */
export function getTool(name: string): AnyToolDefinition | undefined {
  return BY_NAME.get(name);
}

/** Outcome of dispatching one tool call. Always resolved, never thrown. */
export interface DispatchResult {
  name: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Validate and run one model-proposed tool call. Fails closed: an unknown tool,
 * arguments that don't match the schema, or a handler that throws all become
 * `{ ok: false, error }` so the runner can hand the failure back to the model
 * instead of crashing the turn.
 */
export async function dispatchToolCall(
  call: AIToolCall,
  ctx: ToolContext,
): Promise<DispatchResult> {
  const def = BY_NAME.get(call.name);
  if (!def) {
    return { name: call.name, ok: false, error: `unknown tool: ${call.name}` };
  }

  const parsed = def.input.safeParse(call.args);
  if (!parsed.success) {
    return { name: call.name, ok: false, error: `invalid arguments: ${parsed.error.message}` };
  }

  try {
    const data = await def.handler(parsed.data, ctx);
    return { name: call.name, ok: true, data };
  } catch (err) {
    return { name: call.name, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
