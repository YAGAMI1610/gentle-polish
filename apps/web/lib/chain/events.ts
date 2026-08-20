import { ChainTxKind } from "@prisma/client";
import { parseEventLogs, type Address, type Hex, type Log } from "viem";
import { commitmentVaultAbi } from "./abi";
import { readChainConfig, requireVaultAddress, type ChainConfig } from "./config";

/**
 * Historical vault-event replay — the pure half of the chain-sync reconciler
 * (LIMITATIONS.md item 12 / §19.2 "no historical event backfill").
 *
 * Before this, `ChainTransaction` rows existed only if the app happened to be running
 * when a transaction was broadcast (`POST /api/chain/record`). Anything broadcast while
 * the app was down, from another device, or straight from a wallet/`cast` was invisible
 * forever. This module decodes the vault's own past logs so that state can be
 * *reconstructed* instead of merely observed live; `lib/api/chainReconciler.ts` drives it.
 *
 * Two honesty rules (CLAUDE.md rule 1):
 *  - Only logs emitted by the configured `vaultAddress` are decoded. A same-signature
 *    event from any other contract is ignored, so a look-alike log cannot inject state.
 *  - Every event the contract can emit is accounted for. Ones with no `ChainTxKind`
 *    (admin rotations, escrow bookkeeping) map to `kind: null` and are *reported* as
 *    unmappable rather than silently dropped — `abi.test.ts` holds the ABI to the
 *    Solidity source so a newly added event cannot slip past unnoticed.
 */

/** One decoded vault log, flattened to what the transaction index needs. */
export interface ReplayedVaultEvent {
  readonly eventName: string;
  /** The transaction kind this event evidences, or null if it maps to none. */
  readonly kind: ChainTxKind | null;
  readonly txHash: Hex;
  readonly blockNumber: bigint;
  readonly logIndex: number;
  /** The address the event itself names (owner/depositor/funder/…), if any. */
  readonly actor: Address | null;
  readonly onchainGoalId: bigint | null;
  readonly onchainCommitmentId: bigint | null;
  readonly title: string;
  readonly detail: string;
}

/**
 * When one transaction emits several mapped events, this order decides which one becomes
 * the single `ChainTransaction` row (`txHash` is unique in the schema, so exactly one row
 * per transaction is possible). The only real case today is `approveCompletion`, which
 * emits `CompletionApproved` *and* `VerificationReceiptAccepted`: the former wins because
 * it carries the confidence the depositor's threshold was checked against.
 */
const PRIMARY_EVENT_ORDER: readonly string[] = [
  "CommitmentCreated",
  "GoalRegistered",
  "MilestoneRegistered",
  "FundsLocked",
  "RewardFunded",
  "CompletionRequested",
  "CompletionApproved",
  "VerificationReceiptAccepted",
  "PrincipalReleased",
  "RewardClaimed",
  "CommitmentCancelled",
];

/** Events that are real but have no `ChainTxKind` — reported, never silently dropped. */
export const UNMAPPED_VAULT_EVENTS: readonly string[] = [
  "AttestorUpdated",
  "AiVerifierUpdated",
  "RefundEscrowed",
  "EscrowWithdrawn",
];

type Decoded = ReturnType<typeof parseEventLogs<typeof commitmentVaultAbi>>[number];

/** wei as a plain integer string — no rounding, no unit guess (§8 amounts are exact). */
const wei = (amount: bigint): string => `${amount.toString()} wei`;

/**
 * Map one decoded vault event onto the transaction-index fields. Returns `kind: null`
 * for events that evidence no user transaction. Pure.
 */
