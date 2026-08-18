import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGoal, ensureWallet, prisma } from "@/lib/db";
import { probeDatabaseReady } from "@/lib/db/probe";
import { getCommitmentStatusTool } from "./getCommitmentStatus";
import type { ToolContext } from "./types";

describe("getCommitmentStatus tool — schema & advertised parameters", () => {
  it("is read-only and requires goalId", () => {
    expect(getCommitmentStatusTool.name).toBe("getCommitmentStatus");
    const params = getCommitmentStatusTool.parameters as { required: string[] };
    expect(params.required).toEqual(["goalId"]);
    // The description must make clear it never moves value (CLAUDE.md rules 1–3).
    expect(getCommitmentStatusTool.description.toLowerCase()).toContain("read-only");
  });
});

const dbReady = await probeDatabaseReady();
if (!dbReady) {
  console.info(
    "[getCommitmentStatus.tool] handler test SKIPPED — no migrated Postgres reachable at DATABASE_URL.",
  );
}

const WALLET = "0x9999999999999999999999999999999999999999";

describe.skipIf(!dbReady)("getCommitmentStatus tool — handler (integration)", () => {
  beforeAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await ensureWallet(WALLET);
  });
  afterAll(async () => {
    await prisma.wallet.deleteMany({ where: { address: WALLET } });
    await prisma.$disconnect();
  });

  it("returns exists:false when no commitment is attached (creation is step 8)", async () => {
    // There is no commitment-creation tool this pass, so the honest state of every
    // goal is "no commitment yet". We assert that projection rather than inventing one.
    const ctx: ToolContext = { walletAddress: WALLET, modelVersion: "test-model-v0" };
    const goal = await createGoal(WALLET, {
      title: "Save $1000",
      summary: "No stake attached yet.",
      mode: "SELF_COMMITMENT",
      category: "SAVING",
      checkInFrequency: "Monthly",
    });

    const result = await getCommitmentStatusTool.handler(
      getCommitmentStatusTool.input.parse({ goalId: goal.id }),
      ctx,
    );
    expect(result.exists).toBe(false);
    expect(result.status).toBeNull();
    expect(result.txHash).toBeNull();
    expect(result.principalWei).toBeNull();
  });
});
