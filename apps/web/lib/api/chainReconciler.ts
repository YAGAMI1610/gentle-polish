import { ChainTxKind, type ChainTransaction } from "@prisma/client";
import type { Address, Log } from "viem";
import {
  blockRangeChunks,
  isChainConfigured,
  primaryEventPerTransaction,
  readLatestBlockNumber,
  readVaultDeploymentBlock,
  readVaultLogs,
  readWalletCommitments,
  readWalletGoals,
  replayVaultEvents,
  type ReplayedVaultEvent,
} from "@/lib/chain";
import {
  getChainTxByHash,
  getCommitmentByOnchainId,
  getGoalByOnchainId,
  recordChainTx,
} from "@/lib/db";

/**
 * Chain-sync reconciler (LIMITATIONS.md item 12 / §19.2 "no historical event backfill").
 *
 * Before this, a `ChainTransaction` row existed only if the app happened to be running
 * when a transaction was broadcast (`POST /api/chain/record`, or an attestor tool). Any
 * transaction sent while the app was down, from another browser, or straight from a
 * wallet / `cast` was invisible to the index forever — the activity feed silently
 * under-reported real on-chain history. This replays the vault's own past logs and
 * reconstructs the missing rows.
 *
 * Trust model (CLAUDE.md rules 1–3):
 *  - Every fact comes from a mined log emitted by the configured vault. Nothing is
 *    inferred, defaulted, or invented; a range that yields no logs reports zero, and an
 *    RPC failure propagates instead of being reported as a successful empty scan.
 *  - Attribution is on-chain, not client-supplied: an event is this wallet's only if the
 *    vault's own `getWalletGoals` / `getWalletCommitments` index says the goal/commitment
 *    is theirs, or the event names their address (a sponsor's `RewardFunded`). So a
 *    replay can never pull a stranger's transaction into this wallet's feed.
 *  - It moves no funds and needs no key: `eth_getLogs` plus two view calls. Writes are
 *    confined to the wallet-scoped `recordChainTx` upsert.
 *  - Rows the app already wrote are NOT clobbered. A row missing only its block number is
 *    completed by re-recording its existing fields alongside the block number; a row that
 *    already has one is left exactly as it is and reported as `already-indexed`.
 *  - An event whose on-chain id has no DB row yet is still recorded, with null FKs and an
 *    honest reason, rather than being dropped or attached to a guessed row.
 */

/** What to scan. Everything is optional; the defaults replay the vault's whole history. */
export interface ChainReconcileRequest {
  /** First block to scan. Defaults to `COMMITMENT_VAULT_DEPLOYMENT_BLOCK`, else 0. */
  readonly fromBlock?: bigint | null;
  /** Last block to scan (inclusive). Defaults to the chain head. */
  readonly toBlock?: bigint | null;
  /** Blocks per `eth_getLogs` query — public RPCs cap the span. */
  readonly chunkBlocks?: bigint;
}

/** The outcome for one reconstructed transaction. */
export type ReconciledOutcome =
  | "recorded" // a row did not exist and was created from the log
  | "block-number-filled" // an existing row was missing its block number
  | "already-indexed" // an existing, complete row — left untouched
  | "skipped"; // could not be recorded; `reason` says why

export interface ReconciledTx {
  readonly txHash: string;
  readonly kind: ChainTxKind;
  readonly eventName: string;
  readonly blockNumber: string;
  readonly outcome: ReconciledOutcome;
  /** DB goal this was linked to, if the on-chain id resolved to one of this wallet's. */
  readonly goalId: string | null;
  readonly commitmentId: string | null;
  /** Why it was skipped, or what was left unlinked. Null when nothing needs saying. */
  readonly reason: string | null;
}

/** A real vault event that maps to no `ChainTxKind` (admin rotation, escrow bookkeeping). */
export interface UnmappedVaultEventReport {
  readonly eventName: string;
  readonly txHash: string;
  readonly blockNumber: string;
  readonly detail: string;
}

