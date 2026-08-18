import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGoal, createMilestones, ensureWallet, getGoal, prisma } from "@/lib/db";
import { probeDatabaseReady } from "@/lib/db/probe";
import { updateProgressTool } from "./updateProgress";
import type { ToolContext } from "./types";

describe("updateProgress tool — schema & advertised parameters", () => {
  it("requires at least one of progress / milestoneId", () => {
    expect(updateProgressTool.name).toBe("updateProgress");
    const params = updateProgressTool.parameters as { required: string[] };
    expect(params.required).toEqual(["goalId"]);
    // The refinement rejects a bare goalId (nothing to update).
    expect(() => updateProgressTool.input.parse({ goalId: "g" })).toThrow();
    // milestoneDone without a milestoneId is also rejected.
    expect(() => updateProgressTool.input.parse({ goalId: "g", milestoneDone: true })).toThrow();
    expect(updateProgressTool.input.parse({ goalId: "g", progress: 40 }).progress).toBe(40);
  });
});

const dbReady = await probeDatabaseReady();
if (!dbReady) {
  console.info(
    "[updateProgress.tool] handler test SKIPPED — no migrated Postgres reachable at DATABASE_URL.",
  );
}

const WALLET = "0x6666666666666666666666666666666666666666";

describe.skipIf(!dbReady)("updateProgress tool — handler (integration)", () => {
  beforeAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await ensureWallet(WALLET);
  });
  afterAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await prisma.$disconnect();
  });

  it("records goal progress and marks a milestone done (never 'verified')", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const goal = await createGoal(WALLET, {
      title: "Half marathon",
      summary: "Build up mileage.",
      mode: "SELF_COMMITMENT",
      checkInFrequency: "Weekly",
    });
    const milestones = await createMilestones(WALLET, {
      goalId: goal.id,
      milestones: [{ title: "Run 5k" }],
    });
    const milestoneId = milestones[0]!.id;

    const result = await updateProgressTool.handler(
      updateProgressTool.input.parse({
        goalId: goal.id,
        progress: 50,
        milestoneId,
        milestoneDone: true,
      }),
      ctx,
    );
    expect(result.updated).toEqual(
      expect.arrayContaining([expect.stringContaining("progress 50%")]),
    );

    const saved = await getGoal(WALLET, goal.id);
    expect(saved?.progress).toBe(50);
    // updateProgress records self-report only — status stays ACTIVE, not verified/completed.
    expect(saved?.status).toBe("ACTIVE");
  });

  it("fails closed when the goal is not owned", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    await expect(
      updateProgressTool.handler(
        updateProgressTool.input.parse({ goalId: "nope", progress: 10 }),
        ctx,
      ),
    ).rejects.toThrow(/not found/i);
  });
});