function describe(
  log: Decoded,
): Omit<ReplayedVaultEvent, "eventName" | "txHash" | "blockNumber" | "logIndex"> {
  const none = { kind: null, actor: null, onchainGoalId: null, onchainCommitmentId: null };
  // Widened before the switch: the switch is exhaustive for the current ABI, so inside
  // `default:` TypeScript has narrowed `log` to `never` and the name is unreachable there.
  const eventName: string = log.eventName;
  switch (log.eventName) {
    case "GoalRegistered":
      return {
        kind: ChainTxKind.REGISTER_GOAL,
        actor: log.args.owner,
        onchainGoalId: log.args.goalId,
        onchainCommitmentId: null,
        title: "Goal registered on-chain",
        detail: `Goal #${log.args.goalId} anchored with hash ${log.args.goalHash}.`,
      };
    case "MilestoneRegistered":
      return {
        kind: ChainTxKind.REGISTER_MILESTONE,
        // No address in this event: attribution comes from who owns the goal.
        actor: null,
        onchainGoalId: log.args.goalId,
        onchainCommitmentId: null,
        title: "Milestone anchored on-chain",
        detail:
          `Milestone ${log.args.milestoneRef} on goal #${log.args.goalId} ` +
          `at confidence ${log.args.confidence}.`,
      };
    case "CommitmentCreated":
      return {
        kind: ChainTxKind.CREATE_COMMITMENT,
        actor: log.args.depositor,
        onchainGoalId: log.args.goalId,
        onchainCommitmentId: log.args.commitmentId,
        title: "Commitment created on-chain",
        detail:
          `Commitment #${log.args.commitmentId} on goal #${log.args.goalId}: ` +
          `principal ${wei(log.args.principalAmount)}, reward ${wei(log.args.rewardAmount)}, ` +
          `threshold ${log.args.confidenceThreshold}.`,
      };
    case "RewardFunded":
      return {
        kind: ChainTxKind.FUND_REWARD,
        actor: log.args.funder,
        onchainGoalId: null,
        onchainCommitmentId: log.args.commitmentId,
        title: "Reward funded",
        detail: `${wei(log.args.amount)} funded for commitment #${log.args.commitmentId}.`,
      };
    case "FundsLocked":
      return {
        kind: ChainTxKind.LOCK_FUNDS,
        actor: log.args.depositor,
        onchainGoalId: null,
        onchainCommitmentId: log.args.commitmentId,
        title: "Principal locked",
        detail: `${wei(log.args.amount)} locked for commitment #${log.args.commitmentId}.`,
      };
    case "CompletionRequested":
      return {
        kind: ChainTxKind.REQUEST_COMPLETION,
        actor: log.args.requester,
        onchainGoalId: null,
        onchainCommitmentId: log.args.commitmentId,
        title: "Completion requested",
        detail:
          `Verification hash ${log.args.verificationHash} anchored for ` +
          `commitment #${log.args.commitmentId}.`,
      };
    case "CompletionApproved":
      return {
        kind: ChainTxKind.APPROVE_COMPLETION,
        // The sender is the attestor, not the user: attribution is via the commitment.
        actor: null,
        onchainGoalId: null,
        onchainCommitmentId: log.args.commitmentId,
        title: "Completion approved",
        detail:
          `Commitment #${log.args.commitmentId} approved at confidence ` +
          `${log.args.confidence} (hash ${log.args.verificationHash}).`,
      };
    case "VerificationReceiptAccepted":
      return {
        kind: ChainTxKind.APPROVE_COMPLETION,
        actor: null,
        onchainGoalId: null,
        onchainCommitmentId: log.args.commitmentId,
        title: "Completion approved",
        detail:
          `Signed verification receipt ${log.args.receiptDigest} accepted for ` +
          `commitment #${log.args.commitmentId}.`,
      };
    case "PrincipalReleased":
      return {
        kind: ChainTxKind.RELEASE_PRINCIPAL,
        actor: log.args.depositor,
        onchainGoalId: null,
        onchainCommitmentId: log.args.commitmentId,
        title: "Principal released",
        detail: `${wei(log.args.amount)} withdrawn from commitment #${log.args.commitmentId}.`,
      };
    case "RewardClaimed":
      return {
        kind: ChainTxKind.CLAIM_REWARD,
        actor: log.args.depositor,
        onchainGoalId: null,
        onchainCommitmentId: log.args.commitmentId,
        title: "Reward claimed",
        detail: `${wei(log.args.amount)} claimed from commitment #${log.args.commitmentId}.`,
      };
    case "CommitmentCancelled":
      return {
        kind: ChainTxKind.CANCEL_COMMITMENT,
        actor: log.args.depositor,
        onchainGoalId: null,
        onchainCommitmentId: log.args.commitmentId,
        title: "Commitment cancelled",
        detail:
          `Commitment #${log.args.commitmentId} cancelled: principal ` +
          `${wei(log.args.principalReturned)} returned, reward ` +
          `${wei(log.args.rewardReturned)} returned.`,
      };
    // --- known, but no ChainTxKind exists for them (reported, not dropped) ---
    case "RefundEscrowed":
      return {
        ...none,
        actor: log.args.recipient,
        title: "Refund escrowed",
        detail: `${wei(log.args.amount)} escrowed for ${log.args.recipient} to pull.`,
      };
    case "EscrowWithdrawn":
      return {
        ...none,
        actor: log.args.recipient,
        title: "Escrow withdrawn",
        detail: `${wei(log.args.amount)} pulled by ${log.args.recipient}.`,
      };
    case "AttestorUpdated":
      return {
        ...none,
        title: "Attestor rotated",
        detail: `Attestor changed from ${log.args.previousAttestor} to ${log.args.newAttestor}.`,
      };
    case "AiVerifierUpdated":
      return {
        ...none,
        title: "AI verifier rotated",
        detail: `AI verifier changed from ${log.args.previousVerifier} to ${log.args.newVerifier}.`,
      };
    default:
      // Unreachable for the current ABI; kept so a newly added event degrades to an
      // honest "unmappable" report instead of a crash or a silent drop.
      return { ...none, title: eventName, detail: `Unmapped vault event ${eventName}.` };
  }
}

