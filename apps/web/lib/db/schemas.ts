import { z } from "zod";
import {
  GoalMode,
  GoalStatus,
  GoalCategory,
  CheckInFrequency,
  EvidenceType,
  SignalLevel,
  VerificationStatus,
  ChainTxKind,
} from "@prisma/client";

/**
 * Validation schemas for the data-access boundary.
 *
 * Everything that crosses into the database is parsed here first. Per CLAUDE.md
 * rule 5, user- and AI-supplied text (check-in messages, evidence content) is
 * treated as DATA, never as instructions — these schemas bound its shape and
 * length; they never interpret it.
 *
 * Note: these validate SHAPE. They are not authorization. Ownership is enforced
 * in the repositories, which scope every query by the authenticated wallet.
 */

/**
 * EVM address (0x + 40 hex). Normalized to lowercase so a wallet maps to a
 * single stable primary key regardless of the casing a caller sends.
 *
 * This is format validation only. Full EIP-55 mixed-case checksum verification
 * (and deriving the address from a verified SIWE signature) arrives with viem
 * in build step 8; see LIMITATIONS.md. Lowercasing is a valid canonical form —
 * Ethereum addresses are case-insensitive at the protocol level — so it does
 * not fake a checksum, it just prevents key fragmentation.
 */
export const evmAddressSchema = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 40-hex-character EVM address")
  .transform((value) => value.toLowerCase());

/** Progress percentage, 0–100 inclusive. */
export const progressSchema = z.number().int().min(0).max(100);

/** sha256 digest as 64 lowercase hex chars (off-chain content hash). */
export const sha256HexSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{64}$/i, "must be a 64-character hex sha256 digest")
  .transform((value) => value.toLowerCase());

/**
 * An Ethereum transaction hash: 0x + 32 bytes (64 hex). Used to index REAL
 * broadcast transactions (`ChainTransaction`). This is a strict format guard —
 * per CLAUDE.md rule 1 a hash is only ever recorded after a real broadcast
 * returns one, never invented — so the shape must be a genuine 32-byte hash.
 */
export const txHashSchema = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte transaction hash")
  .transform((value) => value.toLowerCase());

/** Max uint256 — the on-chain range a wei amount must fit within. */
const MAX_UINT256 = 2n ** 256n - 1n;

/**
 * A wei amount as a base-10 integer string. Kept as a string (never a JS number)
 * because uint256 far exceeds `Number.MAX_SAFE_INTEGER`; the value is bounded to
 * the real uint256 range so a prepared transaction can never encode an amount the
 * contract couldn't hold. Stored into `Decimal(78,0)` columns and parsed to a
 * `bigint` for calldata encoding.
 */
export const weiSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, "must be a base-10 wei amount (digits only)")
  .refine((value) => BigInt(value) <= MAX_UINT256, "exceeds the uint256 range");

/** Opaque row id (Prisma cuid). Kept loose — just a non-empty bounded string. */
const idSchema = z.string().min(1).max(64);

export const createGoalInput = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(2000),
  mode: z.nativeEnum(GoalMode),
  category: z.nativeEnum(GoalCategory).default(GoalCategory.GENERIC),
  status: z.nativeEnum(GoalStatus).default(GoalStatus.ACTIVE),
  progress: progressSchema.default(0),
  // Human-readable cadence label shown in the UI (e.g. "Every weekday").
  // Required: the DB column is NOT NULL with no default.
  checkInFrequency: z.string().trim().min(1).max(100),
  // Structured cadence enum used by scheduling logic.
  checkInCadence: z.nativeEnum(CheckInFrequency).default(CheckInFrequency.WEEKLY),
  currentState: z.string().trim().max(2000).optional(),
  desiredState: z.string().trim().max(2000).optional(),
  successMetric: z.string().trim().max(2000).optional(),
  nextCheckIn: z.coerce.date().optional(),
  deadline: z.coerce.date().optional(),
});
export type CreateGoalInput = z.input<typeof createGoalInput>;

export const createCheckInInput = z.object({
  goalId: idSchema,
  message: z.string().trim().min(1).max(5000),
  milestoneId: idSchema.optional(),
});
export type CreateCheckInInput = z.input<typeof createCheckInInput>;

export const createEvidenceInput = z.object({
  goalId: idSchema,
  type: z.nativeEnum(EvidenceType),
  // Off-chain only. NEVER anchored on-chain — only its hash may be.
  contentText: z.string().max(20000).optional(),
  // Storage pointer (e.g. object-store key). NEVER anchored on-chain.
  storageKey: z.string().max(1024).optional(),
  mimeType: z.string().max(255).optional(),
  fileName: z.string().max(512).optional(),
  sizeBytes: z.number().int().min(0).optional(),
  contentHash: sha256HexSchema,
  checkInId: idSchema.optional(),
});
export type CreateEvidenceInput = z.input<typeof createEvidenceInput>;

