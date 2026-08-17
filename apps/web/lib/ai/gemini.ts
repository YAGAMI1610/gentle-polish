import { GoogleGenAI } from "@google/genai";
import type { Content, FunctionDeclaration, GenerateContentConfig } from "@google/genai";
import type { AIMessage, AIProvider, GenerateRequest, GenerateResult, ToolSpec } from "./provider";

/**
 * The one and only file that imports the vendor SDK (`@google/genai`).
 *
 * Everything else in the app depends on the `AIProvider` interface in
 * `provider.ts`; swapping model vendors means writing a new file like this one
 * and changing nothing else. This is the boundary build-prompt §1 asks for.
 *
 * The build spec literally pins `@google/generative-ai`, but that package is the
 * frozen legacy SDK; `@google/genai` is its current, supported replacement and
 * §1 explicitly says to "confirm the current free-tier model name at build
 * time". The deviation is deliberate, sits entirely behind this boundary, and is
 * recorded in LIMITATIONS.md.
 *
 * Per CLAUDE.md rule 3 this provider holds only the model API key (needed to
 * call Gemini) — never a wallet or deployer key — and has no code path that can
 * move funds. It generates text and *proposes* tool calls; the contract enforces.
 */

/**
 * Default free-tier Flash model. Agentic / function-calling capable. Overridable
 * with `GEMINI_MODEL` (e.g. the auto-updating `gemini-flash-latest` alias). The
 * exact id is confirmed at build time per §1 and recorded in `.env.example`.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.7-flash";

export class GeminiProvider implements AIProvider {
  constructor(
    private readonly client: GoogleGenAI,
    readonly modelVersion: string,
  ) {}

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const contents = request.messages.map(toContent);

    // Built with only the properties we actually set — `exactOptionalPropertyTypes`
    // forbids assigning an explicit `undefined` to an optional field.
    const config: GenerateContentConfig = { systemInstruction: request.system };
    if (request.tools && request.tools.length > 0) {
      config.tools = [{ functionDeclarations: request.tools.map(toFunctionDeclaration) }];
    }
    if (request.signal) {
      config.abortSignal = request.signal;
    }

    const response = await this.client.models.generateContent({
      model: this.modelVersion,
      contents,
      config,
    });

    const text = response.text;
    const calls = response.functionCalls ?? [];
    return {
      text: text != null && text.length > 0 ? text : null,
      toolCalls: calls.map((call) => ({ name: call.name ?? "", args: call.args ?? {} })),
    };
  }
}

/**
 * Construct a provider from the environment. Throws (rather than making a keyless
 * call that would fail opaquely) when `GEMINI_API_KEY` is missing — callers gate
 * on `geminiConfigured()` first.
 */
export function geminiFromEnv(): GeminiProvider {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error(
      "GEMINI_API_KEY is not set — see apps/web/.env.example. " +
        "The provider makes no network call without a key.",
    );
  }
  const model = process.env["GEMINI_MODEL"]?.trim() || DEFAULT_GEMINI_MODEL;
  return new GeminiProvider(new GoogleGenAI({ apiKey }), model);
}

/** Map one neutral `AIMessage` onto exactly one Gemini `Content`. */
function toContent(message: AIMessage): Content {
  switch (message.kind) {
    case "user_text":
      return { role: "user", parts: [{ text: message.text }] };
    case "model_text":
      return { role: "model", parts: [{ text: message.text }] };
    case "model_tool_calls":
      return {
        role: "model",
        parts: message.toolCalls.map((call) => ({
          functionCall: { name: call.name, args: call.args },
        })),
      };
    case "tool_result":
      // Gemini expects function responses back under the "user" role.
      return {
        role: "user",
        parts: [{ functionResponse: { name: message.name, response: asRecord(message.response) } }],
      };
    default: {
      // Exhaustiveness: if a new AIMessage kind is added this stops compiling.
      const unreachable: never = message;
      return unreachable;
    }
  }
}

/** A Gemini functionResponse must be a JSON object; wrap non-objects under `output`. */
function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { output: value };
}

/** Advertise a tool to the model using its hand-authored JSON Schema directly. */
function toFunctionDeclaration(spec: ToolSpec): FunctionDeclaration {
  return {
    name: spec.name,
    description: spec.description,
    parametersJsonSchema: spec.parameters,
  };
}
