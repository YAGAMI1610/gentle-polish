import { describe, expect, it } from "vitest";
import { buildSystemInstruction } from "./promptGuards";
import { groqFromEnv } from "./groq";
import { groqConfigured } from "./probe";
import { toolSpecs } from "./tools/registry";

/**
 * Live Groq end-to-end test — the Groq twin of `gemini.integration.test.ts`.
 *
 * GROQ_API_KEY-gated, mirroring the DB-gated repository tests: with no key it
 * skips with a reason. When a key IS present it makes a real call to the real API
 * and asserts the whole chain works: our tool specs advertise `createGoal`, the
 * model does real function calling through Groq's OpenAI-compatible surface, and
 * our mapping surfaces it as an `AIToolCall`. No test double.
 *
 * This exercises only the provider (no DB): it asserts the model *proposes* the
 * createGoal call; it does not run the tool.
 */

const configured = groqConfigured();

if (!configured) {
  console.info(
    "[groq.integration] SKIPPED — GROQ_API_KEY not set.\n" +
      "  To run it: set GROQ_API_KEY (and optionally GROQ_MODEL) in apps/web/.env, " +
      "then `pnpm --filter web test`.",
  );
}

describe.skipIf(!configured)("GroqProvider (live API)", () => {
  it("proposes a createGoal tool call for an explicit goal request", async () => {
    const provider = groqFromEnv();

    const result = await provider.generate({
      system: buildSystemInstruction(
        "The user is committing to a concrete goal. Call the createGoal tool with their details.",
      ),
      messages: [
        {
          kind: "user_text",
          text:
            "I want to commit to running a 10k by December. Check me in weekly. " +
            "Please create this goal now.",
        },
      ],
      tools: toolSpecs(),
    });

    const call = result.toolCalls.find((c) => c.name === "createGoal");
    expect(call, "expected the model to call createGoal").toBeDefined();
    // The model should have filled the required title from the user's request.
    expect(typeof call?.args["title"]).toBe("string");
  }, 30_000);
});