/**
 * Decode vault logs into replayable events, oldest first.
 *
 * Only logs from `config.vaultAddress` are decoded; pending logs (no block number or no
 * transaction hash yet) are skipped, since a `ChainTransaction` row must reference a real
 * mined transaction. Throws if no vault address is configured — replaying against "no
 * contract" would be meaningless rather than empty.
 */
export function replayVaultEvents(
  logs: readonly Log[],
  config: ChainConfig = readChainConfig(),
): ReplayedVaultEvent[] {
  const vault = requireVaultAddress(config).toLowerCase();
  const decoded = parseEventLogs({ abi: commitmentVaultAbi, logs: logs as Log[] });
  const events: ReplayedVaultEvent[] = [];
  for (const log of decoded) {
    if (log.address.toLowerCase() !== vault) continue;
    if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) continue;
    events.push({
      eventName: log.eventName,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      ...describe(log),
    });
  }
  return events.sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1,
  );
}

/**
 * Collapse replayed events to at most one per transaction hash — the schema allows
 * exactly one `ChainTransaction` per `txHash`. Events with no `ChainTxKind` never win a
 * slot, and a transaction that emitted *only* unmapped events yields no row at all.
 * Oldest transaction first.
 */
export function primaryEventPerTransaction(
  events: readonly ReplayedVaultEvent[],
): ReplayedVaultEvent[] {
  const rank = (e: ReplayedVaultEvent): number => {
    const i = PRIMARY_EVENT_ORDER.indexOf(e.eventName);
    return i === -1 ? PRIMARY_EVENT_ORDER.length : i;
  };
  const best = new Map<string, ReplayedVaultEvent>();
  for (const event of events) {
    if (event.kind === null) continue;
    const current = best.get(event.txHash);
    if (!current || rank(event) < rank(current)) best.set(event.txHash, event);
  }
  return [...best.values()].sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1,
  );
}

/**
 * Split a block range into inclusive windows of at most `chunkBlocks`. Public RPCs cap
 * how many blocks one `eth_getLogs` may span, so a full replay from the deployment block
 * has to be chunked; the windows tile the range exactly, with no gap and no overlap
 * (asserted in `events.test.ts`).
 */
export function blockRangeChunks(
  fromBlock: bigint,
  toBlock: bigint,
  chunkBlocks: bigint,
): Array<{ readonly fromBlock: bigint; readonly toBlock: bigint }> {
  if (chunkBlocks <= 0n) throw new Error("chunkBlocks must be positive");
  if (toBlock < fromBlock) return [];
  const out: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  for (let start = fromBlock; start <= toBlock; start += chunkBlocks) {
    const end = start + chunkBlocks - 1n;
    out.push({ fromBlock: start, toBlock: end > toBlock ? toBlock : end });
  }
  return out;
}
