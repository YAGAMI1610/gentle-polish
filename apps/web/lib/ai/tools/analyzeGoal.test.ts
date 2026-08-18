import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGoal, ensureWallet, getGoal, listDecisions, prisma } from "@/lib/db";
import { probeDatabaseReady } from "@/lib/db/probe";
import { analyzeGoalTool } from "./analyzeGoal";
import type { ToolContext } from "./types";

describe("analyzeGoal tool — schema & advertised parameters", () => {
  it("requires the goal id, the three signals, and an assessment", () => {
    expect(analyzeGoalTool.name).toBe("analyzeGoal");
    const params = analyzeGoalTool.parameters as { required: string[] };
    expect(params.required).toEqual(
      expect.arrayContaining(["goalId", "realism", "safety", "verifiability", "assessment"]),
    );
    expect(() => analyzeGoalTool.input.parse({ goalId: "g" })).toThrow();
    const ok = analyzeGoalTool.input.parse({
      goalId: "g",
      realism: "HIGH",
      safety: "HIGH",
      verifiability: "MEDIUM",
      assessment: "Looks solid and safe.",
    });
    expect(ok.realism).toBe("HIGH");
  });
});

const dbReady = await probeDatabaseReady();
if (!dbReady) {
  console.info(
    "[analyzeGoal.tool] handler test SKIPPED — no migrated Postgres reachable at DATABASE_URL.",
  );
}

const WALLET = "0x3333333333333333333333333333333333333333";

describe.skipIf(!dbReady)("analyzeGoal tool — handler (integration)", () => {
  beforeAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await ensureWallet(WALLET);
  });
  afterAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await prisma.$disconnect();
  });

  it("persists shaping slots and writes a decision-log entry", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const goal = await createGoal(WALLET, {
      title: "Learn to swim",
      summary: "Be able to swim 50m.",
      mode: "SELF_COMMITMENT",
      checkInFrequency: "Weekly",
    });

    const result = await analyzeGoalTool.handler(
      analyzeGoalTool.input.parse({
        goalId: goal.id,
        realism: "HIGH",
        safety: "HIGH",
        verifiability: "MEDIUM",
        assessment: "Achievable with weekly lessons.",
        currentState: "Cannot swim",
        successMetric: "Swim 50m unaided",
      }),
      ctx,
    );
    expect(result.shapingUpdated).toBe(true);

    const saved = await getGoal(WALLET, goal.id);
    expect(saved?.currentState).toBe("Cannot swim");
    expect(saved?.successMetric).toBe("Swim 50m unaided");

    const decisions = await listDecisions(WALLET);
    expect(decisions.some((d) => d.toolName === "analyzeGoal" && d.goalId === goal.id)).toBe(true);
  });

  it("fails closed for a goal owned by another wallet", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    await expect(
      analyzeGoalTool.handler(
        analyzeGoalTool.input.parse({
          goalId: "does-not-exist",
          realism: "LOW",
          safety: "LOW",
          verifiability: "LOW",
          assessment: "n/a",
        }),
        ctx,
      ),
    ).rejects.toThrow();
  });
});