export interface ChainReconcileReport {
  readonly configured: boolean;
  /** Null when nothing was scanned (chain not configured, or an empty range). */
  readonly fromBlock: string | null;
  readonly toBlock: string | null;
  readonly chunks: number;
  /** Vault events decoded in the range, before attribution. */
  readonly eventsSeen: number;
  /** Of those, the ones this wallet owns or is named in. */
  readonly eventsForWallet: number;
  readonly transactions: readonly ReconciledTx[];
  readonly recorded: number;
  readonly blockNumbersFilled: number;
  readonly alreadyIndexed: number;
  readonly skipped: number;
  /** Events with no `ChainTxKind` — reported so nothing is silently dropped. */
  readonly unmapped: readonly UnmappedVaultEventReport[];
  /** Honest explanation when nothing could be scanned. */
  readonly reason: string | null;
}

/**
 * The impure boundaries, injected so the whole control flow — gating, range resolution,
 * chunking, attribution, dedupe, non-clobbering writes — is exercised always-on with
 * in-test doubles and no RPC or Postgres. Same seam idiom as `OnchainBackfillDeps`.
 */
export interface ChainReconcilerDeps {
  isChainConfigured: () => boolean;
  deploymentBlock: () => bigint | null;
  latestBlockNumber: () => Promise<bigint>;
  readVaultLogs: (range: { fromBlock: bigint; toBlock: bigint }) => Promise<readonly Log[]>;
  replayVaultEvents: (logs: readonly Log[]) => readonly ReplayedVaultEvent[];
  readWalletGoals: (wallet: Address) => Promise<readonly bigint[]>;
  readWalletCommitments: (wallet: Address) => Promise<readonly bigint[]>;
  findGoalByOnchainId: (wallet: string, onchainGoalId: bigint) => Promise<{ id: string } | null>;
  findCommitmentByOnchainId: (
    wallet: string,
    onchainCommitmentId: bigint,
  ) => Promise<{ id: string; goalId: string } | null>;
  findChainTxByHash: (wallet: string, txHash: string) => Promise<ChainTransaction | null>;
  recordChainTx: (
    wallet: string,
    input: {
      kind: ChainTxKind;
      txHash: string;
      title: string;
      detail?: string;
      goalId?: string;
      commitmentId?: string;
      blockNumber?: bigint;
    },
  ) => Promise<{ id: string }>;
}

/** Production wiring: the real chain reads, replay, and wallet-scoped repositories. */
export const defaultReconcilerDeps: ChainReconcilerDeps = {
  isChainConfigured: () => isChainConfigured(),
  deploymentBlock: () => readVaultDeploymentBlock(),
  latestBlockNumber: () => readLatestBlockNumber(),
  readVaultLogs: (range) => readVaultLogs(range),
  replayVaultEvents: (logs) => replayVaultEvents(logs),
  readWalletGoals: (wallet) => readWalletGoals(wallet),
  readWalletCommitments: (wallet) => readWalletCommitments(wallet),
  findGoalByOnchainId: (wallet, onchainGoalId) => getGoalByOnchainId(wallet, onchainGoalId),
  findCommitmentByOnchainId: (wallet, onchainCommitmentId) =>
    getCommitmentByOnchainId(wallet, onchainCommitmentId),
  findChainTxByHash: (wallet, txHash) => getChainTxByHash(wallet, txHash),
  recordChainTx: (wallet, input) => recordChainTx(wallet, input),
};

/** Default `eth_getLogs` span. Conservative: most public RPCs allow at least this. */
export const DEFAULT_RECONCILE_CHUNK_BLOCKS = 10_000n;

/** How many unmapped events to list before the report just counts them. */
const MAX_UNMAPPED_REPORTED = 20;

const EMPTY: Omit<ChainReconcileReport, "configured" | "reason"> = {
  fromBlock: null,
  toBlock: null,
  chunks: 0,
  eventsSeen: 0,
  eventsForWallet: 0,
  transactions: [],
  recorded: 0,
  blockNumbersFilled: 0,
  alreadyIndexed: 0,
  skipped: 0,
  unmapped: [],
};

