/**
 * Client-safe wire DTOs for the write / AI / signing routes (build step 9, phase 3).
 *
 * These are the JSON shapes that cross the HTTP boundary. They live in their own
 * module (no server imports, no "use client") so BOTH the route handlers and the
 * browser hooks can share one source of truth for the contract without the client
 * bundle pulling in server-only code (`@/lib/db`, `@/lib/chain`).
 *
 * The prepared-transaction shape intentionally mirrors the AI tool's
 * `PreparedTxResult` (`lib/ai/tools/createCommitment.ts`): a fund operation is the
 * same prepare-only calldata whether the AI proposes it in a chat turn or a REST
 * route returns it — the DEPOSITOR's own wallet signs it, the backend never
 * broadcasts (CLAUDE.md rules 2–3). `value` is a base-10 wei string (uint256 does
 * not fit in a JS number).
 */
import type { AIMessage } from "@/lib/ai/provider";

/** An unsigned transaction for the user's wallet to sign. Backend never sends it. */
export interface PreparedTxDto {
  chainId: number;
  to: string;
  data: string;
  /** Wei to attach, as a base-10 string. Non-zero only for the payable deposit. */
  value: string;
}

/** The human-readable terms shown to the user PRE-SIGN (§3). */
export interface CommitmentTermsDto {
  principalWei: string;
  rewardWei: string;
  deadline: string | null;
  gracePeriodSeconds: number;
  confidenceThreshold: number;
  releaseCondition: string;
  failurePath: string;
}

/**
 * Result of POST /api/commitments — always saves the DRAFT terms for review, and
 * returns the `createCommitment` calldata when (and only when) the goal is already
 * registered on-chain. Honest gating, never fake calldata (rule 1).
 */
export interface PrepareCommitmentResult {
  goalId: string;
  configured: boolean;
  prepared: boolean;
  reason: string | null;
  draftCommitmentId: string | null;
  onchainGoalId: string | null;
  transaction: PreparedTxDto | null;
  terms: CommitmentTermsDto | null;
}

/**
 * Result of the prepare-lock / prepare-claim routes: the calldata for the user to
 * sign, or an honest reason it can't be prepared yet (chain not configured, or no
 * on-chain commitment exists). `transaction.value` carries the deposit for lock.
 */
export interface PrepareSignResult {
  commitmentId: string;
  configured: boolean;
  prepared: boolean;
  reason: string | null;
  onchainCommitmentId: string | null;
  transaction: PreparedTxDto | null;
}

/** POST /api/ai/turn request — the user's message plus any prior transcript. */
export interface AiTurnRequest {
  userMessage: string;
  history?: AIMessage[];
  toolPolicy?: string;
}

/** POST /api/ai/turn response — the runner's final text and full transcript. */
export interface AiTurnResponse {
  text: string | null;
  messages: AIMessage[];
  rounds: number;
}

/** POST /api/checkins response — the stored check-in pointer. */
export interface CheckInResult {
  id: string;
  goalId: string;
  message: string;
  milestoneId: string | null;
  createdAt: string;
}

/** POST /api/chain/record response — the indexed on-chain transaction row. */
export interface ChainRecordResult {
  id: string;
  kind: string;
  txHash: string;
  title: string;
  detail: string | null;
  commitmentId: string | null;
  goalId: string | null;
  createdAt: string;
}

/** POST /api/evidence response — the stored evidence pointer (no raw bytes). */
export interface EvidenceResult {
  id: string;
  goalId: string;
  type: string;
  contentHash: string;
  sizeBytes: number;
  mimeType: string | null;
  fileName: string | null;
  createdAt: string;
}

/**
 * POST /api/chain/record request — index a REAL broadcast (rule 1: only ever sent
 * by the client AFTER the wallet returns a hash). `blockNumber` is intentionally
 * omitted from the wire shape (a uint doesn't round-trip as JSON here); it is
 * filled server-side later if needed.
 */
export interface ChainRecordRequest {
  kind: string;
  txHash: string;
  title: string;
  commitmentId?: string;
  goalId?: string;
  detail?: string;
}

/**
 * POST /api/goals request. The server validates against `createGoalInput` and
 * stamps the wallet. `mode` is the Prisma `GoalMode` enum value
 * ("ACCOUNTABILITY" | "SELF_COMMITMENT"); `checkInFrequency` is the human label.
 */
export interface CreateGoalRequest {
  title: string;
  summary: string;
  mode: "ACCOUNTABILITY" | "SELF_COMMITMENT";
  checkInFrequency: string;
  category?: string;
  currentState?: string;
  desiredState?: string;
  successMetric?: string;
  deadline?: string;
}

/** POST /api/checkins request — a progress note against a goal this wallet owns. */
export interface CreateCheckInRequest {
  goalId: string;
  message: string;
  milestoneId?: string;
}

/**
 * POST /api/commitments request — the intended terms. `principalWei`/`rewardWei`
 * are base-10 wei strings; `releaseCondition` and `failurePath` are required and
 * shown to the user before signing (§3).
 */
export interface PrepareCommitmentRequest {
  goalId: string;
  principalWei: string;
  rewardWei?: string;
  deadline?: string;
  gracePeriodSeconds?: number;
  confidenceThreshold?: number;
  releaseCondition: string;
  failurePath: string;
}
