import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGoal, ensureWallet, listDecisions, prisma } from "@/lib/db";
import { probeDatabaseReady } from "@/lib/db/probe";
import { calculateVerificationConfidenceTool } from "./calculateVerificationConfidence";
import type { ToolContext } from "./types";

// This tool does no DB work when no goalId is supplied, so the scoring behaviour
// is exercised always-on; only the audit-logging path is DB-gated.
const NO_DB_CTX: ToolContext = {
  walletAddress: "0x1010101010101010101010101010101010101010",
  modelVersion: "test-model-v0",
};

describe("calculateVerificationConfidence tool — scoring (always-on)", () => {
  it("requires the three signals", () => {
    expect(calculateVerificationConfidenceTool.name).toBe("calculateVerificationConfidence");
    const params = calculateVerificationConfidenceTool.parameters as { required: string[] };
    expect(params.required).toEqual(
      expect.arrayContaining(["plausibility", "evidenceQuality", "consistency"]),
    );
  });

  it("never returns VERIFIED when evidence quality is LOW", async () => {
    const result = await calculateVerificationConfidenceTool.handler(
      calculateVerificationConfidenceTool.input.parse({
        plausibility: "HIGH",
        evidenceQuality: "LOW",
        consistency: "HIGH",
      }),
      NO_DB_CTX,
    );
    expect(result.status).not.toBe("VERIFIED");
  });

  it("returns VERIFIED with high confidence when every signal is HIGH", async () => {
    const result = await calculateVerificationConfidenceTool.handler(
      calculateVerificationConfidenceTool.input.parse({
        plausibility: "HIGH",
        evidenceQuality: "HIGH",
        consistency: "HIGH",
      }),
      NO_DB_CTX,
    );
    expect(result.status).toBe("VERIFIED");
    expect(result.confidence).toBeGreaterThanOrEqual(70);
  });
});

const dbReady = await probeDatabaseReady();
if (!dbReady) {
  console.info(
    "[calculateVerificationConfidence.tool] audit-log test SKIPPED — no migrated Postgres reachable at DATABASE_URL.",
  );
}

const WALLET = "0xffffffffffffffffffffffffffffffffffffffff";

describe.skipIf(!dbReady)("calculateVerificationConfidence tool — audit log (integration)", () => {
  beforeAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await ensureWallet(WALLET);
  });
  afterAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await prisma.$disconnect();
  });

  it("logs the calculation when a goalId is supplied", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const goal = await createGoal(WALLET, {
      title: "Confidence log goal",
      summary: "Associate a calc.",
      mode: "SELF_COMMITMENT",
      checkInFrequency: "Weekly",
    });

    const result = await calculateVerificationConfidenceTool.handler(
      calculateVerificationConfidenceTool.input.parse({
        goalId: goal.id,
        plausibility: "MEDIUM",
        evidenceQuality: "MEDIUM",
        consistency: "MEDIUM",
      }),
      ctx,
    );

    const decisions = await listDecisions(WALLET);
    expect(
      decisions.some(
        (d) =>
          d.toolName === "calculateVerificationConfidence" &&
          d.goalId === goal.id &&
          d.confidence === result.confidence,
      ),
    ).toBe(true);
  });
});
