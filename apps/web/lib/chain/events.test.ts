import { describe, expect, it } from "vitest";
import { ChainTxKind } from "@prisma/client";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type AbiEvent,
  type AbiParameter,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { commitmentVaultAbi } from "./abi";
import type { ChainConfig } from "./config";
import {
  UNMAPPED_VAULT_EVENTS,
  blockRangeChunks,
  primaryEventPerTransaction,
  replayVaultEvents,
} from "./events";

/**
 * Historical event replay (LIMITATIONS.md item 12). Always-on: no RPC, no database.
 *
 * The logs here are REAL ABI-encoded logs — topics from `encodeEventTopics` and data from
 * `encodeAbiParameters` against the production ABI — so `parseEventLogs` genuinely decodes
 * them. A hand-written `{eventName, args}` object would have proved only that the switch
 * statement has the right cases, not that the vault's actual wire format maps onto them;
 * with real encoding, a wrong indexed/non-indexed split or a field-order slip fails here.
 */

const VAULT = "0x00000000000000000000000000000000000000aa" as Address;
const OTHER_CONTRACT = "0x00000000000000000000000000000000000000bb" as Address;
const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const SPONSOR = "0x2222222222222222222222222222222222222222" as Address;
const B32 = `0x${"ab".repeat(32)}` as Hex;
const TX = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}` as Hex;

const config: ChainConfig = {
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:0",
  explorerUrl: "http://explorer.invalid",
  vaultAddress: VAULT,
};

const eventAbi = (name: string): AbiEvent => {
  const item = commitmentVaultAbi.find((i) => i.type === "event" && i.name === name);
  if (!item) throw new Error(`no such event in the ABI: ${name}`);
  return item as AbiEvent;
};

interface LogOpts {
  eventName: string;
  args: Record<string, unknown>;
  address?: Address;
  blockNumber?: bigint | null;
  logIndex?: number | null;
  txHash?: Hex | null;
}

/** Build a genuinely ABI-encoded log the way a node would return it. */
function makeLog(opts: LogOpts): Log {
  const abiEvent = eventAbi(opts.eventName);
  const topics = encodeEventTopics({
    abi: commitmentVaultAbi,
    eventName: opts.eventName,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: opts.args as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  const nonIndexed = abiEvent.inputs.filter((i) => !i.indexed);
  const data =
    nonIndexed.length === 0
      ? "0x"
      : encodeAbiParameters(
          nonIndexed as readonly AbiParameter[],
          nonIndexed.map((i) => opts.args[i.name as string]),
        );
  return {
    address: opts.address ?? VAULT,
    topics,
    data,
    blockNumber: opts.blockNumber === undefined ? 100n : opts.blockNumber,
    transactionHash: opts.txHash === undefined ? TX(1) : opts.txHash,
    logIndex: opts.logIndex === undefined ? 0 : opts.logIndex,
    blockHash: B32,
    transactionIndex: 0,
    removed: false,
  } as Log;
}

/** A plausible value for any ABI type the vault's events use. */
function valueFor(param: AbiParameter): unknown {
  if (param.type === "address") return WALLET;
  if (param.type === "bytes32") return B32;
  if (param.type.startsWith("uint")) return 1n;
  throw new Error(`unhandled event parameter type in test: ${param.type}`);
}

describe("replayVaultEvents", () => {
  it("maps every lifecycle event to the right kind, ids and actor", () => {
    const logs = [
      makeLog({
        eventName: "GoalRegistered",
        args: { goalId: 5n, owner: WALLET, goalHash: B32 },
        blockNumber: 10n,
        logIndex: 0,
        txHash: TX(1),
      }),
      makeLog({
        eventName: "MilestoneRegistered",
        args: { goalId: 5n, milestoneRef: B32, verificationHash: B32, confidence: 88n },
        blockNumber: 11n,
        logIndex: 0,
        txHash: TX(2),
      }),
      makeLog({
        eventName: "CommitmentCreated",
        args: {
          commitmentId: 7n,
          goalId: 5n,
          depositor: WALLET,
          principalAmount: 1_000n,
          rewardAmount: 250n,
          deadline: 0n,
          gracePeriod: 3600n,
          confidenceThreshold: 70n,
        },
        blockNumber: 12n,
        logIndex: 0,
        txHash: TX(3),
      }),
      makeLog({
        eventName: "RewardFunded",
        args: { commitmentId: 7n, funder: SPONSOR, amount: 250n },
        blockNumber: 13n,
        logIndex: 0,
        txHash: TX(4),
      }),
      makeLog({
        eventName: "FundsLocked",
        args: { commitmentId: 7n, depositor: WALLET, amount: 1_000n },
        blockNumber: 14n,
        logIndex: 0,
        txHash: TX(5),
      }),
      makeLog({
        eventName: "CompletionRequested",
        args: { commitmentId: 7n, requester: WALLET, verificationHash: B32 },
        blockNumber: 15n,
        logIndex: 0,
        txHash: TX(6),
      }),
      makeLog({
        eventName: "PrincipalReleased",
        args: { commitmentId: 7n, depositor: WALLET, amount: 1_000n },
        blockNumber: 16n,
        logIndex: 0,
        txHash: TX(7),
      }),
      makeLog({
        eventName: "RewardClaimed",
        args: { commitmentId: 7n, depositor: WALLET, amount: 250n },
        blockNumber: 17n,
        logIndex: 0,
        txHash: TX(8),
      }),
      makeLog({
        eventName: "CommitmentCancelled",
        args: {
          commitmentId: 9n,
          depositor: WALLET,
          principalReturned: 1_000n,
          rewardReturned: 250n,
        },
        blockNumber: 18n,
        logIndex: 0,
        txHash: TX(9),
      }),
    ];

    const events = replayVaultEvents(logs, config);

    expect(
      events.map((e) => [e.eventName, e.kind, e.onchainGoalId, e.onchainCommitmentId, e.actor]),
    ).toEqual([
      ["GoalRegistered", ChainTxKind.REGISTER_GOAL, 5n, null, WALLET],
      ["MilestoneRegistered", ChainTxKind.REGISTER_MILESTONE, 5n, null, null],
      ["CommitmentCreated", ChainTxKind.CREATE_COMMITMENT, 5n, 7n, WALLET],
      // The FUNDER, not the depositor: a sponsor's transaction is theirs, not the user's.
      ["RewardFunded", ChainTxKind.FUND_REWARD, null, 7n, SPONSOR],
      ["FundsLocked", ChainTxKind.LOCK_FUNDS, null, 7n, WALLET],
      ["CompletionRequested", ChainTxKind.REQUEST_COMPLETION, null, 7n, WALLET],
      ["PrincipalReleased", ChainTxKind.RELEASE_PRINCIPAL, null, 7n, WALLET],
      ["RewardClaimed", ChainTxKind.CLAIM_REWARD, null, 7n, WALLET],
      ["CommitmentCancelled", ChainTxKind.CANCEL_COMMITMENT, null, 9n, WALLET],
    ]);
  });

  it("keeps amounts exact in wei — no rounding, no unit guess", () => {
    const huge = 123_456_789_012_345_678_901_234_567_890n;
    const [event] = replayVaultEvents(
      [
        makeLog({
          eventName: "FundsLocked",
          args: { commitmentId: 1n, depositor: WALLET, amount: huge },
        }),
      ],
      config,
    );
    expect(event?.detail).toBe(`${huge.toString()} wei locked for commitment #1.`);
  });

  it("attributes an approval to the commitment, never to the sending attestor", () => {
    const events = replayVaultEvents(
      [
        makeLog({
          eventName: "CompletionApproved",
          args: { commitmentId: 7n, verificationHash: B32, confidence: 91n },
        }),
      ],
      config,
    );
    expect(events[0]?.kind).toBe(ChainTxKind.APPROVE_COMPLETION);
    expect(events[0]?.actor).toBeNull();
    expect(events[0]?.detail).toContain("confidence 91");
  });

  it("ignores a same-signature log from any other contract", () => {
    const logs = [
      makeLog({
        eventName: "FundsLocked",
        args: { commitmentId: 7n, depositor: WALLET, amount: 1n },
        address: OTHER_CONTRACT,
        txHash: TX(1),
      }),
      makeLog({
        eventName: "FundsLocked",
        args: { commitmentId: 8n, depositor: WALLET, amount: 2n },
        address: VAULT,
        txHash: TX(2),
      }),
    ];
    const events = replayVaultEvents(logs, config);
    expect(events).toHaveLength(1);
    expect(events[0]?.onchainCommitmentId).toBe(8n);
  });

  it("skips a pending log with no block number or hash yet", () => {
    const logs = [
      makeLog({
        eventName: "FundsLocked",
        args: { commitmentId: 7n, depositor: WALLET, amount: 1n },
        blockNumber: null,
      }),
      makeLog({
        eventName: "FundsLocked",
        args: { commitmentId: 8n, depositor: WALLET, amount: 1n },
        txHash: null,
      }),
      makeLog({
        eventName: "FundsLocked",
        args: { commitmentId: 9n, depositor: WALLET, amount: 1n },
        logIndex: null,
      }),
    ];
    expect(replayVaultEvents(logs, config)).toEqual([]);
  });

  it("returns events oldest-first, ordered within a block by log index", () => {
    const logs = [
      makeLog({
        eventName: "FundsLocked",
        args: { commitmentId: 3n, depositor: WALLET, amount: 1n },
        blockNumber: 20n,
        logIndex: 5,
        txHash: TX(3),
      }),
      makeLog({
        eventName: "FundsLocked",
        args: { commitmentId: 1n, depositor: WALLET, amount: 1n },
        blockNumber: 10n,
        logIndex: 9,
        txHash: TX(1),
      }),
      makeLog({
        eventName: "FundsLocked",
        args: { commitmentId: 2n, depositor: WALLET, amount: 1n },
        blockNumber: 20n,
        logIndex: 1,
        txHash: TX(2),
      }),
    ];
    expect(replayVaultEvents(logs, config).map((e) => e.onchainCommitmentId)).toEqual([1n, 2n, 3n]);
  });

  it("throws instead of reporting an empty replay when no vault is configured", () => {
    expect(() => replayVaultEvents([], { ...config, vaultAddress: null })).toThrow(
      /chain not configured/,
    );
  });

  it("accounts for EVERY event in the ABI — mapped, or explicitly unmapped", () => {
    const abiEvents = commitmentVaultAbi.filter((i) => i.type === "event");
    expect(abiEvents.length).toBeGreaterThanOrEqual(15);

    for (const item of abiEvents) {
      const abiEvent = item as AbiEvent;
      const args = Object.fromEntries(
        abiEvent.inputs.map((p, i) => [p.name ?? `arg${i}`, valueFor(p)]),
      );
      const [event] = replayVaultEvents([makeLog({ eventName: abiEvent.name, args })], config);
      expect(event, abiEvent.name).toBeDefined();
      // No event may fall through to the "unmapped vault event" default branch.
      expect(event?.detail, abiEvent.name).not.toContain("Unmapped vault event");
      expect(event?.title, abiEvent.name).not.toBe("");
      if (event?.kind === null) {
        expect(UNMAPPED_VAULT_EVENTS, abiEvent.name).toContain(abiEvent.name);
      } else {
        expect(UNMAPPED_VAULT_EVENTS, abiEvent.name).not.toContain(abiEvent.name);
      }
    }
  });

  it("declares exactly the ABI events that carry no transaction kind", () => {
    const unmappedFromAbi = commitmentVaultAbi
      .filter((i) => i.type === "event")
      .map((i) => (i as AbiEvent).name)
      .filter((name) => {
        const abiEvent = eventAbi(name);
        const args = Object.fromEntries(
          abiEvent.inputs.map((p, i) => [p.name ?? `arg${i}`, valueFor(p)]),
        );
        return replayVaultEvents([makeLog({ eventName: name, args })], config)[0]?.kind === null;
      });
    expect([...unmappedFromAbi].sort()).toEqual([...UNMAPPED_VAULT_EVENTS].sort());
  });
});

