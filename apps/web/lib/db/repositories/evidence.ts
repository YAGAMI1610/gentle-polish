import type { Evidence } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../client";
import { WalletScopeError } from "../errors";
import { createEvidenceInput, evmAddressSchema, type CreateEvidenceInput } from "../schemas";

/**
 * Wallet-scoped evidence access.
 *
 * Evidence is the raw material a user submits to back a check-in. Per the
 * privacy model (build-prompt §9) the raw bytes / text live ONLY here in the
 * database, off-chain; only `contentHash` is ever anchored on-chain. Writing
 * evidence verifies goal (and optional check-in) ownership first and throws
 * `WalletScopeError` on a cross-wallet attempt. `contentText` is untrusted user
 * data: bounded here, stored, never interpreted (CLAUDE.md rule 5).
 */
export async function createEvidence(
  walletAddress: string,
  input: CreateEvidenceInput,
): Promise<Evidence> {
  const addr = evmAddressSchema.parse(walletAddress);
  const parsed = createEvidenceInput.parse(input);

  const goal = await prisma.goal.findFirst({
    where: { id: parsed.goalId, walletAddress: addr },
    select: { id: true },
  });
  if (!goal) {
    throw new WalletScopeError("cannot attach evidence to a goal that is not yours");
  }

  // A check-in, if referenced, must belong to that same goal and wallet.
  if (parsed.checkInId) {
    const checkIn = await prisma.checkIn.findFirst({
      where: { id: parsed.checkInId, goalId: parsed.goalId, walletAddress: addr },
      select: { id: true },
    });
    if (!checkIn) {
      throw new WalletScopeError("check-in does not belong to that goal");
    }
  }

  const data: Prisma.EvidenceUncheckedCreateInput = {
    goalId: parsed.goalId,
    walletAddress: addr,
    checkInId: parsed.checkInId ?? null,
    type: parsed.type,
    contentText: parsed.contentText ?? null,
    storageKey: parsed.storageKey ?? null,
    mimeType: parsed.mimeType ?? null,
    fileName: parsed.fileName ?? null,
    sizeBytes: parsed.sizeBytes ?? null,
    contentHash: parsed.contentHash,
  };

  return prisma.evidence.create({ data });
}

/** Evidence for a goal this wallet owns, newest first (empty if not owned). */
export async function listEvidence(walletAddress: string, goalId: string): Promise<Evidence[]> {
  const addr = evmAddressSchema.parse(walletAddress);
  return prisma.evidence.findMany({
    where: { goalId, walletAddress: addr },
    orderBy: { createdAt: "desc" },
  });
}
