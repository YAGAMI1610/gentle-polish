import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGoal, ensureWallet, getVerificationStrategy, prisma } from "@/lib/db";
import { probeDatabaseReady } from "@/lib/db/probe";
import { createVerificationStrategyTool } from "./createVerificationStrategy";
import type { ToolContext } from "./types";

describe("createVerificationStrategy tool — schema & advertised parameters", () => {
  it("requires only goalId (defaults fill the rest)", () => {
    expect(createVerificationStrategyTool.name).toBe("createVerificationStrategy");
    const params = createVerificationStrategyTool.parameters as { required: string[] };
    expect(params.required).toEqual(["goalId"]);
    const ok = createVerificationStrategyTool.input.parse({ goalId: "g" });
    expect(ok.measurement).toBeUndefined();
  });
});

const dbReady = await probeDatabaseReady();
if (!dbReady) {
  console.info(
    "[createVerificationStrategy.tool] handler test SKIPPED — no migrated Postgres reachable at DATABASE_URL.",
  );
}

const WALLET = "0x7777777777777777777777777777777777777777";

describe.skipIf(!dbReady)("createVerificationStrategy tool — handler (integration)", () => {
  beforeAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await ensureWallet(WALLET);
  });
  afterAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await prisma.$disconnect();
  });

  it("fills category defaults (≥2 methods) and persists them", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const goal = await createGoal(WALLET, {
      title: "Read 12 books",
      summary: "Content-recall verification.",
      mode: "SELF_COMMITMENT",
      category: "READING",
      checkInFrequency: "Monthly",
    });

    const result = await createVerificationStrategyTool.handler(
      createVerificationStrategyTool.input.parse({ goalId: goal.id }),
      ctx,
    );
    // The engine's defaults always combine at least two independent signals.
    expect(result.methods.length).toBeGreaterThanOrEqual(2);
    expect(result.requiredEvidence.length).toBeGreaterThanOrEqual(1);
    expect(result.confidenceThreshold).toBe(70);

    const saved = await getVerificationStrategy(WALLET, goal.id);
    expect(saved?.methods.length).toBeGreaterThanOrEqual(2);
  });

  it("lets the model override the confidence threshold", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const goal = await createGoal(WALLET, {
      title: "Custom bar",
      summary: "Override threshold.",
      mode: "SELF_COMMITMENT",
      checkInFrequency: "Weekly",
    });

    const result = await createVerificationStrategyTool.handler(
      createVerificationStrategyTool.input.parse({
        goalId: goal.id,
        confidenceThreshold: 90,
        methods: ["photo of finish line", "connected GPS tracker"],
      }),
      ctx,
    );
    expect(result.confidenceThreshold).toBe(90);
    expect(result.methods).toContain("connected GPS tracker");
  });
});
