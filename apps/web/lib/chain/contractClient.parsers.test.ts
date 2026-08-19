import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex, type Log } from "viem";
import { commitmentVaultAbi } from "./abi";
import type { ChainConfig } from "./config";
import { parseCommitmentCreated, parseGoalRegistered } from "./contractClient";

/**
 * Always-on unit tests for the event-log parsers that power the on-chain-id back-fill
 * (build-prompt §14.8; LIMITATIONS §17). No network and no deployed contract: the pure
 * parsers are handed SYNTHETIC-but-REAL logs, encoded from the very ABI they decode
 * against (viem `encodeEventTopics` + `encodeAbiParameters`), so a drift in an event
 * signature fails here rather than silently mis-reading a real receipt.
 *
 * The security property under test is the vault-address filter (CLAUDE.md rules 1–2): a
 * byte-identical event emitted by ANY other contract in the same transaction must be
 * ignored, so a spoofed log can never inject a foreign goal/commitment id into a row.
 */

const VAULT = "0x00000000000000000000000000000000000000aa" as Address;
const IMPOSTOR = "0x00000000000000000000000000000000000000bb" as Address;
const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const DEPOSITOR = "0x2222222222222222222222222222222222222222" as Address;

const config: ChainConfig = {
  chainId: 968,
  rpcUrl: "http://127.0.0.1:0",
  explorerUrl: "http://127.0.0.1:0",
  vaultAddress: VAULT,
};

const ZERO32 = `0x${"00".repeat(32)}` as Hex;

function asLog(address: Address, topics: Hex[], data: Hex): Log {
  // Only address/topics/data drive parseEventLogs; the rest are realistic filler.
  return {
    address,
    topics,
    data,
    blockHash: ZERO32,
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: ZERO32,
    transactionIndex: 0,
    removed: false,
  } as unknown as Log;
}

function goalRegisteredLog(
  address: Address,
  goalId: bigint,
  owner: Address,
  goalHash: Hex = ZERO32,
): Log {
  const topics = encodeEventTopics({
    abi: commitmentVaultAbi,
    eventName: "GoalRegistered",
    args: { goalId, owner },
  });
  const data = encodeAbiParameters([{ name: "goalHash", type: "bytes32" }], [goalHash]);
  return asLog(address, topics as Hex[], data);
}

function commitmentCreatedLog(
  address: Address,
  commitmentId: bigint,
  goalId: bigint,
  depositor: Address,
): Log {
  const topics = encodeEventTopics({
    abi: commitmentVaultAbi,
    eventName: "CommitmentCreated",
    args: { commitmentId, goalId, depositor },
  });
  const data = encodeAbiParameters(
    [
      { name: "principalAmount", type: "uint256" },
      { name: "rewardAmount", type: "uint256" },
      { name: "deadline", type: "uint64" },
      { name: "gracePeriod", type: "uint64" },
      { name: "confidenceThreshold", type: "uint16" },
    ],
    [1_000n, 0n, 0n, 0n, 70],
  );
  return asLog(address, topics as Hex[], data);
}

describe("parseGoalRegistered", () => {
  it("decodes the goalId and owner from OUR vault's log", () => {
    const parsed = parseGoalRegistered([goalRegisteredLog(VAULT, 42n, OWNER)], config);
    expect(parsed?.goalId).toBe(42n);
    expect(parsed?.owner.toLowerCase()).toBe(OWNER.toLowerCase());
  });

  it("ignores a byte-identical event emitted by another contract (spoof-proof)", () => {
    expect(parseGoalRegistered([goalRegisteredLog(IMPOSTOR, 42n, OWNER)], config)).toBeNull();
  });

  it("returns null when no GoalRegistered log is present", () => {
    expect(parseGoalRegistered([], config)).toBeNull();
    // A CommitmentCreated log alone must not satisfy it.
    expect(
      parseGoalRegistered([commitmentCreatedLog(VAULT, 1n, 42n, DEPOSITOR)], config),
    ).toBeNull();
  });

  it("picks OUR vault's log even when an impostor emits the same event in the same tx", () => {
    const logs = [goalRegisteredLog(IMPOSTOR, 999n, OWNER), goalRegisteredLog(VAULT, 7n, OWNER)];
    expect(parseGoalRegistered(logs, config)?.goalId).toBe(7n);
  });
});

describe("parseCommitmentCreated", () => {
  it("decodes commitmentId, goalId and depositor from OUR vault's log", () => {
    const parsed = parseCommitmentCreated(
      [commitmentCreatedLog(VAULT, 5n, 42n, DEPOSITOR)],
      config,
    );
    expect(parsed?.commitmentId).toBe(5n);
    expect(parsed?.goalId).toBe(42n);
    expect(parsed?.depositor.toLowerCase()).toBe(DEPOSITOR.toLowerCase());
  });

  it("ignores a byte-identical event from another contract (spoof-proof)", () => {
    expect(
      parseCommitmentCreated([commitmentCreatedLog(IMPOSTOR, 5n, 42n, DEPOSITOR)], config),
    ).toBeNull();
  });

  it("returns null when no CommitmentCreated log is present", () => {
    expect(parseCommitmentCreated([], config)).toBeNull();
    expect(parseCommitmentCreated([goalRegisteredLog(VAULT, 42n, OWNER)], config)).toBeNull();
  });
});
