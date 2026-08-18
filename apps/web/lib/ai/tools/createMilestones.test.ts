import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGoal, ensureWallet, listDecisions, prisma } from "@/lib/db";
import { probeDatabaseReady } from "@/lib/db/probe";
import { createMilestonesTool } from "./createMilestones";
import type { ToolContext } from "./types";

describe("createMilestones tool — schema & advertised parameters", () => {
  it("requires goalId and a non-empty milestones array", () => {
    expect(createMilestonesTool.name).toBe("createMilestones");
    const params = createMilestonesTool.parameters as { required: string[] };
    expect(params.required).toEqual(expect.arrayContaining(["goalId", "milestones"]));
    expect(() => createMilestonesTool.input.parse({ goalId: "g", milestones: [] })).toThrow();
    const ok = createMilestonesTool.input.parse({
      goalId: "g",
      milestones: [{ title: "First" }, { title: "Second", orderIndex: 5 }],
    });
    expect(ok.milestones).toHaveLength(2);
  });
});

const dbReady = await probeDatabaseReady();
if (!dbReady) {
  console.info(
    "[createMilestones.tool] handler test SKIPPED — no migrated Postgres reachable at DATABASE_URL.",
  );
}

const WALLET = "0x4444444444444444444444444444444444444444";

describe.skipIf(!dbReady)("createMilestones tool — handler (integration)", () => {
  beforeAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await ensureWallet(WALLET);
  });
  afterAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await prisma.$disconnect();
  });

  it("adds ordered milestones and audit-logs the count", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const goal = await createGoal(WALLET, {
      title: "Ship v1",
      summary: "Three checkpoints.",
      mode: "SELF_COMMITMENT",
      checkInFrequency: "Weekly",
    });

    const result = await createMilestonesTool.handler(
      createMilestonesTool.input.parse({
        goalId: goal.id,
        milestones: [{ title: "Design" }, { title: "Build" }, { title: "Launch" }],
      }),
      ctx,
    );

    expect(result.milestones).toHaveLength(3);
    expect(result.milestones.map((m) => m.orderIndex)).toEqual([0, 1, 2]);
    expect(result.milestones.every((m) => m.done === false)).toBe(true);

    const decisions = await listDecisions(WALLET);
    expect(decisions.some((d) => d.toolName === "createMilestones" && d.goalId === goal.id)).toBe(
      true,
    );
  });

  it("refuses to add milestones to a goal owned by another wallet", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    await expect(
      createMilestonesTool.handler(
        createMilestonesTool.input.parse({
          goalId: "not-your-goal",
          milestones: [{ title: "x" }],
        }),
        ctx,
      ),
    ).rejects.toThrow();
  });
});
