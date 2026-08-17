import type { z } from "zod";

/**
 * Tool context — everything a tool handler is permitted to know.
 *
 * Deliberately tiny: the authenticated wallet (every DB write is scoped to it)
 * and the model version (recorded in the decision log). Per CLAUDE.md rule 3
 * there is NO private key, signer, or fund-moving capability here. A tool may
 * read and write the off-chain database and propose on-chain-relevant state, but
 * it cannot move value — the smart contract enforces, the AI only proposes.
 */
export interface ToolContext {
  readonly walletAddress: string;
  readonly modelVersion: string;
}

/**
 * A tool the model may call.
 *
 * - `input` validates the model-supplied arguments (untrusted — build-prompt §7)
 *   before the handler runs.
 * - `parameters` is the JSON Schema advertised to the model (what it fills in).
 * - `handler` runs only after `input` parses successfully.
 *
 * `handler` uses method syntax on purpose: TypeScript checks method parameters
 * bivariantly, so a concrete `ToolDefinition<typeof createGoalInput, …>` stays
 * assignable to `AnyToolDefinition` when stored in the registry.
 */
export interface ToolDefinition<Schema extends z.ZodTypeAny, Output> {
  readonly name: string;
  readonly description: string;
  readonly input: Schema;
  readonly parameters: Record<string, unknown>;
  handler(args: z.output<Schema>, ctx: ToolContext): Promise<Output>;
}

/** A tool definition with its specific types erased, for the registry. */
export type AnyToolDefinition = ToolDefinition<z.ZodTypeAny, unknown>;
