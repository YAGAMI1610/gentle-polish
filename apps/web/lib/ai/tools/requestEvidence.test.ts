import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGoal, ensureWallet, prisma, upsertVerificationStrategy } from "@/lib/db";
import { probeDatabaseReady } from "@/lib/db/probe";
import { requestEvidenceTool } from "./requestEvidence";
import type { ToolContext } from "./types";

describe("requestEvidence tool — schema & advertised parameters", () => {
  it("requires goalId and allows an optional note", () => {
    expect(requestEvidenceTool.name).toBe("requestEvidence");
    const params = requestEvidenceTool.parameters as { required: string[] };
    expect(params.required).toEqual(["goalId"]);
    expect(requestEvidenceTool.input.parse({ goalId: "g" }).note).toBeUndefined();
  });
});

const dbReady = await probeDatabaseReady();
if (!dbReady) {
  console.info(
    "[requestEvidence.tool] handler test SKIPPED — no migrated Postgres reachable at DATABASE_URL.",
  );
}

const WALLET = "0x8888888888888888888888888888888888888888";

describe.skipIf(!dbReady)("requestEvidence tool — handler (integration)", () => {
  beforeAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await ensureWallet(WALLET);
  });
  afterAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await prisma.$disconnect();
  });

  it("reports no required evidence before a strategy exists, then the strategy's list after", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const goal = await createGoal(WALLET, {
      title: "Learn Rust",
      summary: "Ship a crate.",
      mode: "SELF_COMMITMENT",
      category: "CODING",
      checkInFrequency: "Weekly",
    });

    const before = await requestEvidenceTool.handler(
      requestEvidenceTool.input.parse({ goalId: goal.id }),
      ctx,
    );
    expect(before.hasStrategy).toBe(false);
    expect(before.requiredEvidence).toEqual([]);

    await upsertVerificationStrategy(WALLET, {
      goalId: goal.id,
      measurement: "merged pull requests",
      methods: ["GitHub commit history", "repo build passing"],
      requiredEvidence: ["GITHUB", "SCREENSHOT"],
    });

    const after = await requestEvidenceTool.handler(
      requestEvidenceTool.input.parse({ goalId: goal.id, note: "send your repo link" }),
      ctx,
    );
    expect(after.hasStrategy).toBe(true);
    expect(after.requiredEvidence).toEqual(expect.arrayContaining(["GITHUB", "SCREENSHOT"]));
    expect(after.note).toBe("send your repo link");
  });

  it("fails closed for an unowned goal", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    await expect(
      requestEvidenceTool.handler(requestEvidenceTool.input.parse({ goalId: "nope" }), ctx),
    ).rejects.toThrow(/not found/i);
  });
});
