import { describe, expect, it } from "vitest";
import { ChainTxKind, type ChainTransaction } from "@prisma/client";
import type { Address, Log } from "viem";
import type { ReplayedVaultEvent } from "@/lib/chain";
import {
  DEFAULT_RECONCILE_CHUNK_BLOCKS,
  reconcileChainTransactions,
  type ChainReconcilerDeps,
} from "./chainReconciler";

/**
 * Chain-sync reconciler (LIMITATIONS.md item 12). Always-on: every impure boundary is
 * injected, so this exercises the real orchestration — gating, range resolution, chunking,
 * on-chain attribution, per-transaction dedupe, non-clobbering writes and honest reasons —
 * with no RPC and no Postgres.
 *
 * Log decoding itself is NOT re-proved here; `lib/chain/events.test.ts` does that against
 * genuinely ABI-encoded logs. The double below hands the orchestrator already-replayed
 * events (packed through the `readVaultLogs` → `replayVaultEvents` seam) so these tests
 * are about what the reconciler DOES with them.
 */

const WALLET = "0x1111111111111111111111111111111111111111";
const STRANGER = "0x2222222222222222222222222222222222222222" as Address;
const TX = (n: number): string => `0x${n.toString(16).padStart(64, "0")}`;

type RecordInput = Parameters<ChainReconcilerDeps["recordChainTx"]>[1];

function event(over: Partial<ReplayedVaultEvent> = {}): ReplayedVaultEvent {
  return {
    eventName: "FundsLocked",
    kind: ChainTxKind.LOCK_FUNDS,
    txHash: TX(1) as `0x${string}`,
    blockNumber: 100n,
    logIndex: 0,
    actor: WALLET as Address,
    onchainGoalId: null,
    onchainCommitmentId: 7n,
    title: "Principal locked",
    detail: "1000 wei locked for commitment #7.",
    ...over,
  };
}

function row(over: Partial<ChainTransaction> = {}): ChainTransaction {
  return {
    id: "ctx_1",
    walletAddress: WALLET,
    commitmentId: null,
    goalId: null,
    kind: ChainTxKind.LOCK_FUNDS,
    txHash: TX(1),
    blockNumber: null,
    title: "Principal locked",
    detail: null,
    createdAt: new Date(0),
    ...over,
  };
}

interface HarnessOpts {
  configured?: boolean;
  deploymentBlock?: bigint | null;
  head?: bigint;
  /** Events per scanned chunk, keyed by `fromBlock`; `"*"` answers every chunk. */
  events?: ReplayedVaultEvent[] | Map<string, ReplayedVaultEvent[]>;
  walletGoals?: bigint[];
  walletCommitments?: bigint[];
  /** on-chain goal id → DB row. */
  goals?: Record<string, { id: string }>;
  /** on-chain commitment id → DB row. */
  commitments?: Record<string, { id: string; goalId: string }>;
  /** txHash → already-indexed row. */
  existing?: Record<string, ChainTransaction>;
  logsError?: Error;
  recordError?: (input: RecordInput) => Error | null;
}

interface Harness {
  deps: ChainReconcilerDeps;
  ranges: Array<{ fromBlock: bigint; toBlock: bigint }>;
  recorded: Array<{ wallet: string; input: RecordInput }>;
  goalLookups: string[];
  commitmentLookups: string[];
}

function harness(opts: HarnessOpts = {}): Harness {
  const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  const recorded: Array<{ wallet: string; input: RecordInput }> = [];
  const goalLookups: string[] = [];
  const commitmentLookups: string[] = [];

  const eventsFor = (range: { fromBlock: bigint }): ReplayedVaultEvent[] => {
    if (opts.events === undefined) return [];
    if (Array.isArray(opts.events)) return opts.events;
    return opts.events.get(range.fromBlock.toString()) ?? opts.events.get("*") ?? [];
  };

  const deps: ChainReconcilerDeps = {
    isChainConfigured: () => opts.configured ?? true,
    deploymentBlock: () => opts.deploymentBlock ?? null,
    latestBlockNumber: async () => opts.head ?? 1_000n,
    // The already-replayed events ride through this seam as opaque "logs"; the pass-through
    // `replayVaultEvents` below unpacks them. Decoding is proved in lib/chain/events.test.ts.
    readVaultLogs: async (range) => {
      ranges.push(range);
      if (opts.logsError) throw opts.logsError;
      return eventsFor(range) as unknown as Log[];
    },
    replayVaultEvents: (logs) => logs as unknown as ReplayedVaultEvent[],
    readWalletGoals: async () => opts.walletGoals ?? [],
    readWalletCommitments: async () => opts.walletCommitments ?? [],
    findGoalByOnchainId: async (_wallet, id) => {
      goalLookups.push(id.toString());
      return opts.goals?.[id.toString()] ?? null;
    },
    findCommitmentByOnchainId: async (_wallet, id) => {
      commitmentLookups.push(id.toString());
      return opts.commitments?.[id.toString()] ?? null;
    },
    findChainTxByHash: async (_wallet, txHash) => opts.existing?.[txHash] ?? null,
    recordChainTx: async (wallet, input) => {
      const err = opts.recordError?.(input);
      if (err) throw err;
      recorded.push({ wallet, input });
      return { id: `new_${recorded.length}` };
    },
  };

  return { deps, ranges, recorded, goalLookups, commitmentLookups };
}