describe("primaryEventPerTransaction", () => {
  it("keeps CompletionApproved over VerificationReceiptAccepted in the same transaction", () => {
    // approveCompletion emits both; the row must carry the confidence the threshold used.
    const logs = [
      makeLog({
        eventName: "VerificationReceiptAccepted",
        args: {
          commitmentId: 7n,
          verifier: SPONSOR,
          milestoneRef: B32,
          evidenceHash: B32,
          modelVersionHash: B32,
          receiptDigest: B32,
        },
        blockNumber: 30n,
        logIndex: 0,
        txHash: TX(42),
      }),
      makeLog({
        eventName: "CompletionApproved",
        args: { commitmentId: 7n, verificationHash: B32, confidence: 93n },
        blockNumber: 30n,
        logIndex: 1,
        txHash: TX(42),
      }),
    ];
    const primary = primaryEventPerTransaction(replayVaultEvents(logs, config));
    expect(primary).toHaveLength(1);
    expect(primary[0]?.eventName).toBe("CompletionApproved");
    expect(primary[0]?.kind).toBe(ChainTxKind.APPROVE_COMPLETION);
  });

  it("collapses a multi-event transaction to one row and keeps the earliest first", () => {
    const logs = [
      makeLog({
        eventName: "CommitmentCreated",
        args: {
          commitmentId: 7n,
          goalId: 5n,
          depositor: WALLET,
          principalAmount: 1n,
          rewardAmount: 0n,
          deadline: 0n,
          gracePeriod: 0n,
          confidenceThreshold: 70n,
        },
        blockNumber: 12n,
        logIndex: 1,
        txHash: TX(2),
      }),
      makeLog({
        eventName: "GoalRegistered",
        args: { goalId: 5n, owner: WALLET, goalHash: B32 },
        blockNumber: 12n,
        logIndex: 0,
        txHash: TX(2),
      }),
      makeLog({
        eventName: "FundsLocked",
        args: { commitmentId: 7n, depositor: WALLET, amount: 1n },
        blockNumber: 11n,
        logIndex: 0,
        txHash: TX(1),
      }),
    ];
    const primary = primaryEventPerTransaction(replayVaultEvents(logs, config));
    expect(primary.map((e) => [e.txHash, e.eventName])).toEqual([
      [TX(1), "FundsLocked"],
      // CommitmentCreated outranks GoalRegistered for the single row this tx gets.
      [TX(2), "CommitmentCreated"],
    ]);
  });

  it("yields no row for a transaction that emitted only unmapped events", () => {
    const logs = [
      makeLog({
        eventName: "RefundEscrowed",
        args: { recipient: WALLET, amount: 5n },
        txHash: TX(3),
      }),
      makeLog({
        eventName: "AttestorUpdated",
        args: { previousAttestor: WALLET, newAttestor: SPONSOR },
        txHash: TX(4),
      }),
    ];
    const events = replayVaultEvents(logs, config);
    expect(events).toHaveLength(2);
    expect(primaryEventPerTransaction(events)).toEqual([]);
  });
});

