import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGoal, ensureWallet, getLatestScore, listDecisions, prisma } from "@/lib/db";
import { probeDatabaseReady } from "@/lib/db/probe";
import { calculateAccountabilityScoreTool } from "./calculateAccountabilityScore";
import type { ToolContext } from "./types";

describe("calculateAccountabilityScore tool — schema & advertised parameters", () => {
  it("takes no required parameters and advertises server-side computation", () => {
    expect(calculateAccountabilityScoreTool.name).toBe("calculateAccountabilityScore");
    const params = calculateAccountabilityScoreTool.parameters as { required: string[] };
    expect(params.required).toEqual([]);
    // §10: the score is never client-supplied.
    expect(calculateAccountabilityScoreTool.description.toLowerCase()).toContain("server-computed");
  });
});

const dbReady = await probeDatabaseReady();
if (!dbReady) {
  console.info(
    "[calculateAccountabilityScore.tool] handler test SKIPPED — no migrated Postgres reachable at DATABASE_URL.",
  );
}

const WALLET = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe.skipIf(!dbReady)("calculateAccountabilityScore tool — handler (integration)", () => {
  beforeAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await ensureWallet(WALLET);
    await createGoal(WALLET, {
      title: "Goal A",
      summary: "In progress.",
      mode: "SELF_COMMITMENT",
      checkInFrequency: "Weekly",
      progress: 40,
    });
  });
  afterAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await prisma.$disconnect();
  });

  it("computes a bounded score with a weighted breakdown and logs it", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };

    const result = await calculateAccountabilityScoreTool.handler(
      calculateAccountabilityScoreTool.input.parse({ reason: "weekly recompute" }),
      ctx,
    );

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.breakdown.length).toBeGreaterThanOrEqual(1);
    for (const c of result.breakdown) {
      expect(typeof c.label).toBe("string");
      expect(c.value).toBeGreaterThanOrEqual(0);
      expect(c.weight).toBeGreaterThan(0);
    }

    // It was persisted server-side and mirrored to the decision log with the score.
    const latest = await getLatestScore(WALLET);
    expect(latest?.score).toBe(result.score);
    const decisions = await listDecisions(WALLET);
    expect(
      decisions.some(
        (d) => d.toolName === "calculateAccountabilityScore" && d.confidence === result.score,
      ),
    ).toBe(true);
  });
});
