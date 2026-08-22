import type { AIMessage, AIProvider, GenerateRequest, GenerateResult, ToolSpec } from "./provider";

/**
 * Groq provider — the second concrete `AIProvider`, speaking Groq's
 * OpenAI-compatible chat completions API over plain `fetch`.
 *
 * By design there is no vendor SDK here (the repo has no OpenAI dependency, and
 * Node's global `fetch` is all the transport this needs). The vendor-specific
 * shape lives entirely in this file, mirroring `gemini.ts`'s role: everything
 * above `lib/ai` talks to the `AIProvider` interface in `provider.ts` and never
 * sees Groq's wire format. This is the "behind the `AIProvider` interface"
 * boundary build-prompt §1 requires — the privacyBoundary egress guard pins the
 * single Groq endpoint literal below to exactly this file.
 *
 * Per CLAUDE.md rule 3 this provider holds only the model API key (needed to
 * call Groq) — never a wallet or deployer key — and has no code path that can
 * move funds. It generates text and *proposes* tool calls; the contract enforces.
 */

/**
 * Default Groq model: production-tier and tool-use capable, which the 19-tool loop
 * in `runner.ts` requires. Overridable with `GROQ_MODEL`, recorded in `.env.example`.
 *
 * Groq retires model ids on a published schedule
 * (https://console.groq.com/docs/deprecations). `llama-3.3-70b-versatile` was this
 * default until 2026-08-21 and was shut down on 2026-08-16; this is Groq's own
 * recommended replacement for it. A retired id fails loudly — the non-2xx path below
 * surfaces Groq's "decommissioned" message verbatim — so a stale default can never
 * degrade into a fake answer, only into an honest error naming the fix.
 */
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

/** The single endpoint any Groq request is sent to. Pinned by the privacy
 * boundary's egress source guard — no other non-test file may name this host. */
export const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Minimal structural shape of the injected transport (the connectors DI idiom,
 * same as `lib/storage/s3/s3Storage.ts`). `text()` rather than `json()` so a
 * non-2xx body can go verbatim into the error message. */
export interface GroqHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}
export type GroqFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<GroqHttpResponse>;

const defaultFetch = fetch as unknown as GroqFetch;

/** Prefix for the synthesised `tool_call_id`s described on `toChatCompletionBody`. */
const ID_PREFIX = "call_";

export class GroqProvider implements AIProvider {
  constructor(
    private readonly apiKey: string,
    readonly modelVersion: string,
    private readonly fetchFn: GroqFetch = defaultFetch,
  ) {}

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const body = toChatCompletionBody(request, this.modelVersion);
    const response = await this.fetchFn(GROQ_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      // Spread, not `signal: request.signal`, so we never pass an explicit
      // undefined under exactOptionalPropertyTypes.
      ...(request.signal ? { signal: request.signal } : {}),
    });

    const raw = await response.text();
    if (!response.ok) {
      // The key never rides inside an error message (it is sent as a header
      // only); a truncated provider message is enough to diagnose.
      throw new Error(`Groq API error ${response.status}: ${truncate(raw, 500)}`);
    }

    return parseChatCompletion(raw);
  }
}

/**
 * Construct a provider from the environment. Throws (rather than making a keyless
 * call that would fail opaquely) when `GROQ_API_KEY` is missing — callers gate on
 * `groqConfigured()` / `aiConfigured()` first.
 */
export function groqFromEnv(): GroqProvider {
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error(
      "GROQ_API_KEY is not set — see apps/web/.env.example. " +
        "The provider makes no network call without a key.",
    );
  }
  const model = process.env["GROQ_MODEL"]?.trim() || DEFAULT_GROQ_MODEL;
  return new GroqProvider(apiKey, model);
}

/**
 * Assemble the complete chat-completions request body from the neutral request.
 *
 * The body carries ONLY the model id, the mapped transcript, and the advertised
 * tool schemas — there is no field a raw upload could ride in, which the privacy
 * boundary asserts against this function's real output.
 *
 * The one OpenAI/Groq mismatch with the neutral transcript: Gemini correlates a
 * function response to its call by NAME, Groq by `tool_call_id`. `AIMessage`
 * carries no id, so ids are assigned deterministically here — call `j` of the
 * tool-calls message at transcript index `i` is `call_<i>_<j>` — and each tool
 * result claims the first still-unmatched call with the same name. That stays
 * correct for several calls in one turn, including two calls of the same tool.
 */
