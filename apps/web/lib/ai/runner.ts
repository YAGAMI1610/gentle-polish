import { buildSystemInstruction } from "./promptGuards";
import type { AIMessage, AIProvider } from "./provider";
import { dispatchToolCall, toolSpecs } from "./tools/registry";
import type { ToolContext } from "./tools/types";

/**
 * The agentic loop that ties the provider, the prompt guards, and the tools
 * together — the "one working tool end-to-end" of build step 4.
 *
 * Each round: ask the provider to generate with the trust-boundary SYSTEM prompt
 * and the advertised tools. If it returns no tool calls, that text is the answer.
 * Otherwise dispatch every proposed call (each re-validated in the registry),
 * append the results, and loop. A bounded `maxToolRounds` stops runaway loops; if
 * the budget is exhausted we make one final tool-less call to get a text answer.
 *
 * The provider only ever proposes tool calls and the registry decides whether to
 * run them (CLAUDE.md rule 3) — nothing here can move funds.
 */

export interface RunTurnOptions {
  provider: AIProvider;
  /** Authenticated wallet — every tool write is scoped to it. */
  walletAddress: string;
  /** The user's message for this turn (trusted as *intent*, not as instructions). */
  userMessage: string;
  /** Prior conversation turns, if continuing a session. */
  history?: AIMessage[];
  /** Optional task-specific guidance appended after the immutable trust boundary. */
  toolPolicy?: string;
  signal?: AbortSignal;
  /** Max generate→tool rounds before forcing a final answer (default 4). */
  maxToolRounds?: number;
}

export interface RunTurnResult {
  /** The model's final natural-language answer (null if it produced none). */
  text: string | null;
  /** The full message transcript for this turn, ready to persist or continue. */
  messages: AIMessage[];
  /** How many generate rounds ran. */
  rounds: number;
}

export async function runTurn(options: RunTurnOptions): Promise<RunTurnResult> {
  const { provider, walletAddress, userMessage } = options;
  const maxRounds = options.maxToolRounds ?? 4;
  const ctx: ToolContext = { walletAddress, modelVersion: provider.modelVersion };
  const system = buildSystemInstruction(options.toolPolicy);
  const specs = toolSpecs();

  const messages: AIMessage[] = [
    ...(options.history ?? []),
    { kind: "user_text", text: userMessage },
  ];

  let rounds = 0;
  while (rounds < maxRounds) {
    rounds += 1;
    const result = await provider.generate({
      system,
      messages,
      tools: specs,
      // Spread, not `signal: options.signal`, so we never pass an explicit
      // undefined under exactOptionalPropertyTypes.
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (result.toolCalls.length === 0) {
      if (result.text !== null) {
        messages.push({ kind: "model_text", text: result.text });
      }
      return { text: result.text, messages, rounds };
    }

    messages.push({ kind: "model_tool_calls", toolCalls: result.toolCalls });
    for (const call of result.toolCalls) {
      const dispatch = await dispatchToolCall(call, ctx);
      messages.push({
        kind: "tool_result",
        name: dispatch.name,
        response: dispatch.ok
          ? { ok: true, data: dispatch.data }
          : { ok: false, error: dispatch.error },
      });
    }
  }

  // Rounds exhausted: one final tool-less call so the user still gets an answer.
  const final = await provider.generate({
    system,
    messages,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (final.text !== null) {
    messages.push({ kind: "model_text", text: final.text });
  }
  return { text: final.text, messages, rounds };
}