/**
 * Decision-log entry (build-prompt §4/§10). Written by AI tool handlers to record
 * a decision that materially changed a goal's or a verification's state. This is
 * an append-only audit record, not a trust boundary — it is called internally
 * with an already-authenticated wallet — but its fields are still bounded here so
 * the whole DB boundary stays parsed in one place.
 *
 * Privacy (§10): `evidenceRef` holds an evidence id or content hash ONLY, never
 * raw evidence text — the raw bytes live solely in the Evidence table.
 */
export const createDecisionInput = z.object({
  toolName: z.string().trim().min(1).max(100),
  action: z.string().trim().min(1).max(100),
  decision: z.string().trim().min(1).max(5000),
  goalId: idSchema.optional(),
  milestoneId: idSchema.optional(),
  checkInId: idSchema.optional(),
  // 0–100 confidence, when the tool expresses one.
  confidence: z.number().int().min(0).max(100).optional(),
  // Evidence id or content hash only — NEVER raw evidence (§10).
  evidenceRef: z.string().trim().min(1).max(256).optional(),
  // Exact format is finalized in the verification/chain steps; bounded here.
  verificationHash: z.string().trim().min(1).max(128).optional(),
  modelVersion: z.string().trim().min(1).max(100).optional(),
});
export type CreateDecisionInput = z.input<typeof createDecisionInput>;

// ===========================================================================
// Build step 5 — remaining agent tools
// ===========================================================================

/** One milestone within a `createMilestones` batch. */
const milestoneItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  dueDate: z.coerce.date().optional(),
  // Explicit ordering; when omitted the repository falls back to array order.
  orderIndex: z.number().int().min(0).max(10000).optional(),
});

export const createMilestonesInput = z.object({
  goalId: idSchema,
  milestones: z.array(milestoneItemSchema).min(1).max(50),
});
export type CreateMilestonesInput = z.input<typeof createMilestonesInput>;

/** Schedule the next check-in (and optionally change the structured cadence). */
export const scheduleCheckInInput = z.object({
  goalId: idSchema,
  nextCheckIn: z.coerce.date(),
  cadence: z.nativeEnum(CheckInFrequency).optional(),
});
export type ScheduleCheckInInput = z.input<typeof scheduleCheckInInput>;

/**
 * Update goal progress and/or a milestone's done state. At least one of the two
 * must be supplied, and `milestoneDone` only makes sense alongside a `milestoneId`.
 */
export const updateProgressInput = z
  .object({
    goalId: idSchema,
    progress: progressSchema.optional(),
    milestoneId: idSchema.optional(),
    milestoneDone: z.boolean().optional(),
  })
  .refine((v) => v.progress !== undefined || v.milestoneId !== undefined, {
    message: "provide progress and/or a milestoneId to update",
  })
  .refine((v) => v.milestoneDone === undefined || v.milestoneId !== undefined, {
    message: "milestoneDone requires a milestoneId",
  });
export type UpdateProgressInput = z.input<typeof updateProgressInput>;

/**
 * Structured result of the AI's goal analysis (§5). The three coarse signals are
 * the model's read on the goal; the free-text `assessment` is what it tells the
 * user. The optional shaping slots (currentState/desiredState/successMetric) are
 * persisted back onto the goal when the analysis pins them down.
 */
export const analyzeGoalInput = z.object({
  goalId: idSchema,
  realism: z.nativeEnum(SignalLevel),
  safety: z.nativeEnum(SignalLevel),
  verifiability: z.nativeEnum(SignalLevel),
  assessment: z.string().trim().min(1).max(5000),
  currentState: z.string().trim().max(2000).optional(),
  desiredState: z.string().trim().max(2000).optional(),
  successMetric: z.string().trim().max(2000).optional(),
});
export type AnalyzeGoalInput = z.input<typeof analyzeGoalInput>;

/**
 * Persist a verification strategy for a goal (§6.1). `methods` and
 * `requiredEvidence` are free-text/enum-valued strings (the DB columns are
 * String[]); the strategy engine supplies category-appropriate defaults that the
 * AI may override.
 */
export const createVerificationStrategyInput = z.object({
  goalId: idSchema,
  measurement: z.string().trim().min(1).max(2000),
  methods: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
  requiredEvidence: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
  frequency: z.nativeEnum(CheckInFrequency).optional(),
  confidenceThreshold: z.number().int().min(0).max(100).optional(),
  fallbackPlan: z.string().trim().max(2000).optional(),
  rationale: z.string().trim().max(2000).optional(),
});
export type CreateVerificationStrategyInput = z.input<typeof createVerificationStrategyInput>;

/** Ask the user for evidence backing a goal's progress. */
export const requestEvidenceInput = z.object({
  goalId: idSchema,
  note: z.string().trim().max(2000).optional(),
});
export type RequestEvidenceInput = z.input<typeof requestEvidenceInput>;

/**
 * One weighted component of an accountability score. The score is always
 * server-computed (§10) — this shape is what gets logged, never a client-supplied
 * total.
 */
const scoreBreakdownItemSchema = z.object({
  label: z.string().trim().min(1).max(100),
  value: z.number(),
  weight: z.number(),
});