/**
 * Replay the vault's past events and reconstruct this wallet's `ChainTransaction` rows.
 *
 * Safe to run repeatedly over the same range: `recordChainTx` is an idempotent upsert on
 * the unique `txHash`, and an already-complete row is never rewritten. Throws only if the
 * chain reads themselves fail — an honest "the scan did not happen" rather than a
 * half-truthful empty report. A per-transaction DB failure (e.g. the hash is already
 * indexed under another wallet) is caught, reported as `skipped` with its reason, and does
 * not abort the rest of the scan.
 */
export async function reconcileChainTransactions(
  walletAddress: string,
  request: ChainReconcileRequest = {},
  deps: ChainReconcilerDeps = defaultReconcilerDeps,
): Promise<ChainReconcileReport> {
  if (!deps.isChainConfigured()) {
    return {
      ...EMPTY,
      configured: false,
      reason:
        "chain not configured — COMMITMENT_VAULT_ADDRESS is unset, so there are no logs to replay",
    };
  }

  const chunkBlocks = request.chunkBlocks ?? DEFAULT_RECONCILE_CHUNK_BLOCKS;
  if (chunkBlocks <= 0n) throw new Error("chunkBlocks must be positive");

  const head = await deps.latestBlockNumber();
  const requestedFrom = request.fromBlock ?? deps.deploymentBlock() ?? 0n;
  const fromBlock = requestedFrom < 0n ? 0n : requestedFrom;
  const requestedTo = request.toBlock ?? head;
  // Never scan past the head: a range beyond it is not "no history", it is not mined yet.
  const toBlock = requestedTo > head ? head : requestedTo;

  if (toBlock < fromBlock) {
    return {
      ...EMPTY,
      configured: true,
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      reason: `empty range: fromBlock ${fromBlock} is after toBlock ${toBlock} (chain head ${head})`,
    };
  }

  const chunks = blockRangeChunks(fromBlock, toBlock, chunkBlocks);
  const events: ReplayedVaultEvent[] = [];
  for (const chunk of chunks) {
    const logs = await deps.readVaultLogs(chunk);
    events.push(...deps.replayVaultEvents(logs));
  }

  const unmapped = events
    .filter((e) => e.kind === null)
    .slice(0, MAX_UNMAPPED_REPORTED)
    .map((e) => ({
      eventName: e.eventName,
      txHash: e.txHash,
      blockNumber: e.blockNumber.toString(),
      detail: e.detail,
    }));

  // On-chain attribution: the vault's own per-wallet index is the authority on ownership.
  const wallet = walletAddress as Address;
  const [goalIds, commitmentIds] = await Promise.all([
    deps.readWalletGoals(wallet),
    deps.readWalletCommitments(wallet),
  ]);
  const ownedGoals = new Set(goalIds.map((id) => id.toString()));
  const ownedCommitments = new Set(commitmentIds.map((id) => id.toString()));
  const lowerWallet = walletAddress.toLowerCase();

  const isOurs = (e: ReplayedVaultEvent): boolean =>
    (e.onchainCommitmentId !== null && ownedCommitments.has(e.onchainCommitmentId.toString())) ||
    (e.onchainGoalId !== null && ownedGoals.has(e.onchainGoalId.toString())) ||
    e.actor?.toLowerCase() === lowerWallet;

  const mine = events.filter((e) => e.kind !== null && isOurs(e));
  const primary = primaryEventPerTransaction(mine);

  // One lookup per distinct on-chain id, not per event.
  const goalCache = new Map<string, { id: string } | null>();
  const commitmentCache = new Map<string, { id: string; goalId: string } | null>();

  const transactions: ReconciledTx[] = [];
  for (const event of primary) {
    transactions.push(await reconcileOne(walletAddress, event, deps, goalCache, commitmentCache));
  }

  const count = (outcome: ReconciledOutcome): number =>
    transactions.filter((t) => t.outcome === outcome).length;

  return {
    configured: true,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    chunks: chunks.length,
    eventsSeen: events.length,
    eventsForWallet: mine.length,
    transactions,
    recorded: count("recorded"),
    blockNumbersFilled: count("block-number-filled"),
    alreadyIndexed: count("already-indexed"),
    skipped: count("skipped"),
    unmapped,
    reason: null,
  };
}

