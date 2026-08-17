import type { DecisionLog } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../client";
import { WalletScopeError } from "../errors";
import { createDecisionInput, evmAddressSchema, type CreateDecisionInput } from "../schemas";

/**
 * Wallet-scoped decision-log access (build-prompt §4/§10).
 *
 * The decision log is an append-only audit trail: whenever an AI tool materially
 * changes a goal's or a verification's state it records what it did and why. It
 * is written internally by the tool handlers, never from an untrusted request
 * boundary — `walletAddress` is the already-authenticated wallet from the tool
 * context, and per CLAUDE.md rule 3 nothing on this path holds a key or moves
 * funds; it only writes an audit row.
 *
 * Privacy (§10): only an evidence id / content hash is ever stored in
 * `evidenceRef`; the raw evidence text lives solely in the Evidence table.
 *
 * Wallet isolation: when a decision references a goal, that goal must belong to
 * the same wallet — a cross-wallet reference throws `WalletScopeError`, exactly
 * as the check-in and evidence repositories do. Reads are scoped by wallet, so a
 * caller can never see another wallet's decisions.
 */
export async function logDecision(
  walletAddress: string,
  input: CreateDecisionInput,
): Promise<DecisionLog> {
  const addr = evmAddressSchema.parse(walletAddress);
  const parsed = createDecisionInput.parse(input);

  // If this decision is about a goal, that goal must be owned by this wallet.
  // (goalId is a real FK with onDelete: SetNull, so the row must also exist.)
  if (parsed.goalId) {
    const goal = await prisma.goal.findFirst({
      where: { id: parsed.goalId, walletAddress: addr },
      select: { id: true },
    });
    if (!goal) {
      throw new WalletScopeError("cannot log a decision about a goal that is not yours");
    }
  }

  const data: Prisma.DecisionLogUncheckedCreateInput = {
    walletAddress: addr,
    toolName: parsed.toolName,
    action: parsed.action,
    decision: parsed.decision,
    goalId: parsed.goalId ?? null,
    milestoneId: parsed.milestoneId ?? null,
    checkInId: parsed.checkInId ?? null,
    confidence: parsed.confidence ?? null,
    evidenceRef: parsed.evidenceRef ?? null,
    verificationHash: parsed.verificationHash ?? null,
    modelVersion: parsed.modelVersion ?? null,
  };

  return prisma.decisionLog.create({ data });
}

/** Decision-log entries for this wallet, newest first (empty if none). */
export async function listDecisions(walletAddress: string): Promise<DecisionLog[]> {
  const addr = evmAddressSchema.parse(walletAddress);
  return prisma.decisionLog.findMany({
    where: { walletAddress: addr },
    orderBy: { createdAt: "desc" },
  });
}
