import { describe, expect, it } from "vitest";
import { buildSystemInstruction } from "./promptGuards";
import { geminiFromEnv } from "./gemini";
import { geminiConfigured } from "./probe";
import { toolSpecs } from "./tools/registry";

/**
 * Live Gemini end-to-end test (build step 4's "real test" against the real API).
 *
 * GEMINI_API_KEY-gated, mirroring the DB-gated repository tests: with no key it
 * skips with a reason (the common case here — see LIMITATIONS.md §8). When a key
 * IS present it makes a real call to the real model and asserts the whole chain
 * works: our tool specs advertise `createGoal`, the model does real function
 * calling, and our SDK mapping surfaces it as an `AIToolCall`. No test double.
 *
 * This exercises only the provider (no DB): it asserts the model *proposes* the
 * createGoal call; it does not run the tool.
 */

const configured = geminiConfigured();

if (!configured) {
  console.info(
    "[gemini.integration] SKIPPED — GEMINI_API_KEY not set.\n" +
      "  To run it: set GEMINI_API_KEY (and optionally GEMINI_MODEL) in apps/web/.env, " +
      "then `pnpm --filter web test`.",
  );
}

describe.skipIf(!configured)("GeminiProvider (live API)", () => {
  it("proposes a createGoal tool call for an explicit goal request", async () => {
    const provider = geminiFromEnv();

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