function toChatCompletionBody(request: GenerateRequest, model: string): Record<string, unknown> {
  const messages: Record<string, unknown>[] = [
    // The trusted, author-controlled system instruction becomes a leading system
    // message (OpenAI's shape has no separate systemInstruction field).
    { role: "system", content: request.system },
  ];
  const pending: { id: string; name: string }[] = [];

  for (const [index, message] of request.messages.entries()) {
    messages.push(...toChatMessages(message, index, pending));
  }

  const body: Record<string, unknown> = { model, messages };
  if (request.tools && request.tools.length > 0) {
    // `tool_choice` is left unset: Groq's default already lets the model choose,
    // and every knob we do not send is one less thing to keep in sync.
    body["tools"] = request.tools.map(toFunctionTool);
  }
  return body;
}

/**
 * Map one neutral `AIMessage` onto the chat messages it becomes. `pending` is
 * threaded through so a `tool_result` can find the id of the call it answers; it
 * is mutated deliberately (ids are consumed as they are matched).
 */
function toChatMessages(
  message: AIMessage,
  index: number,
  pending: { id: string; name: string }[],
): Record<string, unknown>[] {
  switch (message.kind) {
    case "user_text":
      return [{ role: "user", content: message.text }];
    case "model_text":
      return [{ role: "assistant", content: message.text }];
    case "model_tool_calls": {
      const withIds = message.toolCalls.map((call, position) => ({
        id: `${ID_PREFIX}${index}_${position}`,
        name: call.name,
        args: call.args,
      }));
      pending.push(...withIds.map(({ id, name }) => ({ id, name })));
      return [
        {
          role: "assistant",
          content: null,
          tool_calls: withIds.map(({ id, name, args }) => ({
            id,
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          })),
        },
      ];
    }
    case "tool_result": {
      const matchIndex = pending.findIndex((call) => call.name === message.name);
      const match = matchIndex === -1 ? undefined : pending[matchIndex];
      if (match === undefined) {
        // Reachable only from a hand-crafted `history` in the API body. Failing
        // loud beats sending a fabricated id and collecting an opaque 400.
        throw new Error(
          `Groq provider: tool_result for "${message.name}" has no preceding tool_call ` +
            "in the transcript — refusing to fabricate a tool_call_id.",
        );
      }
      pending.splice(matchIndex, 1);
      return [
        {
          role: "tool",
          tool_call_id: match.id,
          content: JSON.stringify(message.response),
        },
      ];
    }
    default: {
      // Exhaustiveness: if a new AIMessage kind is added this stops compiling.
      const unreachable: never = message;
      return unreachable;
    }
  }
}

/** Advertise a tool to the model using its hand-authored JSON Schema directly. */
function toFunctionTool(spec: ToolSpec): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
    },
  };
}

interface GroqToolCall {
  id: string;
  function: { name: string; arguments: string };
}
interface GroqChoice {
  message?: { content?: string | null; tool_calls?: GroqToolCall[] };
}

/** Map a 200 response body onto the neutral `GenerateResult`. */
function parseChatCompletion(raw: string): GenerateResult {
  const parsed = JSON.parse(raw) as { choices?: GroqChoice[] };
  const choice = parsed.choices?.[0];
  const content = choice?.message?.content;
  const calls = choice?.message?.tool_calls ?? [];

  return {
    text: content != null && content.length > 0 ? content : null,
    toolCalls: calls.map((call) => ({
      name: call.function.name,
      args: parseToolArguments(call.function.name, call.function.arguments),
    })),
  };
}

/**
 * Parse a tool call's `arguments` string. Never falls back to a silent `{}`: the
 * registry would then run the tool on fabricated defaults, which is exactly the
 * kind of quiet wrongness CLAUDE.md rule 1 forbids.
 */
function parseToolArguments(toolName: string, raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Groq returned malformed arguments for tool "${toolName}": ${truncate(raw, 200)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Groq returned non-object arguments for tool "${toolName}": ${truncate(raw, 200)}`,
    );
  }
  return parsed as Record<string, unknown>;
}

/** Keep provider error text bounded — response bodies can be large. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… (truncated)`;
}
