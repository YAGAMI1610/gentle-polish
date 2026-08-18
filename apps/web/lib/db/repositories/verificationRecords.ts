import type { VerificationRecord } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../client";
import { WalletScopeError } from "../errors";
import {
  createVerificationRecordInput,
  evmAddressSchema,
  type CreateVerificationRecordInput,
} from "../schemas";

/**
 * Wallet-scoped verification-record access (§6).
 *
 * A verification record is the persisted outcome of the deterministic reality
 * check — its status/confidence come from the engine, never from trusting model
 * text. Writing one verifies the goal is owned by this wallet (and that any
 * referenced milestone / check-in belongs to that same goal), throwing
 * `WalletScopeError` otherwise. `evidenceHash` is a content hash only; raw
 * evidence never lands here (§9/§10). This repository never moves funds or
 * touches on-chain state — anchoring is build step 8.
 */
export async function createVerificationRecord(
  walletAddress: string,
  input: CreateVerificationRecordInput,
): Promise<VerificationRecord> {
  const addr = evmAddressSchema.parse(walletAddress);
  const parsed = createVerificationRecordInput.parse(input);

  const goal = await prisma.goal.findFirst({
    where: { id: parsed.goalId, walletAddress: addr },
    select: { id: true },
  });
  if (!goal) {
    throw new WalletScopeError("cannot record a verification for a goal that is not yours");
  }

  if (parsed.milestoneId) {
    const milestone = await prisma.milestone.findFirst({
      where: { id: parsed.milestoneId, goalId: parsed.goalId },
      select: { id: true },
    });
    if (!milestone) {
      throw new WalletScopeError("milestone does not belong to that goal");
    }
  }

  if (parsed.checkInId) {
    const checkIn = await prisma.checkIn.findFirst({
      where: { id: parsed.checkInId, goalId: parsed.goalId, walletAddress: addr },
      select: { id: true },
    });
    if (!checkIn) {
      throw new WalletScopeError("check-in does not belong to that goal");
    }
  }

  const data: Prisma.VerificationRecordUncheckedCreateInput = {
    goalId: parsed.goalId,
    walletAddress: addr,
    milestoneId: parsed.milestoneId ?? null,
    checkInId: parsed.checkInId ?? null,
    status: parsed.status,
    plausibility: parsed.plausibility ?? null,
    evidenceQuality: parsed.evidenceQuality ?? null,
    consistency: parsed.consistency ?? null,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
    evidenceSummary: parsed.evidenceSummary ?? null,
    evidenceHash: parsed.evidenceHash ?? null,
    verificationHash: parsed.verificationHash,
    modelVersion: parsed.modelVersion ?? null,
  };

  return prisma.verificationRecord.create({ data });
}

/** Verification records for a goal this wallet owns, newest first (empty if not owned). */
export async function listVerificationRecords(
  walletAddress: string,
  goalId: string,
): Promise<VerificationRecord[]> {
  const addr = evmAddressSchema.parse(walletAddress);
  return prisma.verificationRecord.findMany({
    where: { goalId, walletAddress: addr },
    orderBy: { submittedAt: "desc" },
  });
}

/**
 * Every verification record for this wallet, across all its goals, newest first
 * (empty if none). Wallet-scoped — a caller only ever sees its own records. Used
 * to derive achievement counts (verified milestones) for the wallet profile.
 */
export async function listWalletVerifications(
  walletAddress: string,
): Promise<VerificationRecord[]> {
  const addr = evmAddressSchema.parse(walletAddress);
  return prisma.verificationRecord.findMany({
    where: { walletAddress: addr },
    orderBy: { submittedAt: "desc" },
  });
}

/** The most recent verification for a goal this wallet owns, or null. */
export async function getLatestVerification(
  walletAddress: string,
  goalId: string,
): Promise<VerificationRecord | null> {
  const addr = evmAddressSchema.parse(walletAddress);
  return prisma.verificationRecord.findFirst({
    where: { goalId, walletAddress: addr },
    orderBy: { submittedAt: "desc" },
  });
}

/**
 * Stamp a verification record with the hash of the REAL transaction that anchored
 * it on-chain (build step 8). Wallet-scoped; returns rows changed (0 if not owned
 * / not found). Per rule 1 this is only ever called with a hash a broadcast
 * actually returned — `anchoredTxHash` is null until then, never a placeholder.
 */
export async function setVerificationAnchor(
  walletAddress: string,
  verificationRecordId: string,
  anchoredTxHash: string,
): Promise<number> {
  const addr = evmAddressSchema.parse(walletAddress);
  const result = await prisma.verificationRecord.updateMany({
    where: { id: verificationRecordId, walletAddress: addr },
    data: { anchoredTxHash },
  });
  return result.count;
}
