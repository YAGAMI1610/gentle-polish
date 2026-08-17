import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureWallet, listGoals, prisma } from "@/lib/db";
import { probeDatabaseReady } from "@/lib/db/probe";
import type { AIProvider, GenerateRequest, GenerateResult } from "./provider";
import { runTurn } from "./runner";

/**
 * Runner (agentic loop) tests.
 *
 * `ScriptedProvider` is an explicit in-test test double — NOT a production code
 * path (build-prompt §8, CLAUDE.md rule 1). It returns a fixed sequence of
 * provider results so the loop's control flow is deterministic and testable
 * without a live model. Orchestration tests always run; the end-to-end test that
 * writes a real goal is DB-gated like the repository suite.
 */
class ScriptedProvider implements AIProvider {
  readonly modelVersion = "scripted-test-double";
  readonly requests: GenerateRequest[] = [];
  private index = 0;

  constructor(private readonly script: readonly GenerateResult[]) {}

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    this.requests.push(request);
    const step = this.script[this.index] ?? { text: "(script exhausted)", toolCalls: [] };
    this.index += 1;
    return step;
  }
}

const ANON = "0x9999999999999999999999999999999999999999";

describe("runTurn — orchestration (always-on, no DB)", () => {
  it("returns immediately when the model emits no tool calls", async () => {
    const provider = new ScriptedProvider([{ text: "just an answer", toolCalls: [] }]);

    const res = await runTurn({ provider, walletAddress: ANON, userMessage: "hello" });

    expect(res.rounds).toBe(1);
    expect(res.text).toBe("just an answer");
    // The model's answer is recorded in the transcript.
    expect(res.messages.at(-1)).toMatchObject({ kind: "model_text", text: "just an answer" });
    // Tools were advertised to the provider.
    expect(provider.requests[0]?.tools?.some((t) => t.name === "createGoal")).toBe(true);
  });

  it("runs a tool round, feeds the result back, then returns final text", async () => {
    // Unknown tool → dispatch fails closed WITHOUT touching the DB, which lets
    // this exercise the full loop plumbing as an always-on test.
    const provider = new ScriptedProvider([
      { text: null, toolCalls: [{ name: "noSuchTool", args: {} }] },
      { text: "done", toolCalls: [] },
    ]);

    const res = await runTurn({ provider, walletAddress: ANON, userMessage: "do a thing" });

    expect(res.rounds).toBe(2);
    expect(res.text).toBe("done");

    // The model's tool call was recorded...
    expect(res.messages.some((m) => m.kind === "model_tool_calls")).toBe(true);
    // ...and the failed dispatch was fed back as an error tool_result.
    const toolResult = res.messages.find((m) => m.kind === "tool_result");
    expect(toolResult?.kind).toBe("tool_result");
    if (toolResult?.kind === "tool_result") {
      expect(toolResult.name).toBe("noSuchTool");
      expect(toolResult.response).toMatchObject({ ok: false });
    }
  });

  it("stops after maxToolRounds and makes one final tool-less call", async () => {
    // Always proposes a tool call; the loop must not run forever.
    const loop: GenerateResult = { text: null, toolCalls: [{ name: "noSuchTool", args: {} }] };
    const provider = new ScriptedProvider([loop, loop, loop, loop, loop, loop]);

    const res = await runTurn({
      provider,
      walletAddress: ANON,
      userMessage: "spin",
      maxToolRounds: 2,
    });

    expect(res.rounds).toBe(2);
    // 2 tool rounds + 1 final tool-less call = 3 provider calls.
    expect(provider.requests).toHaveLength(3);
    // The final call advertised no tools (forcing a text answer).
    expect(provider.requests.at(-1)?.tools).toBeUndefined();
  });
});

const dbReady = await probeDatabaseReady();

if (!dbReady) {
  console.info(
    "[runner] end-to-end test SKIPPED — no migrated Postgres reachable at DATABASE_URL.\n" +
      "  To run it: `docker compose up -d db`, then " +
      "`pnpm --filter web exec prisma migrate deploy`, then `pnpm --filter web test`.",
  );
}

const RUNNER_WALLET = "0x3333333333333333333333333333333333333333";

describe.skipIf(!dbReady)("runTurn — end-to-end createGoal (integration)", () => {
  beforeAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: RUNNER_WALLET } });
    await ensureWallet(RUNNER_WALLET);
  });

  afterAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: RUNNER_WALLET } });
    await prisma.$disconnect();
  });

  it("drives the createGoal tool and persists a real goal", async () => {
    const provider = new ScriptedProvider([
      {
        text: null,
        toolCalls: [
          {
            name: "createGoal",
            args: {
              title: "Ship the MVP",
              summary: "Finish and demo the hackathon MVP.",
              mode: "SELF_COMMITMENT",
              checkInFrequency: "Every weekday",
            },
          },
        ],
      },
      { text: "I've created your goal — let's get to work.", toolCalls: [] },
    ]);

    const res = await runTurn({
      provider,
      walletAddress: RUNNER_WALLET,
      userMessage: "Commit me to shipping the MVP.",
    });

    expect(res.rounds).toBe(2);
    expect(res.text).toContain("created your goal");

    // The tool really ran and succeeded.
    const toolResult = res.messages.find((m) => m.kind === "tool_result");
    expect(toolResult?.kind).toBe("tool_result");
    if (toolResult?.kind === "tool_result") {
      expect(toolResult.response).toMatchObject({ ok: true });
    }

    // And a real goal now exists for this wallet.
    const goals = await listGoals(RUNNER_WALLET);
    expect(goals.some((g) => g.title === "Ship the MVP")).toBe(true);
  });
});
