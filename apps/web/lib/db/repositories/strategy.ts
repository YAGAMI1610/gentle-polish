import type { VerificationStrategy } from "@prisma/client";
import { CheckInFrequency } from "@prisma/client";
import { prisma } from "../client";
import { WalletScopeError } from "../errors";
import {
  createVerificationStrategyInput,
  evmAddressSchema,
  type CreateVerificationStrategyInput,
} from "../schemas";
import { indexByKey } from "./grouping";

/**
 * Wallet-scoped verification-strategy access (§6.1).
 *
 * A goal has at most one strategy (unique `goalId`), so writes upsert. Ownership
 * is enforced through the goal: a write to a goal this wallet doesn't own throws
 * `WalletScopeError`; a read of one returns null. The strategy's default
 * `frequency`/`confidenceThreshold` mirror the on-chain threshold default (70).
 */
export async function upsertVerificationStrategy(
  walletAddress: string,
  input: CreateVerificationStrategyInput,
): Promise<VerificationStrategy> {
  const addr = evmAddressSchema.parse(walletAddress);
  const parsed = createVerificationStrategyInput.parse(input);

  const goal = await prisma.goal.findFirst({
    where: { id: parsed.goalId, walletAddress: addr },
    select: { id: true },
  });
  if (!goal) {
    throw new WalletScopeError("cannot set a verification strategy on a goal that is not yours");
  }

  const fields = {
    measurement: parsed.measurement,
    methods: parsed.methods,
    requiredEvidence: parsed.requiredEvidence,
    frequency: parsed.frequency ?? CheckInFrequency.WEEKLY,
    confidenceThreshold: parsed.confidenceThreshold ?? 70,
    fallbackPlan: parsed.fallbackPlan ?? null,
    rationale: parsed.rationale ?? null,
  };

  return prisma.verificationStrategy.upsert({
    where: { goalId: parsed.goalId },
    create: { goalId: parsed.goalId, ...fields },
    update: fields,
  });
}

/** The strategy for a goal this wallet owns, or null (not owned / none set). */
export async function getVerificationStrategy(
  walletAddress: string,
  goalId: string,
): Promise<VerificationStrategy | null> {
  const addr = evmAddressSchema.parse(walletAddress);
  return prisma.verificationStrategy.findFirst({
    where: { goalId, goal: { walletAddress: addr } },
  });
}

/**
 * Strategies for a SET of goals this wallet owns, indexed by goalId — ONE query,
 * not one per goal (build-prompt §16 / item 6 N+1 fix). A goal has at most one
 * strategy (unique `goalId`), so this is a plain id→strategy map. Wallet-scoped
 * through the goal relation; an empty id list short-circuits with no query; a goal
 * with no strategy is absent from the map (caller defaults to null).
 */
export async function getVerificationStrategiesForGoals(
  walletAddress: string,
  goalIds: readonly string[],
): Promise<Map<string, VerificationStrategy>> {
  const addr = evmAddressSchema.parse(walletAddress);
  if (goalIds.length === 0) return new Map();
  const rows = await prisma.verificationStrategy.findMany({
    where: { goalId: { in: [...goalIds] }, goal: { walletAddress: addr } },
  });
  return indexByKey(rows, (s) => s.goalId);
}
