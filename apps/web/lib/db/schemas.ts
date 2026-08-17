import { z } from "zod";
import { GoalMode, GoalStatus, GoalCategory, CheckInFrequency, EvidenceType } from "@prisma/client";

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