describe("reconcileChainTransactions — gating and range resolution", () => {
  it("reports an honest not-configured result and touches nothing", async () => {
    const h = harness({ configured: false, events: [event()] });

    const report = await reconcileChainTransactions(WALLET, {}, h.deps);

    expect(report.configured).toBe(false);
    expect(report.reason).toMatch(/chain not configured/);
    expect(report).toMatchObject({ fromBlock: null, toBlock: null, chunks: 0, eventsSeen: 0 });
    expect(h.ranges).toEqual([]);
    expect(h.recorded).toEqual([]);
  });

  it("defaults the range to [deployment block, chain head]", async () => {
    const h = harness({ deploymentBlock: 500n, head: 900n });

    const report = await reconcileChainTransactions(WALLET, {}, h.deps);

    expect(report.fromBlock).toBe("500");
    expect(report.toBlock).toBe("900");
    expect(h.ranges).toEqual([{ fromBlock: 500n, toBlock: 900n }]);
  });

  it("starts at block 0 when no deployment block is configured", async () => {
    const h = harness({ deploymentBlock: null, head: 42n });

    const report = await reconcileChainTransactions(WALLET, {}, h.deps);

    expect(report.fromBlock).toBe("0");
    expect(h.ranges[0]).toEqual({ fromBlock: 0n, toBlock: 42n });
  });

  it("clamps a requested toBlock to the chain head rather than inventing history", async () => {
    const h = harness({ head: 300n });

    const report = await reconcileChainTransactions(
      WALLET,
      { fromBlock: 100n, toBlock: 10_000n },
      h.deps,
    );

    expect(report.toBlock).toBe("300");
    expect(h.ranges).toEqual([{ fromBlock: 100n, toBlock: 300n }]);
  });

  it("reports an empty range instead of scanning backwards", async () => {
    const h = harness({ head: 1_000n });

    const report = await reconcileChainTransactions(
      WALLET,
      { fromBlock: 900n, toBlock: 800n },
      h.deps,
    );

    expect(report.reason).toMatch(/empty range/);
    expect(report.chunks).toBe(0);
    expect(h.ranges).toEqual([]);
  });

  it("chunks a wide range into tiled eth_getLogs queries", async () => {
    const h = harness({ head: 250n });

    const report = await reconcileChainTransactions(
      WALLET,
      { fromBlock: 0n, toBlock: 250n, chunkBlocks: 100n },
      h.deps,
    );

    expect(report.chunks).toBe(3);
    expect(h.ranges).toEqual([
      { fromBlock: 0n, toBlock: 99n },
      { fromBlock: 100n, toBlock: 199n },
      { fromBlock: 200n, toBlock: 250n },
    ]);
  });

  it("uses the default chunk size when none is given", async () => {
    const h = harness({ head: DEFAULT_RECONCILE_CHUNK_BLOCKS * 2n });

    await reconcileChainTransactions(WALLET, { fromBlock: 0n }, h.deps);

    expect(h.ranges).toHaveLength(3);
    expect(h.ranges[0]?.toBlock).toBe(DEFAULT_RECONCILE_CHUNK_BLOCKS - 1n);
  });

  it("rejects a non-positive chunk size", async () => {
    const h = harness();
    await expect(reconcileChainTransactions(WALLET, { chunkBlocks: 0n }, h.deps)).rejects.toThrow(
      /positive/,
    );
  });

  it("surfaces an RPC failure instead of reporting a successful empty scan", async () => {
    const h = harness({ logsError: new Error("eth_getLogs: range too wide") });

    await expect(reconcileChainTransactions(WALLET, {}, h.deps)).rejects.toThrow(/range too wide/);
    expect(h.recorded).toEqual([]);
  });

  it("collects events from every chunk it scans", async () => {
    const h = harness({
      head: 200n,
      events: new Map([
        ["0", [event({ txHash: TX(1) as `0x${string}`, blockNumber: 10n })]],
        ["100", [event({ txHash: TX(2) as `0x${string}`, blockNumber: 150n })]],
      ]),
      walletCommitments: [7n],
    });

    const report = await reconcileChainTransactions(
      WALLET,
      { fromBlock: 0n, chunkBlocks: 100n },
      h.deps,
    );

    expect(report.eventsSeen).toBe(2);
    expect(report.recorded).toBe(2);
    expect(h.recorded.map((r) => r.input.txHash)).toEqual([TX(1), TX(2)]);
  });
});

