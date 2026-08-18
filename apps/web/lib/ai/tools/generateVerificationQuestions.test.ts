import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGoal, ensureWallet, listDecisions, prisma } from "@/lib/db";
import { probeDatabaseReady } from "@/lib/db/probe";
import { generateVerificationQuestionsTool } from "./generateVerificationQuestions";
import type { ToolContext } from "./types";

describe("generateVerificationQuestions tool — schema & advertised parameters", () => {
  it("requires only goalId", () => {
    expect(generateVerificationQuestionsTool.name).toBe("generateVerificationQuestions");
    const params = generateVerificationQuestionsTool.parameters as { required: string[] };
    expect(params.required).toEqual(["goalId"]);
  });
});

const dbReady = await probeDatabaseReady();
if (!dbReady) {
  console.info(
    "[generateVerificationQuestions.tool] handler test SKIPPED — no migrated Postgres reachable at DATABASE_URL.",
  );
}

const WALLET = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe.skipIf(!dbReady)("generateVerificationQuestions tool — handler (integration)", () => {
  beforeAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await ensureWallet(WALLET);
  });
  afterAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await prisma.$disconnect();
  });

  it("returns category-appropriate scaffold questions and logs the generation", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const goal = await createGoal(WALLET, {
      title: "Build a CLI",
      summary: "Implement in Go.",
      mode: "SELF_COMMITMENT",
      category: "CODING",
      checkInFrequency: "Weekly",
    });

    const result = await generateVerificationQuestionsTool.handler(
      generateVerificationQuestionsTool.input.parse({ goalId: goal.id }),
      ctx,
    );
    expect(result.category).toBe("CODING");
    expect(result.questions.length).toBeGreaterThanOrEqual(1);
    expect(result.questions.every((q) => typeof q === "string" && q.length > 0)).toBe(true);

    const decisions = await listDecisions(WALLET);
    expect(
      decisions.some((d) => d.toolName === "generateVerificationQuestions" && d.goalId === goal.id),
    ).toBe(true);
  });

  it("fails closed for an unowned goal", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    await expect(
      generateVerificationQuestionsTool.handler(
        generateVerificationQuestionsTool.input.parse({ goalId: "nope" }),
        ctx,
      ),
    ).rejects.toThrow(/not found/i);
  });
});
