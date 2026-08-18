import { createHash } from "node:crypto";

/**
 * §6.5 verification hash.
 *
 * On milestone verification we anchor a hash — NEVER the raw evidence (§9). This
 * computes the canonical digest that `registerMilestone`/`approveCompletion` will
 * later put on-chain (build step 8): a sha256 over a fixed field order so the same
 * inputs always produce the same hash and an auditor can recompute it.
 *
 * Purity note: the caller passes `timestamp` in (an ISO string) rather than this
 * module reading the clock, so the hash is reproducible and unit-testable, and the
 * exact instant that was hashed is explicit in the audit trail.
 */
export interface VerificationHashInput {
  goalId: string;
  milestoneId?: string | null;
  /** The verification result being anchored (status + confidence, etc.). */
  result: unknown;
  /** ISO 8601 instant the verification was decided — supplied by the caller. */
  timestamp: string;
  /** sha256 of the off-chain evidence, if any. NEVER the evidence itself. */
  evidenceHash?: string | null;
  modelVersion?: string | null;
}

/** sha256 hex of the canonical JSON encoding of the verification (§6.5). */
export function computeVerificationHash(input: VerificationHashInput): string {
  // Fixed key order — the object is built explicitly, not spread, so the encoding
  // is stable regardless of the caller's property order.
  const canonical = JSON.stringify({
    goalId: input.goalId,
    milestoneId: input.milestoneId ?? null,
    result: input.result,
    timestamp: input.timestamp,
    evidenceHash: input.evidenceHash ?? null,
    modelVersion: input.modelVersion ?? null,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