describe("reconcileChainTransactions — on-chain attribution", () => {
  it("claims an event whose commitment the vault says is this wallet's", async () => {
    const h = harness({ events: [event({ onchainCommitmentId: 7n })], walletCommitments: [7n] });

    const report = await reconcileChainTransactions(WALLET, {}, h.deps);

    expect(report.eventsForWallet).toBe(1);
    expect(report.recorded).toBe(1);
  });

  it("claims an event whose goal the vault says is this wallet's", async () => {
    const h = harness({
      events: [
        event({
          eventName: "MilestoneRegistered",
          kind: ChainTxKind.REGISTER_MILESTONE,
          actor: null,
          onchainGoalId: 5n,
          onchainCommitmentId: null,
        }),
      ],
      walletGoals: [5n],
    });

    const report = await reconcileChainTransactions(WALLET, {}, h.deps);

    expect(report.eventsForWallet).toBe(1);
    expect(h.recorded[0]?.input.kind).toBe(ChainTxKind.REGISTER_MILESTONE);
  });

  it("claims an event that names this wallet even on someone else's commitment", async () => {
    // A sponsor's RewardFunded: the transaction is theirs, the commitment is not.
    const h = harness({
      events: [
        event({
          eventName: "RewardFunded",
          kind: ChainTxKind.FUND_REWARD,
          actor: WALLET as Address,
          onchainCommitmentId: 99n,
        }),
      ],
      walletCommitments: [],
      walletGoals: [],
    });

    const report = await reconcileChainTransactions(WALLET, {}, h.deps);

    expect(report.eventsForWallet).toBe(1);
    expect(report.recorded).toBe(1);
  });

  it("matches the actor case-insensitively (nodes may return a checksummed address)", async () => {
    const h = harness({
      events: [event({ actor: WALLET.toUpperCase().replace("0X", "0x") as Address })],
    });

    const report = await reconcileChainTransactions(WALLET, {}, h.deps);

    expect(report.eventsForWallet).toBe(1);
  });

  it("never pulls a stranger's transaction into this wallet's index", async () => {
    const h = harness({
      events: [
        event({ txHash: TX(1) as `0x${string}`, actor: STRANGER, onchainCommitmentId: 42n }),
        event({
          txHash: TX(2) as `0x${string}`,
          actor: STRANGER,
          onchainGoalId: 77n,
          onchainCommitmentId: null,
        }),
        event({ txHash: TX(3) as `0x${string}`, actor: WALLET as Address }),
      ],
      // The vault's index says neither #42 nor goal #77 belongs to this wallet.
      walletCommitments: [7n],
      walletGoals: [5n],
    });

    const report = await reconcileChainTransactions(WALLET, {}, h.deps);

    expect(report.eventsSeen).toBe(3);
    expect(report.eventsForWallet).toBe(1);
    expect(h.recorded.map((r) => r.input.txHash)).toEqual([TX(3)]);
  });

  it("ignores events with no transaction kind and reports them as unmapped", async () => {
    const h = harness({
      events: [
        event({
          eventName: "AttestorUpdated",
          kind: null,
          actor: null,
          onchainCommitmentId: null,
          title: "Attestor rotated",
          detail: "Attestor changed.",
          txHash: TX(8) as `0x${string}`,
          blockNumber: 55n,
        }),
        event({ txHash: TX(9) as `0x${string}` }),
      ],
      walletCommitments: [7n],
    });

    const report = await reconcileChainTransactions(WALLET, {}, h.deps);

    expect(report.unmapped).toEqual([
      {
        eventName: "AttestorUpdated",
        txHash: TX(8),
        blockNumber: "55",
        detail: "Attestor changed.",
      },
    ]);
    expect(h.recorded.map((r) => r.input.txHash)).toEqual([TX(9)]);
  });

  it("collapses several events in one transaction to a single row", async () => {
    const h = harness({
      events: [
        event({
          eventName: "VerificationReceiptAccepted",
          kind: ChainTxKind.APPROVE_COMPLETION,
          actor: null,
          logIndex: 0,
          txHash: TX(5) as `0x${string}`,
        }),
        event({
          eventName: "CompletionApproved",
          kind: ChainTxKind.APPROVE_COMPLETION,
          actor: null,
          logIndex: 1,
          txHash: TX(5) as `0x${string}`,
        }),
      ],
      walletCommitments: [7n],
    });

    const report = await reconcileChainTransactions(WALLET, {}, h.deps);

    expect(report.eventsForWallet).toBe(2);
    expect(report.transactions).toHaveLength(1);
    expect(report.transactions[0]?.eventName).toBe("CompletionApproved");
    expect(h.recorded).toHaveLength(1);
  });
});

