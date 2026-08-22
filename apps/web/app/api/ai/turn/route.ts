import { NextResponse } from "next/server";
import { z } from "zod";
import { toHttpError, ServiceUnavailableError } from "@/lib/auth/errors";
import { assertSameOrigin } from "@/lib/auth/origin";
import { requireWallet } from "@/lib/auth/session";
import { readJsonBody } from "@/lib/api/http";
import { runTurn } from "@/lib/ai/runner";
import { providerFromEnv } from "@/lib/ai/factory";
import { aiConfigured, missingAiApiKeyEnvVar } from "@/lib/ai/probe";
import type { AIMessage, AIProvider } from "@/lib/ai/provider";
import type { AiTurnResponse } from "@/lib/api/dto";

/**
 * POST /api/ai/turn — one turn of the real model conversation (build step 9,
 * phase 3). Powers the `/create` and `/check-in` flows: the runner drives the
 * 19-tool agentic loop scoped to the authenticated wallet.
 *
 * The concrete provider is whichever one `AI_PROVIDER` selects (Gemini by default,
 * Groq optionally) — this route only ever sees the `AIProvider` interface.
 *
 * CLAUDE.md rule 1 (no fakes): if the selected provider is not configured we return
 * an honest 503 naming the key that is actually missing — or the bad `AI_PROVIDER`
 * value, if that is the problem — never a canned reply.
 * Rule 5 (untrusted input): the user's message is passed as *intent* to `runTurn`,
 * which wraps it behind the immutable trust boundary in `promptGuards` —
 * evidence/goal data can never become instructions.
 * Rule 3: the runner holds no signer; tools only ever return prepare-only calldata.
 */
export const dynamic = "force-dynamic";

// Validate any client-supplied transcript so a caller can't inject an arbitrary
// tool_result shape. Mirrors the `AIMessage` union in `lib/ai/provider.ts`.
const aiToolCallSchema = z.object({
  name: z.string().min(1).max(64),
  args: z.record(z.unknown()),
});
const aiMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user_text"), text: z.string() }),
  z.object({ kind: z.literal("model_text"), text: z.string() }),
  z.object({ kind: z.literal("model_tool_calls"), toolCalls: z.array(aiToolCallSchema) }),
  z.object({ kind: z.literal("tool_result"), name: z.string(), response: z.unknown() }),
]);
const bodySchema = z.object({
  userMessage: z.string().trim().min(1).max(10000),
  history: z.array(aiMessageSchema).max(200).optional(),
  toolPolicy: z.string().max(4000).optional(),
});

/**
 * Resolve the selected provider, or fail with a 503 whose message names the fix.
 *
 * Both failure modes here are operator configuration rather than caller error: no API
 * key for the selected provider, or an `AI_PROVIDER` that is not a provider at all
 * (a typo like "grok"). The factory throws a plain `Error` for the second, which
 * `toHttpError` would flatten into a detail-free 500 — telling whoever is setting the
 * environment up precisely nothing. Both become an honest 503 instead (rule 1).
 *
 * The message is a REASON FRAGMENT ("no GROQ_API_KEY (see …)"), because `/create` and
 * `/check-in` compose it into their own sentence; keep it readable in both places.
 */
function resolveProvider(): AIProvider {
  try {
    if (!aiConfigured()) {
      throw new ServiceUnavailableError(
        `no ${missingAiApiKeyEnvVar()} (see LIMITATIONS.md step 3)`,
      );
    }
    return providerFromEnv();
  } catch (err) {
    if (err instanceof ServiceUnavailableError) throw err;
    throw new ServiceUnavailableError(
      err instanceof Error ? err.message : "the AI provider is misconfigured",
    );
  }
}

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const wallet = await requireWallet();
    const provider = resolveProvider();

    const parsed = bodySchema.parse(await readJsonBody(req));
    const result = await runTurn({
      provider,
      walletAddress: wallet,
      userMessage: parsed.userMessage,
      // Boundary cast: the zod schema above validated the shape; `response: unknown`
      // in the schema widens to an optional key, so cast to the exact union type.
      ...(parsed.history !== undefined ? { history: parsed.history as AIMessage[] } : {}),
      ...(parsed.toolPolicy !== undefined ? { toolPolicy: parsed.toolPolicy } : {}),
    });

    const body: AiTurnResponse = {
      text: result.text,
      messages: result.messages,
      rounds: result.rounds,
    };
    return NextResponse.json(body);
  } catch (err) {
    const { status, body } = toHttpError(err, "api/ai/turn");
    return NextResponse.json(body, { status });
  }
}
