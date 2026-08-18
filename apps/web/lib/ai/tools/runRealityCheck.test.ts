import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGoal, ensureWallet, getLatestVerification, prisma } from "@/lib/db";
import { probeDatabaseReady } from "@/lib/db/probe";
import { runRealityCheckTool } from "./runRealityCheck";
import type { ToolContext } from "./types";

describe("runRealityCheck tool — schema & advertised parameters", () => {
  it("requires only goalId", () => {
    expect(runRealityCheckTool.name).toBe("runRealityCheck");
    const params = runRealityCheckTool.parameters as { required: string[] };
    expect(params.required).toEqual(["goalId"]);
  });
});

const dbReady = await probeDatabaseReady();
if (!dbReady) {
  console.info(
    "[runRealityCheck.tool] handler test SKIPPED — no migrated Postgres reachable at DATABASE_URL.",
  );
}

const WALLET = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

describe.skipIf(!dbReady)("runRealityCheck tool — handler (integration)", () => {
  beforeAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await ensureWallet(WALLET);
  });
  afterAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await prisma.$disconnect();
  });

  it("verifies on strong independent signals and persists a hashed record", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const goal = await createGoal(WALLET, {
      title: "Strong signals goal",
      summary: "All signals high.",
      mode: "SELF_COMMITMENT",
      checkInFrequency: "Weekly",
    });

    const result = await runRealityCheckTool.handler(
      runRealityCheckTool.input.parse({
        goalId: goal.id,
        plausibility: "HIGH",
        evidenceQuality: "HIGH",
        consistency: "HIGH",
        persist: true,
      }),
      ctx,
    );
    expect(result.status).toBe("VERIFIED");
    expect(result.confidence).toBeGreaterThanOrEqual(70);
    expect(result.verificationHash).toMatch(/^[0-9a-f]{64}$/);

    const latest = await getLatestVerification(WALLET, goal.id);
    expect(latest?.status).toBe("VERIFIED");
  });

  it("hard-gates a contradiction to REJECTED_AS_INCONSISTENT regardless of optimistic signals", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const goal = await createGoal(WALLET, {
      title: "Contradiction goal",
      summary: "Signals say great, facts say no.",
      mode: "SELF_COMMITMENT",
      checkInFrequency: "Weekly",
    });

    const result = await runRealityCheckTool.handler(
      runRealityCheckTool.input.parse({
        goalId: goal.id,
        plausibility: "HIGH",
        evidenceQuality: "HIGH",
        consistency: "HIGH",
        contradiction: true,
      }),
      ctx,
    );
    expect(result.status).toBe("REJECTED_AS_INCONSISTENT");
    expect(result.confidence).toBeLessThanOrEqual(25);
  });

  it("will not verify on LOW evidence quality even with everything else high", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const goal = await createGoal(WALLET, {
      title: "Weak evidence goal",
      summary: "Only a claim.",
      mode: "SELF_COMMITMENT",
      checkInFrequency: "Weekly",
    });

    const result = await runRealityCheckTool.handler(
      runRealityCheckTool.input.parse({
        goalId: goal.id,
        plausibility: "HIGH",
        evidenceQuality: "LOW",
        consistency: "HIGH",
      }),
      ctx,
    );
    expect(result.status).not.toBe("VERIFIED");
  });
});
