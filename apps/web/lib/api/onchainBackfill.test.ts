import { describe, expect, it, vi } from "vitest";
import { ChainTxKind } from "@prisma/client";
import type { Hex, Log } from "viem";
import { backfillOnchainId, type OnchainBackfillDeps } from "./onchainBackfill";

/**
 * Always-on unit tests for the back-fill orchestrator (build-prompt §14.8; LIMITATIONS
 * §17). Its impure boundaries — chain-configured check, receipt read, event parsers, and
 * the wallet-scoped DB setters — are injected as in-test doubles, so the control flow
 * (kind gating, chain-config gating, owner/depositor matching, first-writer reporting)
 * is exercised with NO network and NO database. The real parsers and setters are proven
 * separately (contractClient.parsers.test.ts, onchainId.integration.test.ts).
 *
 * The properties asserted mirror CLAUDE.md rules 1–2: an id is written back only when a
 * matching event from the vault names the recording wallet; anything else is an honest
 * no-op with a reason, never a fabricated success.
 */

// Mixed-case wallet, deliberately, so the case-insensitive owner/depositor match is real.
const WALLET = "0xAbC0000000000000000000000000000000000001";
const OTHER = "0x00000000000000000000000000000000000000ff";

function makeDeps(overrides: Partial<OnchainBackfillDeps> = {}): OnchainBackfillDeps {
  return {
    isChainConfigured: () => true,
    readReceipt: vi.fn(async (_txHash: Hex) => ({ logs: [] as Log[] })),
    parseGoalRegistered: () => null,
    parseCommitmentCreated: () => null,
    setOnchainGoalId: vi.fn(async () => 1),
    setOnchainCommitmentId: vi.fn(async () => 1),
    ...overrides,
  };
}

describe("backfillOnchainId — gating", () => {
  it("no-ops for a kind that carries no id to recover (e.g. LOCK_FUNDS)", async () => {
    const readReceipt = vi.fn(async (_txHash: Hex) => ({ logs: [] as Log[] }));
    const res = await backfillOnchainId(
      WALLET,
      { kind: ChainTxKind.LOCK_FUNDS, txHash: "0xabc", goalId: null, commitmentId: null },
      makeDeps({ readReceipt }),
    );
    expect(res).toEqual({
      backfilled: false,
      onchainGoalId: null,
      onchainCommitmentId: null,
      reason: null,
    });
    expect(readReceipt).not.toHaveBeenCalled();
  });

  it("no-ops for REGISTER_GOAL with no DB goal id to fill", async () => {
    const res = await backfillOnchainId(
      WALLET,
      { kind: ChainTxKind.REGISTER_GOAL, txHash: "0xabc", goalId: null, commitmentId: null },
      makeDeps(),
    );
    expect(res.backfilled).toBe(false);
    expect(res.reason).toBeNull();
  });

  it("reports chain-not-configured without attempting a receipt read", async () => {
    const readReceipt = vi.fn(async (_txHash: Hex) => ({ logs: [] as Log[] }));
    const res = await backfillOnchainId(
      WALLET,
      { kind: ChainTxKind.REGISTER_GOAL, txHash: "0xabc", goalId: "goal-1", commitmentId: null },
      makeDeps({ isChainConfigured: () => false, readReceipt }),
    );
    expect(res.backfilled).toBe(false);
    expect(res.reason).toMatch(/not configured/);
    expect(readReceipt).not.toHaveBeenCalled();
  });
});

