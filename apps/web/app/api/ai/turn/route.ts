import { NextResponse } from "next/server";
import { z } from "zod";
import { toHttpError, ServiceUnavailableError } from "@/lib/auth/errors";
import { assertSameOrigin } from "@/lib/auth/origin";
import { requireWallet } from "@/lib/auth/session";
import { readJsonBody } from "@/lib/api/http";
import { runTurn } from "@/lib/ai/runner";
import { geminiFromEnv } from "@/lib/ai/gemini";
import { geminiConfigured } from "@/lib/ai/probe";
import type { AIMessage } from "@/lib/ai/provider";
import type { AiTurnResponse } from "@/lib/api/dto";

/**
 * POST /api/ai/turn — one turn of the real Gemini conversation (build step 9,
 * phase 3). Powers the `/create` and `/check-in` flows: the runner drives the
 * 19-tool agentic loop scoped to the authenticated wallet.
 *
 * CLAUDE.md rule 1 (no fakes): if Gemini is not configured we return an honest
 * 503, never a canned reply. Rule 5 (untrusted input): the user's message is
 * passed as *intent* to `runTurn`, which wraps it behind the immutable trust
 * boundary in `promptGuards` — evidence/goal data can never become instructions.
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

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const wallet = await requireWallet();

    if (!geminiConfigured()) {
      throw new ServiceUnavailableError(
        "AI is not configured (no GEMINI_API_KEY) — see LIMITATIONS.md step 3",
      );
    }

    const parsed = bodySchema.parse(await readJsonBody(req));
    const result = await runTurn({
      provider: geminiFromEnv(),
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
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
