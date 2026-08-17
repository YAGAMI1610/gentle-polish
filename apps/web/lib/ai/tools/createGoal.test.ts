import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getGoal, listDecisions, prisma } from "@/lib/db";
import { ensureWallet } from "@/lib/db";
import { probeDatabaseReady } from "@/lib/db/probe";
import { createGoalTool } from "./createGoal";
import type { ToolContext } from "./types";

/**
 * `createGoal` tool tests.
 *
 * Schema / advertised-parameters checks are pure and always run. The handler
 * test writes real rows and is DB-gated exactly like the repository integration
 * tests (see LIMITATIONS.md step 3): with no Postgres it skips with a reason.
 */

describe("createGoal tool — schema & advertised parameters", () => {
  it("is named createGoal and reuses the DB boundary schema", () => {
    expect(createGoalTool.name).toBe("createGoal");
    const parsed = createGoalTool.input.parse({
      title: "Run a 10k",
      summary: "Train up to a 10k run.",
      mode: "SELF_COMMITMENT",
      checkInFrequency: "Every week",
    });
    // Defaults from createGoalInput apply.
    expect(parsed.category).toBe("GENERIC");
    expect(parsed.status).toBe("ACTIVE");
    expect(parsed.progress).toBe(0);
  });

  it("requires mode (no default) alongside title/summary/checkInFrequency", () => {
    const params = createGoalTool.parameters as {
      required: string[];
      properties: Record<string, { enum?: string[] }>;
    };
    expect(params.required).toEqual(
      expect.arrayContaining(["title", "summary", "mode", "checkInFrequency"]),
    );
    expect(params.properties["mode"]?.enum).toEqual(
      expect.arrayContaining(["ACCOUNTABILITY", "SELF_COMMITMENT"]),
    );

    // The Zod schema agrees: mode really is required.
    expect(() =>
      createGoalTool.input.parse({
        title: "x",
        summary: "y",
        checkInFrequency: "Weekly",
      }),
    ).toThrow();
  });
});

const dbReady = await probeDatabaseReady();

if (!dbReady) {
  console.info(
    "[createGoal.tool] handler test SKIPPED — no migrated Postgres reachable at DATABASE_URL.\n" +
      "  To run it: `docker compose up -d db`, then " +
      "`pnpm --filter web exec prisma migrate deploy`, then `pnpm --filter web test`.",
  );
}

const WALLET = "0x1111111111111111111111111111111111111111";

describe.skipIf(!dbReady)("createGoal tool — handler (integration)", () => {
  beforeAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await ensureWallet(WALLET);
  });

  afterAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await prisma.$disconnect();
  });

  it("creates a real goal and writes a decision-log entry", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const args = createGoalTool.input.parse({
      title: "Read 12 books this year",
      summary: "One book a month, tracked.",
      mode: "SELF_COMMITMENT",
      category: "READING",
      checkInFrequency: "Monthly",
      checkInCadence: "MONTHLY",
    });

    const result = await createGoalTool.handler(args, ctx);

    expect(result.goalId).toBeTruthy();
    expect(result.title).toBe("Read 12 books this year");
    expect(result.mode).toBe("SELF_COMMITMENT");
    expect(result.category).toBe("READING");

    // The row is really in the database, owned by this wallet.
    const goal = await getGoal(WALLET, result.goalId);
    expect(goal?.title).toBe("Read 12 books this year");

    // And the material state change was audit-logged (§4/§10), linked to the goal
    // and stamped with the model version from the context.
    const decisions = await listDecisions(WALLET);
    const entry = decisions.find((d) => d.toolName === "createGoal" && d.goalId === result.goalId);
    expect(entry).toBeDefined();
    expect(entry?.modelVersion).toBe("test-model-v0");
  });
});