describe("blockRangeChunks", () => {
  it("tiles a range exactly — no gap, no overlap, inclusive ends", () => {
    const chunks = blockRangeChunks(100n, 350n, 100n);
    expect(chunks).toEqual([
      { fromBlock: 100n, toBlock: 199n },
      { fromBlock: 200n, toBlock: 299n },
      { fromBlock: 300n, toBlock: 350n },
    ]);
    // Every block in [100, 350] is covered exactly once.
    let covered = 0n;
    for (const c of chunks) {
      expect(c.fromBlock).toBeLessThanOrEqual(c.toBlock);
      covered += c.toBlock - c.fromBlock + 1n;
    }
    expect(covered).toBe(350n - 100n + 1n);
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i]?.fromBlock).toBe((chunks[i - 1]?.toBlock ?? 0n) + 1n);
    }
  });

  it("returns a single chunk when the range fits, and one per block at size 1", () => {
    expect(blockRangeChunks(7n, 9n, 1_000n)).toEqual([{ fromBlock: 7n, toBlock: 9n }]);
    expect(blockRangeChunks(7n, 9n, 1n)).toEqual([
      { fromBlock: 7n, toBlock: 7n },
      { fromBlock: 8n, toBlock: 8n },
      { fromBlock: 9n, toBlock: 9n },
    ]);
  });

  it("covers a single-block range and rejects a non-positive chunk size", () => {
    expect(blockRangeChunks(5n, 5n, 10n)).toEqual([{ fromBlock: 5n, toBlock: 5n }]);
    expect(blockRangeChunks(6n, 5n, 10n)).toEqual([]);
    expect(() => blockRangeChunks(1n, 10n, 0n)).toThrow(/positive/);
    expect(() => blockRangeChunks(1n, 10n, -5n)).toThrow(/positive/);
  });
});