export const logAccountabilityScoreInput = z.object({
  score: z.number().int().min(0).max(100),
  breakdown: z.array(scoreBreakdownItemSchema).max(50),
  reason: z.string().trim().max(2000).optional(),
});
export type LogAccountabilityScoreInput = z.input<typeof logAccountabilityScoreInput>;

// ===========================================================================
// Build step 6 — verification records
// ===========================================================================

/**
 * A verification result to persist (§6). The status/confidence/sub-signals come
 * from the deterministic reality-check engine, NOT from trusting model text; the
 * `verificationHash` is the canonical §6.5 digest. `evidenceHash` is a content
 * hash only — never raw evidence (§9/§10).
 */
export const createVerificationRecordInput = z.object({
  goalId: idSchema,
  milestoneId: idSchema.optional(),
  checkInId: idSchema.optional(),
  status: z.nativeEnum(VerificationStatus),
  plausibility: z.nativeEnum(SignalLevel).optional(),
  evidenceQuality: z.nativeEnum(SignalLevel).optional(),
  consistency: z.nativeEnum(SignalLevel).optional(),
  confidence: z.number().int().min(0).max(100).default(0),
  reasoning: z.string().trim().min(1).max(5000),
  evidenceSummary: z.string().trim().max(5000).optional(),
  evidenceHash: sha256HexSchema.optional(),
  verificationHash: z.string().trim().min(1).max(128),
  modelVersion: z.string().trim().min(1).max(100).optional(),
});
export type CreateVerificationRecordInput = z.input<typeof createVerificationRecordInput>;

// ===========================================================================
// Build step 7 — evidence upload/storage pipeline
// ===========================================================================

/**
 * The metadata half of an evidence submission (build-prompt §7/§9). The payload
 * itself — raw bytes or `contentText` — is handled by the pipeline
 * (`lib/evidence/storeEvidence.ts`), not here: bytes are size-bounded in the
 * service and stored off-chain via `EvidenceStorage`, and only their sha256 hash
 * is persisted in an on-chain-eligible field. `contentText` is UNTRUSTED user data
 * (rule 5): bounded here, stored, never interpreted as an instruction.
 *
 * Exactly one payload kind is expected per call — `bytes` for a binary artifact
 * (photo/screenshot/file), or `contentText` for a text/reference claim — enforced
 * in the service where the bytes are in scope.
 */
export const storeEvidenceInput = z.object({
  goalId: idSchema,
  type: z.nativeEnum(EvidenceType),
  checkInId: idSchema.optional(),
  // UNTRUSTED. Off-chain only; never anchored on-chain (§9).
  contentText: z.string().max(20000).optional(),
  mimeType: z.string().trim().max(255).optional(),
  fileName: z.string().trim().max(512).optional(),
});
export type StoreEvidenceInput = z.input<typeof storeEvidenceInput>;

// ===========================================================================
// Build step 8 — chain-tx indexer
// ===========================================================================

/**
 * A REAL broadcast transaction to index (build-prompt §14.8, schema
 * `ChainTransaction`). Per CLAUDE.md rule 1 this is only ever written after a
 * broadcast returns a hash — never for a prepared-but-unsigned action — so
 * `txHash` is required and strictly shaped. `commitmentId`/`goalId`, when given,
 * are checked for wallet ownership in the repository. `blockNumber` is optional
 * because it is only known once the tx is mined (a later, idempotent update).
 */
export const recordChainTxInput = z.object({
  kind: z.nativeEnum(ChainTxKind),
  txHash: txHashSchema,
  commitmentId: idSchema.optional(),
  goalId: idSchema.optional(),
  blockNumber: z.bigint().nonnegative().optional(),
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(2000).optional(),
});
export type RecordChainTxInput = z.input<typeof recordChainTxInput>;

/**
 * Terms for a DRAFT commitment (build-prompt §3, §14.8). This writes an OFF-CHAIN
 * index row of intended terms so the user can review `releaseCondition` /
 * `failurePath` before they sign; it is NOT an on-chain action. Per CLAUDE.md
 * rule 1 the draft carries no `onchainCommitmentId` and no `txHash` — those are
 * filled only after the depositor's own wallet broadcasts `createCommitment`
 * (step 9). Amounts are wei strings (full uint256 precision).
 */
export const createDraftCommitmentInput = z.object({
  goalId: idSchema,
  principalWei: weiSchema,
  rewardWei: weiSchema.default("0"),
  deadline: z.coerce.date().optional(),
  // Duration in seconds; bounded to a sane 10-year ceiling (the contract enforces
  // its own MAX_GRACE_PERIOD — a larger value simply reverts on-chain, honestly).
  gracePeriodSeconds: z.number().int().min(0).max(315_360_000).default(0),
  confidenceThreshold: z.number().int().min(1).max(100).default(70),
  // Both are shown to the user PRE-SIGN (§3); required, human-readable.
  releaseCondition: z.string().trim().min(1).max(2000),
  failurePath: z.string().trim().min(1).max(2000),
});
export type CreateDraftCommitmentInput = z.input<typeof createDraftCommitmentInput>;
