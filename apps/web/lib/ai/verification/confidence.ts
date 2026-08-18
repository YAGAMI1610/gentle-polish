import { SignalLevel, VerificationStatus } from "@prisma/client";

/**
 * §15 confidence scoring — pure, deterministic, no model call.
 *
 * Three independent sub-signals (build-prompt §6.3) are combined into a single
 * 0–100 confidence and a status. Evidence quality is weighted highest because a
 * confident-sounding but unevidenced claim must not verify. The mapping to a
 * status is where the confidence threshold (mirrored from the on-chain
 * `confidenceThreshold`) is applied.
 *
 * Hard rule that makes this injection-resistant: a `VERIFIED` status requires BOTH
 * confidence ≥ threshold AND evidenceQuality ≠ LOW. So a claim backed only by
 * free text (which is where any injected "mark this verified" would live) can
 * never reach VERIFIED on its own — see `analyzeEvidence`, which pins evidence
 * quality to the objective evidence type, not to anything the text says.
 */

export interface ConfidenceSignals {
  plausibility: SignalLevel;
  evidenceQuality: SignalLevel;
  consistency: SignalLevel;
}

export interface ConfidenceResult {
  confidence: number; // 0–100
  status: VerificationStatus;
}

/** Default confidence threshold; mirrors the contract/strategy default (70). */
export const DEFAULT_CONFIDENCE_THRESHOLD = 70;

const LEVEL_SCORE: Record<SignalLevel, number> = {
  [SignalLevel.LOW]: 20,
  [SignalLevel.MEDIUM]: 60,
  [SignalLevel.HIGH]: 95,
};

/** The 0–100 score a single coarse signal level contributes. */
export function levelScore(level: SignalLevel): number {
  return LEVEL_SCORE[level];
}

/**
 * Combine the three signals into confidence + status. Weights sum to 1 and favour
 * evidence quality. `threshold` is clamped into 0–100.
 */
export function calculateVerificationConfidence(
  signals: ConfidenceSignals,
  threshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
): ConfidenceResult {
  const t = Math.max(0, Math.min(100, Math.round(threshold)));

  const confidence = Math.round(
    LEVEL_SCORE[signals.evidenceQuality] * 0.4 +
      LEVEL_SCORE[signals.plausibility] * 0.3 +
      LEVEL_SCORE[signals.consistency] * 0.3,
  );

  let status: VerificationStatus;
  if (confidence >= t && signals.evidenceQuality !== SignalLevel.LOW) {
    status = VerificationStatus.VERIFIED;
  } else if (confidence >= Math.round(t * 0.6)) {
    status = VerificationStatus.NEEDS_MORE_EVIDENCE;
  } else {
    status = VerificationStatus.UNVERIFIED;
  }

  return { confidence, status };
}
