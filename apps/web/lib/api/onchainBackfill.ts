import { ChainTxKind } from "@prisma/client";
import type { Hex, Log } from "viem";
import {
  isChainConfigured,
  parseCommitmentCreated,
  parseGoalRegistered,
  readTransactionReceipt,
  type CommitmentCreatedInfo,
  type GoalRegisteredInfo,
} from "@/lib/chain";
import { setOnchainCommitmentId, setOnchainGoalId } from "@/lib/db";

/**
 * On-chain-id back-fill (build-prompt §14.8 back-fill seam; LIMITATIONS §17, §19.2).
 *
 * Closes the seam that used to force `prepare*` to answer `{prepared:false}` for a
 * freshly-registered goal/commitment: when the indexer records a REGISTER_GOAL /
 * CREATE_COMMITMENT receipt, we re-read that receipt from the chain, decode the id the
 * vault *emitted* (`GoalRegistered.goalId` / `CommitmentCreated.commitmentId`), and
 * write it back onto the owning DB row via the wallet-scoped repositories.
 *
 * Trust model (CLAUDE.md rules 1–3): the id comes from the chain, never from the
 * client — the caller supplies only the tx hash and its own DB row id. The decoded log
 * must have been emitted by the configured vault (a same-signature event from any other
 * contract is ignored, see the parsers) AND its `owner`/`depositor` must be the
 * recording wallet, so a stranger's receipt can neither inject a foreign id nor rebind
 * someone else's row. Writing an id moves nothing; it only unblocks the depositor's own
 * future `prepare*` calldata, which their own wallet still has to sign.
 */

export interface OnchainBackfillInput {
  readonly kind: ChainTxKind;
  readonly txHash: string;
  readonly goalId: string | null;
  readonly commitmentId: string | null;
}

export interface OnchainBackfillResult {
  /** True only when this call is what first wrote the id (not an idempotent no-op). */
  readonly backfilled: boolean;
  readonly onchainGoalId: string | null;
  readonly onchainCommitmentId: string | null;
  /** Why nothing was written, when applicable (honest, never a fabricated success). */
  readonly reason: string | null;
}

/**
 * The impure boundaries the orchestrator needs, injected so the control flow (gating,
 * owner/depositor matching, first-writer reporting) is exercised always-on with in-test
 * doubles — the same seam idiom as `getAttestorClient(config, key)`. Production callers
 * omit `deps` and get the real chain reader / parsers / wallet-scoped DB setters.
 */
export interface OnchainBackfillDeps {
  isChainConfigured: () => boolean;
  readReceipt: (txHash: Hex) => Promise<{ readonly logs: readonly Log[] }>;
  parseGoalRegistered: (logs: readonly Log[]) => GoalRegisteredInfo | null;
  parseCommitmentCreated: (logs: readonly Log[]) => CommitmentCreatedInfo | null;
  setOnchainGoalId: (walletAddress: string, goalId: string, id: bigint) => Promise<number>;
  setOnchainCommitmentId: (
    walletAddress: string,
    commitmentId: string,
    id: bigint,
  ) => Promise<number>;
}

/**
 * Production wiring: the real functions, each already defaulting its own `ChainConfig`
 * via `readChainConfig()`, so the orchestrator never has to thread config around.
 */
export const defaultBackfillDeps: OnchainBackfillDeps = {
  isChainConfigured: () => isChainConfigured(),
  readReceipt: (txHash) => readTransactionReceipt(txHash),
  parseGoalRegistered: (logs) => parseGoalRegistered(logs),
  parseCommitmentCreated: (logs) => parseCommitmentCreated(logs),
  setOnchainGoalId,
  setOnchainCommitmentId,
};

const NOOP: OnchainBackfillResult = {
  backfilled: false,
  onchainGoalId: null,
  onchainCommitmentId: null,
  reason: null,
};

/**
 * Attempt to back-fill the on-chain id for a just-recorded transaction. Returns a
 * NOOP result for kinds/rows that carry no id to recover. Throws only on a genuine
 * chain-read failure (unknown/unmined hash, RPC down) — the caller (the record route)
 * treats that as best-effort and does not fail the already-successful index write.
 */
export async function backfillOnchainId(
  walletAddress: string,
  input: OnchainBackfillInput,
  deps: OnchainBackfillDeps = defaultBackfillDeps,
): Promise<OnchainBackfillResult> {
  const isGoal = input.kind === ChainTxKind.REGISTER_GOAL && input.goalId !== null;
  const isCommitment = input.kind === ChainTxKind.CREATE_COMMITMENT && input.commitmentId !== null;
  if (!isGoal && !isCommitment) return NOOP;

  if (!deps.isChainConfigured()) {
    return {
      ...NOOP,
      reason: "chain not configured — cannot read the receipt to back-fill the id",
    };
  }

  const receipt = await deps.readReceipt(input.txHash as Hex);

  if (isGoal) {
    const parsed = deps.parseGoalRegistered(receipt.logs);
    if (!parsed) {
      return { ...NOOP, reason: "no GoalRegistered event from the vault in this receipt" };
    }
    if (parsed.owner.toLowerCase() !== walletAddress.toLowerCase()) {
      return { ...NOOP, reason: "GoalRegistered owner does not match the recording wallet" };
    }
    const count = await deps.setOnchainGoalId(walletAddress, input.goalId as string, parsed.goalId);
    return {
      backfilled: count > 0,
      onchainGoalId: parsed.goalId.toString(),
      onchainCommitmentId: null,
      reason: count > 0 ? null : "goal already had an on-chain id (idempotent no-op)",
    };
  }

  const parsed = deps.parseCommitmentCreated(receipt.logs);
  if (!parsed) {
    return { ...NOOP, reason: "no CommitmentCreated event from the vault in this receipt" };
  }
  if (parsed.depositor.toLowerCase() !== walletAddress.toLowerCase()) {
    return { ...NOOP, reason: "CommitmentCreated depositor does not match the recording wallet" };
  }
  const count = await deps.setOnchainCommitmentId(
    walletAddress,
    input.commitmentId as string,
    parsed.commitmentId,
  );
  return {
    backfilled: count > 0,
    onchainGoalId: null,
    onchainCommitmentId: parsed.commitmentId.toString(),
    reason: count > 0 ? null : "commitment already had an on-chain id (idempotent no-op)",
  };
}
