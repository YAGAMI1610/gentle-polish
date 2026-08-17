/**
 * SDK-agnostic AI provider surface.
 *
 * Everything above `lib/ai` talks to this interface, never to a vendor SDK. The
 * concrete `GeminiProvider` (`gemini.ts`) is the only file in the repo that
 * imports `@google/genai`, so swapping the model vendor never touches the tools,
 * the runner, or the prompt guards. This is the "behind the `AIProvider`
 * interface" boundary the build prompt §1 requires.
 *
 * Per CLAUDE.md rule 3 the provider only ever generates text and proposes tool
 * calls — it holds no key and has no code path that can move funds.
 */

/** A tool advertised to the model. `parameters` is a JSON Schema object. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** One tool invocation the model asked for. `args` are still untrusted here — a
 * tool re-validates them with its own Zod schema before doing anything. */
export interface AIToolCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * A single turn in the conversation, discriminated by `kind` so each maps
 * unambiguously onto one provider message (a Gemini `Content`, an OpenAI
 * message, …). Model text and model tool-calls are distinct kinds because a
 * single model turn is exactly one of the two.
 */
export type AIMessage =
  | { kind: "user_text"; text: string }
  | { kind: "model_text"; text: string }
  | { kind: "model_tool_calls"; toolCalls: AIToolCall[] }
  | { kind: "tool_result"; name: string; response: unknown };

export interface GenerateRequest {
  /** SYSTEM instructions — trusted, author-controlled (build-prompt §7). Built
   * by `promptGuards.buildSystemInstruction`, never assembled from user text. */
  system: string;
  messages: AIMessage[];
  tools?: ToolSpec[];
  /** Aborts in-flight generation (request timeouts, cancelled sessions). */
  signal?: AbortSignal;
}

export interface GenerateResult {
  /** Natural-language text, or null when the model returned only tool calls. */
  text: string | null;
  toolCalls: AIToolCall[];
}

export interface AIProvider {
  /** Concrete model id recorded in the decision log (§10), e.g.
   * `"gemini-3.7-flash"`. */
  readonly modelVersion: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}