/**
 * Link one replayed event to its DB rows and write it, without ever overwriting what the
 * app already recorded. Never throws: a repository failure becomes a `skipped` entry with
 * the real error message, so one bad hash cannot void the whole reconciliation.
 */
async function reconcileOne(
  walletAddress: string,
  event: ReplayedVaultEvent,
  deps: ChainReconcilerDeps,
  goalCache: Map<string, { id: string } | null>,
  commitmentCache: Map<string, { id: string; goalId: string } | null>,
): Promise<ReconciledTx> {
  const kind = event.kind as ChainTxKind; // callers filter out null kinds
  const base = {
    txHash: event.txHash,
    kind,
    eventName: event.eventName,
    blockNumber: event.blockNumber.toString(),
  };

  try {
    let commitmentId: string | null = null;
    let goalId: string | null = null;
    const unlinked: string[] = [];

    if (event.onchainCommitmentId !== null) {
      const key = event.onchainCommitmentId.toString();
      let row = commitmentCache.get(key);
      if (row === undefined) {
        row = await deps.findCommitmentByOnchainId(walletAddress, event.onchainCommitmentId);
        commitmentCache.set(key, row);
      }
      if (row) {
        commitmentId = row.id;
        goalId = row.goalId;
      } else {
        unlinked.push(`no DB commitment linked to on-chain commitment #${key}`);
      }
    }

    if (goalId === null && event.onchainGoalId !== null) {
      const key = event.onchainGoalId.toString();
      let row = goalCache.get(key);
      if (row === undefined) {
        row = await deps.findGoalByOnchainId(walletAddress, event.onchainGoalId);
        goalCache.set(key, row);
      }
      if (row) goalId = row.id;
      else unlinked.push(`no DB goal linked to on-chain goal #${key}`);
    }

    const existing = await deps.findChainTxByHash(walletAddress, event.txHash);

    if (existing && existing.blockNumber !== null) {
      return {
        ...base,
        outcome: "already-indexed",
        goalId: existing.goalId ?? null,
        commitmentId: existing.commitmentId ?? null,
        reason: null,
      };
    }

    if (existing) {
      // Complete the row the app wrote at broadcast time: carry ITS fields forward and add
      // only the block number, so a replay never overwrites the richer app-written detail.
      await deps.recordChainTx(walletAddress, {
        kind: existing.kind,
        txHash: existing.txHash,
        title: existing.title,
        ...(existing.detail === null ? {} : { detail: existing.detail }),
        ...(existing.goalId === null ? {} : { goalId: existing.goalId }),
        ...(existing.commitmentId === null ? {} : { commitmentId: existing.commitmentId }),
        blockNumber: event.blockNumber,
      });
      return {
        ...base,
        outcome: "block-number-filled",
        goalId: existing.goalId ?? null,
        commitmentId: existing.commitmentId ?? null,
        reason: null,
      };
    }

    await deps.recordChainTx(walletAddress, {
      kind,
      txHash: event.txHash,
      title: event.title,
      detail: event.detail,
      ...(goalId === null ? {} : { goalId }),
      ...(commitmentId === null ? {} : { commitmentId }),
      blockNumber: event.blockNumber,
    });
    return {
      ...base,
      outcome: "recorded",
      goalId,
      commitmentId,
      reason: unlinked.length > 0 ? `${unlinked.join("; ")} — recorded without that link` : null,
    };
  } catch (err) {
    return {
      ...base,
      outcome: "skipped",
      goalId: null,
      commitmentId: null,
      reason: err instanceof Error ? err.message : "unknown error while recording",
    };
  }
}