describe("backfillOnchainId — goal", () => {
  it("back-fills the goal id when GoalRegistered owner matches the wallet", async () => {
    const setOnchainGoalId = vi.fn(async () => 1);
    const res = await backfillOnchainId(
      WALLET,
      { kind: ChainTxKind.REGISTER_GOAL, txHash: "0xabc", goalId: "goal-1", commitmentId: null },
      makeDeps({
        // owner returned lower-cased vs mixed-case WALLET — proves case-insensitive match.
        parseGoalRegistered: () => ({ goalId: 7n, owner: WALLET.toLowerCase() as `0x${string}` }),
        setOnchainGoalId,
      }),
    );
    expect(res).toEqual({
      backfilled: true,
      onchainGoalId: "7",
      onchainCommitmentId: null,
      reason: null,
    });
    expect(setOnchainGoalId).toHaveBeenCalledWith(WALLET, "goal-1", 7n);
  });

  it("refuses to back-fill when GoalRegistered names a different owner", async () => {
    const setOnchainGoalId = vi.fn(async () => 1);
    const res = await backfillOnchainId(
      WALLET,
      { kind: ChainTxKind.REGISTER_GOAL, txHash: "0xabc", goalId: "goal-1", commitmentId: null },
      makeDeps({
        parseGoalRegistered: () => ({ goalId: 7n, owner: OTHER as `0x${string}` }),
        setOnchainGoalId,
      }),
    );
    expect(res.backfilled).toBe(false);
    expect(res.reason).toMatch(/owner does not match/);
    expect(setOnchainGoalId).not.toHaveBeenCalled();
  });

  it("reports honestly when the receipt carries no GoalRegistered from the vault", async () => {
    const res = await backfillOnchainId(
      WALLET,
      { kind: ChainTxKind.REGISTER_GOAL, txHash: "0xabc", goalId: "goal-1", commitmentId: null },
      makeDeps({ parseGoalRegistered: () => null }),
    );
    expect(res.backfilled).toBe(false);
    expect(res.reason).toMatch(/no GoalRegistered/);
  });

  it("marks backfilled:false but still returns the id on an idempotent re-record", async () => {
    const res = await backfillOnchainId(
      WALLET,
      { kind: ChainTxKind.REGISTER_GOAL, txHash: "0xabc", goalId: "goal-1", commitmentId: null },
      makeDeps({
        parseGoalRegistered: () => ({ goalId: 7n, owner: WALLET as `0x${string}` }),
        setOnchainGoalId: vi.fn(async () => 0),
      }),
    );
    expect(res.backfilled).toBe(false);
    expect(res.onchainGoalId).toBe("7");
    expect(res.reason).toMatch(/already had an on-chain id/);
  });
});

describe("backfillOnchainId — commitment", () => {
  it("back-fills the commitment id when CommitmentCreated depositor matches", async () => {
    const setOnchainCommitmentId = vi.fn(async () => 1);
    const res = await backfillOnchainId(
      WALLET,
      { kind: ChainTxKind.CREATE_COMMITMENT, txHash: "0xabc", goalId: null, commitmentId: "c-1" },
      makeDeps({
        parseCommitmentCreated: () => ({
          commitmentId: 3n,
          goalId: 7n,
          depositor: WALLET.toLowerCase() as `0x${string}`,
        }),
        setOnchainCommitmentId,
      }),
    );
    expect(res).toEqual({
      backfilled: true,
      onchainGoalId: null,
      onchainCommitmentId: "3",
      reason: null,
    });
    expect(setOnchainCommitmentId).toHaveBeenCalledWith(WALLET, "c-1", 3n);
  });

  it("refuses to back-fill when CommitmentCreated names a different depositor", async () => {
    const setOnchainCommitmentId = vi.fn(async () => 1);
    const res = await backfillOnchainId(
      WALLET,
      { kind: ChainTxKind.CREATE_COMMITMENT, txHash: "0xabc", goalId: null, commitmentId: "c-1" },
      makeDeps({
        parseCommitmentCreated: () => ({
          commitmentId: 3n,
          goalId: 7n,
          depositor: OTHER as `0x${string}`,
        }),
        setOnchainCommitmentId,
      }),
    );
    expect(res.backfilled).toBe(false);
    expect(res.reason).toMatch(/depositor does not match/);
    expect(setOnchainCommitmentId).not.toHaveBeenCalled();
  });

  it("reports honestly when the receipt carries no CommitmentCreated from the vault", async () => {
    const res = await backfillOnchainId(
      WALLET,
      { kind: ChainTxKind.CREATE_COMMITMENT, txHash: "0xabc", goalId: null, commitmentId: "c-1" },
      makeDeps({ parseCommitmentCreated: () => null }),
    );
    expect(res.backfilled).toBe(false);
    expect(res.reason).toMatch(/no CommitmentCreated/);
  });
});

describe("backfillOnchainId — chain-read failure", () => {
  it("propagates a receipt-read error (the record route treats it as best-effort)", async () => {
    await expect(
      backfillOnchainId(
        WALLET,
        { kind: ChainTxKind.REGISTER_GOAL, txHash: "0xabc", goalId: "goal-1", commitmentId: null },
        makeDeps({
          readReceipt: vi.fn(async (_txHash: Hex) => {
            throw new Error("transaction not found: unknown hash");
          }),
        }),
      ),
    ).rejects.toThrow(/unknown hash/);
  });
});
