import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGoal, ensureWallet, prisma, setGoalStatus } from "@/lib/db";
import { probeDatabaseReady } from "@/lib/db/probe";
import { getWalletGoalsTool } from "./getWalletGoals";
import type { ToolContext } from "./types";

/**
 * `getWalletGoals` tool tests. Schema/parameter checks always run; the handler
 * test is DB-gated exactly like the repository integration tests.
 */

describe("getWalletGoals tool — schema & advertised parameters", () => {
  it("is named getWalletGoals and takes an optional status filter", () => {
    expect(getWalletGoalsTool.name).toBe("getWalletGoals");
    const params = getWalletGoalsTool.parameters as {
      required: string[];
      properties: Record<string, { enum?: string[] }>;
    };
    expect(params.required).toEqual([]);
    expect(params.properties["status"]?.enum).toEqual(
      expect.arrayContaining(["ACTIVE", "COMPLETED", "ABANDONED"]),
    );
    expect(getWalletGoalsTool.input.parse({}).status).toBeUndefined();
    expect(getWalletGoalsTool.input.parse({ status: "ACTIVE" }).status).toBe("ACTIVE");
  });
});

const dbReady = await probeDatabaseReady();
if (!dbReady) {
  console.info(
    "[getWalletGoals.tool] handler test SKIPPED — no migrated Postgres reachable at DATABASE_URL.\n" +
      "  To run it: `docker compose up -d db`, then `pnpm --filter web exec prisma migrate deploy`.",
  );
}

const WALLET = "0x2222222222222222222222222222222222222222";

describe.skipIf(!dbReady)("getWalletGoals tool — handler (integration)", () => {
  beforeAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await ensureWallet(WALLET);
    const g1 = await createGoal(WALLET, {
      title: "Active goal",
      summary: "Still going.",
      mode: "SELF_COMMITMENT",
      checkInFrequency: "Weekly",
    });
    const g2 = await createGoal(WALLET, {
      title: "Finished goal",
      summary: "Done and dusted.",
      mode: "SELF_COMMITMENT",
      checkInFrequency: "Weekly",
    });
    await setGoalStatus(WALLET, g2.id, "COMPLETED");
    void g1;
  });

  afterAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await prisma.$disconnect();
  });

  it("returns the wallet's goals and honors the status filter", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };

    const all = await getWalletGoalsTool.handler(getWalletGoalsTool.input.parse({}), ctx);
    expect(all.goals.length).toBe(2);

    const completed = await getWalletGoalsTool.handler(
      getWalletGoalsTool.input.parse({ status: "COMPLETED" }),
      ctx,
    );
    expect(completed.goals.length).toBe(1);
    expect(completed.goals[0]?.title).toBe("Finished goal");
    expect(completed.goals[0]?.status).toBe("COMPLETED");
  });
});
