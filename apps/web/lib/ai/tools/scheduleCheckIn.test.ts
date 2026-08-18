import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGoal, ensureWallet, getGoal, prisma } from "@/lib/db";
import { probeDatabaseReady } from "@/lib/db/probe";
import { scheduleCheckInTool } from "./scheduleCheckIn";
import type { ToolContext } from "./types";

describe("scheduleCheckIn tool — schema & advertised parameters", () => {
  it("requires goalId and nextCheckIn, coerces the date, allows an optional cadence", () => {
    expect(scheduleCheckInTool.name).toBe("scheduleCheckIn");
    const params = scheduleCheckInTool.parameters as {
      required: string[];
      properties: Record<string, { enum?: string[] }>;
    };
    expect(params.required).toEqual(expect.arrayContaining(["goalId", "nextCheckIn"]));
    expect(params.properties["cadence"]?.enum).toEqual(
      expect.arrayContaining(["DAILY", "WEEKLY", "MONTHLY"]),
    );
    const ok = scheduleCheckInTool.input.parse({
      goalId: "g",
      nextCheckIn: "2026-09-01T00:00:00.000Z",
      cadence: "WEEKLY",
    });
    expect(ok.nextCheckIn).toBeInstanceOf(Date);
  });
});

const dbReady = await probeDatabaseReady();
if (!dbReady) {
  console.info(
    "[scheduleCheckIn.tool] handler test SKIPPED — no migrated Postgres reachable at DATABASE_URL.",
  );
}

const WALLET = "0x5555555555555555555555555555555555555555";

describe.skipIf(!dbReady)("scheduleCheckIn tool — handler (integration)", () => {
  beforeAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await ensureWallet(WALLET);
  });
  afterAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await prisma.$disconnect();
  });

  it("sets the next check-in and cadence on an owned goal", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const goal = await createGoal(WALLET, {
      title: "Weekly reviews",
      summary: "Check in every week.",
      mode: "SELF_COMMITMENT",
      checkInFrequency: "Weekly",
    });

    const result = await scheduleCheckInTool.handler(
      scheduleCheckInTool.input.parse({
        goalId: goal.id,
        nextCheckIn: "2026-09-01T09:00:00.000Z",
        cadence: "WEEKLY",
      }),
      ctx,
    );
    expect(result.nextCheckIn).toBe("2026-09-01T09:00:00.000Z");
    expect(result.cadence).toBe("WEEKLY");

    const saved = await getGoal(WALLET, goal.id);
    expect(saved?.nextCheckIn?.toISOString()).toBe("2026-09-01T09:00:00.000Z");
    expect(saved?.checkInCadence).toBe("WEEKLY");
  });

  it("fails closed for a goal this wallet does not own", async () => {
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    await expect(
      scheduleCheckInTool.handler(
        scheduleCheckInTool.input.parse({
          goalId: "nope",
          nextCheckIn: "2026-09-01T09:00:00.000Z",
        }),
        ctx,
      ),
    ).rejects.toThrow(/not found/i);
  });
});