describe("reconcileChainTransactions — writes", () => {
  it("records a reconstructed row linked to the DB commitment and its goal", async () => {
    const h = harness({
      events: [event({ blockNumber: 321n })],
      walletCommitments: [7n],
      commitments: { "7": { id: "cmt_1", goalId: "goal_1" } },
    });

    const report = await reconcileChainTransactions(WALLET, {}, h.deps);

    expect(h.recorded).toEqual([
      {
        wallet: WALLET,
        input: {
          kind: ChainTxKind.LOCK_FUNDS,
          txHash: TX(1),
          title: "Principal locked",
          detail: "1000 wei locked for commitment #7.",
          goalId: "goal_1",
          commitmentId: "cmt_1",
          blockNumber: 321n,
        },
      },
    ]);
    expect(report.transactions[0]).toEqual({
      txHash: TX(1),
      kind: ChainTxKind.LOCK_FUNDS,
      eventName: "FundsLocked",
      blockNumber: "321",
      outcome: "recorded",
      goalId: "goal_1",
      commitmentId: "cmt_1",
      reason: null,
    });
  });

  it("still records an event whose on-chain id has no DB row, and says so", async () => {
    const h = harness({
      events: [event({ onchainCommitmentId: 7n, onchainGoalId: 5n })],
      walletCommitments: [7n],
      commitments: {},
      goals: {},
    });

    const report = await reconcileChainTransactions(WALLET, {}, h.deps);

    expect(h.recorded[0]?.input).not.toHaveProperty("commitmentId");
    expect(h.recorded[0]?.input).not.toHaveProperty("goalId");
    expect(report.transactions[0]?.outcome).toBe("recorded");
    expect(report.transactions[0]?.reason).toMatch(
      /no DB commitment linked to on-chain commitment #7; no DB goal linked to on-chain goal #5/,
    );
  });

  it("looks a repeated on-chain id up only once", async () => {
    const h = harness({
      events: [
        event({ txHash: TX(1) as `0x${string}`, onchainCommitmentId: 7n }),
        event({ txHash: TX(2) as `0x${string}`, onchainCommitmentId: 7n }),
        event({ txHash: TX(3) as `0x${string}`, onchainCommitmentId: 7n }),
      ],
      walletCommitments: [7n],
      commitments: { "7": { id: "cmt_1", goalId: "goal_1" } },
    });

    await reconcileChainTransactions(WALLET, {}, h.deps);

    expect(h.commitmentLookups).toEqual(["7"]);
  });

  it("leaves an already-complete row exactly as the app wrote it", async () => {
    const h = harness({
      events: [event()],
      walletCommitments: [7n],
      existing: {
        [TX(1)]: row({
          blockNumber: 100n,
          title: "Locked 1 BOT",
          detail: "app-written detail",
          commitmentId: "cmt_1",
          goalId: "goal_1",
        }),
      },
    });

    const report = await reconcileChainTransactions(WALLET, {}, h.deps);

    expect(h.recorded).toEqual([]);
    expect(report.alreadyIndexed).toBe(1);
    expect(report.recorded).toBe(0);
    expect(report.transactions[0]).toMatchObject({
      outcome: "already-indexed",
      goalId: "goal_1",
      commitmentId: "cmt_1",
    });
  });

  it("fills only the missing block number, carrying the app's own fields forward", async () => {
    const h = harness({
      events: [event({ blockNumber: 777n, title: "Principal locked", detail: "replayed detail" })],
      walletCommitments: [7n],
      commitments: { "7": { id: "cmt_other", goalId: "goal_other" } },
      existing: {
        [TX(1)]: row({
          blockNumber: null,
          title: "Locked 1 BOT",
          detail: "app-written detail",
          commitmentId: "cmt_1",
          goalId: "goal_1",
        }),
      },
    });

    const report = await reconcileChainTransactions(WALLET, {}, h.deps);

    // The replayed title/detail/links must NOT overwrite the richer app-written row.
    expect(h.recorded).toEqual([
      {
        wallet: WALLET,
        input: {
          kind: ChainTxKind.LOCK_FUNDS,
          txHash: TX(1),
          title: "Locked 1 BOT",
          detail: "app-written detail",
          goalId: "goal_1",
          commitmentId: "cmt_1",
          blockNumber: 777n,
        },
      },
    ]);
    expect(report.blockNumbersFilled).toBe(1);
    expect(report.transactions[0]?.outcome).toBe("block-number-filled");
  });

  it("omits fields the existing row has as null rather than sending null", async () => {
    const h = harness({
      events: [event({ blockNumber: 777n })],
      walletCommitments: [7n],
      existing: { [TX(1)]: row({ blockNumber: null, detail: null }) },
    });

    await reconcileChainTransactions(WALLET, {}, h.deps);

    const input = h.recorded[0]?.input as RecordInput;
    expect(input).not.toHaveProperty("detail");
    expect(input).not.toHaveProperty("goalId");
    expect(input).not.toHaveProperty("commitmentId");
    expect(input.blockNumber).toBe(777n);
  });

  it("reports a failing transaction honestly and keeps reconciling the rest", async () => {
    const h = harness({
      events: [
        event({ txHash: TX(1) as `0x${string}` }),
        event({ txHash: TX(2) as `0x${string}` }),
        event({ txHash: TX(3) as `0x${string}` }),
      ],
      walletCommitments: [7n],
      recordError: (input) =>
        input.txHash === TX(2)
          ? new Error("this transaction is already recorded under a different wallet")
          : null,
    });

    const report = await reconcileChainTransactions(WALLET, {}, h.deps);

    expect(report.recorded).toBe(2);
    expect(report.skipped).toBe(1);
    const failed = report.transactions.find((t) => t.txHash === TX(2));
    expect(failed?.outcome).toBe("skipped");
    expect(failed?.reason).toMatch(/already recorded under a different wallet/);
    expect(h.recorded.map((r) => r.input.txHash)).toEqual([TX(1), TX(3)]);
  });

  it("is safe to run twice — the second pass writes nothing new", async () => {
    const first = harness({
      events: [event({ blockNumber: 100n })],
      walletCommitments: [7n],
      commitments: { "7": { id: "cmt_1", goalId: "goal_1" } },
    });
    const firstReport = await reconcileChainTransactions(WALLET, {}, first.deps);
    expect(firstReport.recorded).toBe(1);

    // Replay the same range once the row exists (as the first pass left it).
    const written = first.recorded[0]?.input as RecordInput;
    const second = harness({
      events: [event({ blockNumber: 100n })],
      walletCommitments: [7n],
      commitments: { "7": { id: "cmt_1", goalId: "goal_1" } },
      existing: {
        [TX(1)]: row({
          txHash: written.txHash,
          kind: written.kind,
          title: written.title,
          detail: written.detail ?? null,
          goalId: written.goalId ?? null,
          commitmentId: written.commitmentId ?? null,
          blockNumber: written.blockNumber ?? null,
        }),
      },
    });

    const secondReport = await reconcileChainTransactions(WALLET, {}, second.deps);

    expect(second.recorded).toEqual([]);
    expect(secondReport.recorded).toBe(0);
    expect(secondReport.alreadyIndexed).toBe(1);
  });

  it("reports zeroes for a range with no vault activity", async () => {
    const h = harness({ head: 10n, events: [] });

    const report = await reconcileChainTransactions(WALLET, {}, h.deps);

    expect(report).toMatchObject({
      configured: true,
      eventsSeen: 0,
      eventsForWallet: 0,
      recorded: 0,
      alreadyIndexed: 0,
      skipped: 0,
      reason: null,
    });
    expect(report.transactions).toEqual([]);
  });
});
