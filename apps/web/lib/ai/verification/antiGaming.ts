/**
 * §7 anti-gaming detectors — pure, deterministic flags over *objective* facts.
 *
 * These never look at model output or free-text instructions. They operate on
 * hashes, numbers, and timestamps we already hold in the DB, so a claimant cannot
 * talk their way past them. The reality-check treats a raised flag as a hard gate
 * (see `realityCheck.ts`): an optimistic set of model-proposed signals cannot
 * override a `contradiction`/`impossibleDelta`/`duplicateEvidence` finding.
 */

/** Same evidence submitted again — its content hash matches earlier evidence. */
export function detectRepeatedEvidence(
  currentHash: string,
  priorHashes: readonly string[],
): boolean {
  return priorHashes.includes(currentHash);
}

export interface ImpossibleDeltaInput {
  previousProgress: number; // 0–100
  nextProgress: number; // 0–100
  elapsedDays: number;
  /** Max believable progress points per day for this goal. Default: unbounded. */
  maxPointsPerDay?: number;
}

/**
 * A progress jump that couldn't physically have happened: progress claimed with
 * no (or negative) time elapsed, or a per-day rate beyond what the goal allows.
 * Non-increasing deltas are never "impossible".
 */
export function detectImpossibleDelta(input: ImpossibleDeltaInput): boolean {
  const delta = input.nextProgress - input.previousProgress;
  if (delta <= 0) return false;
  if (input.elapsedDays <= 0) return true;
  if (input.maxPointsPerDay === undefined) return false;
  return delta / input.elapsedDays > input.maxPointsPerDay;
}

const GENERIC_ANSWERS = new Set([
  "yes",
  "no",
  "done",
  "i did it",
  "i did",
  "finished",
  "completed",
  "completed it",
  "yep",
  "yeah",
  "sure",
  "of course",
  "n/a",
  "na",
  "idk",
]);

/**
 * A verification answer carrying no verifiable specifics: empty, near-empty, or a
 * stock phrase. Used to cap answer quality, never to accuse.
 */
export function detectGenericAnswer(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length < 8) return true;
  return GENERIC_ANSWERS.has(t.replace(/[.!]+$/, ""));
}

export interface TimestampAnomalyInput {
  submittedAt: Date;
  /** When the activity is claimed to have happened, if provided. */
  claimedAt?: Date | null;
}

/** Evidence claimed to occur in the future relative to when it was submitted. */
export function detectTimestampAnomaly(input: TimestampAnomalyInput): boolean {
  if (!input.claimedAt) return false;
  return input.claimedAt.getTime() > input.submittedAt.getTime();
}
