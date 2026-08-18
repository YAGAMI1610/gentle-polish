import { CheckInFrequency, EvidenceType, GoalCategory } from "@prisma/client";

/**
 * §6.1 / §6.4 verification-strategy engine.
 *
 * A `VerificationStrategy` is HOW a category of goal gets checked: what to measure,
 * which evidence to ask for, a seed set of verification questions, how often to
 * check in, and the confidence bar to clear. Every strategy combines **at least two
 * independent signals** (§6.3) so no single self-reported number decides an outcome.
 *
 * This is a *registry*, not a hardcoded switch: built-ins are registered for all
 * eight `GoalCategory` values below, but a caller can `registerCategory(...)` to
 * override or extend without editing this file. `buildStrategy` falls back to the
 * GENERIC builder for anything unregistered, so it can never return undefined.
 */

export interface VerificationStrategy {
  goalId: string;
  /** Plain-language description of what is being measured. */
  measurement: string;
  /** The methods/signals combined to reach a verdict (≥2). */
  methods: string[];
  /** Evidence types the claimant is asked to provide. */
  requiredEvidence: EvidenceType[];
  /** Seed questions; the conversational model personalises these per goal. */
  verificationQuestions: string[];
  frequency: CheckInFrequency;
  /** 0–100 confidence bar a verification must clear. */
  confidenceThreshold: number;
  /** What to do when the primary evidence isn't available. */
  fallback: string;
}

export type StrategyBuilder = (goalId: string, goalText: string) => VerificationStrategy;

const registry = new Map<GoalCategory, StrategyBuilder>();

export function registerCategory(category: GoalCategory, builder: StrategyBuilder): void {
  registry.set(category, builder);
}

export function listCategories(): GoalCategory[] {
  return [...registry.keys()];
}

/**
 * Build the strategy for a goal's category, falling back to GENERIC if the
 * category has no registered builder. Throws only if even GENERIC is missing
 * (which the built-ins below guarantee it isn't).
 */
export function buildStrategy(
  goalId: string,
  category: GoalCategory,
  goalText: string,
): VerificationStrategy {
  const builder = registry.get(category) ?? registry.get(GoalCategory.GENERIC);
  if (!builder) {
    throw new Error("strategy engine misconfigured: no GENERIC fallback registered");
  }
  return builder(goalId, goalText);
}

// --- Built-in category strategies (each combines ≥2 signals) ---------------

registerCategory(GoalCategory.FITNESS_WEIGHT, (goalId) => ({
  goalId,
  measurement: "Body-weight / body-composition trend over time, not a single reading.",
  methods: ["scale_or_photo_evidence", "check_in_trend_consistency", "rate_of_change_plausibility"],
  requiredEvidence: [EvidenceType.PHOTO, EvidenceType.CONNECTED_TRACKER],
  verificationQuestions: [
    "How are you measuring this (same scale, same time of day)?",
    "What has the week-to-week trend looked like, not just today's number?",
    "Has anything changed in your routine that explains the pace of change?",
  ],
  frequency: CheckInFrequency.WEEKLY,
  confidenceThreshold: 75,
  fallback:
    "If a scale photo isn't available, combine a consistent check-in history with progress photos and plausibility of the rate of change.",
}));

registerCategory(GoalCategory.READING, (goalId) => ({
  goalId,
  measurement:
    "Books/chapters finished, corroborated by content the reader could only know from reading.",
  methods: ["content_recall_questions", "check_in_cadence_consistency"],
  requiredEvidence: [EvidenceType.TEXT, EvidenceType.SCREENSHOT],
  verificationQuestions: [
    "What was a specific idea or moment from what you just read that stuck with you?",
    "How does this section connect to what came before it?",
    "Roughly how much did you read since the last check-in?",
  ],
  frequency: CheckInFrequency.WEEKLY,
  confidenceThreshold: 70,
  fallback:
    "If no reading-app screenshot exists, rely on specific content questions plus a steady check-in cadence — perfect recall is not required, only genuine familiarity.",
}));

registerCategory(GoalCategory.RUNNING, (goalId) => ({
  goalId,
  measurement: "Distance and pace over the training period, cross-checked for plausibility.",
  methods: ["gps_or_tracker_evidence", "pace_distance_plausibility", "check_in_trend_consistency"],
  requiredEvidence: [EvidenceType.SCREENSHOT, EvidenceType.CONNECTED_TRACKER],
  verificationQuestions: [
    "What route or distance did you cover, and how did it feel compared to last time?",
    "What pace are you holding, and is that trending the way you expected?",
    "Any injuries or weather that affected the sessions?",
  ],
  frequency: CheckInFrequency.WEEKLY,
  confidenceThreshold: 70,
  fallback:
    "If tracker data isn't shared, combine described distance/pace for internal plausibility with a consistent check-in history.",
}));

registerCategory(GoalCategory.CODING, (goalId) => ({
  goalId,
  measurement: "Shipped work — commits/PRs — plus the ability to explain what was built.",
  methods: ["repo_activity_evidence", "implementation_recall_questions"],
  requiredEvidence: [EvidenceType.GITHUB, EvidenceType.SCREENSHOT],
  verificationQuestions: [
    "What did you build or fix since the last check-in, and where does it live?",
    "What was the trickiest part of the implementation and how did you handle it?",
    "What's the next thing you'll tackle?",
  ],
  frequency: CheckInFrequency.WEEKLY,
  confidenceThreshold: 70,
  fallback:
    "If a repo link isn't available, combine screenshots of the work with implementation questions only the author could answer.",
}));

registerCategory(GoalCategory.LEARNING, (goalId) => ({
  goalId,
  measurement: "Lessons/modules completed, corroborated by understanding of the material.",
  methods: ["progress_artifact_evidence", "concept_recall_questions"],
  requiredEvidence: [EvidenceType.SCREENSHOT, EvidenceType.TEXT],
  verificationQuestions: [
    "What concept did the last lesson cover, in your own words?",
    "Where did you get stuck, or what clicked that hadn't before?",
    "How would you apply what you learned?",
  ],
  frequency: CheckInFrequency.WEEKLY,
  confidenceThreshold: 70,
  fallback:
    "If a course-progress screenshot isn't available, rely on concept questions plus a steady cadence of check-ins.",
}));

registerCategory(GoalCategory.SAVING, (goalId) => ({
  goalId,
  measurement: "Balance/contribution trend moving toward the target over time.",
  methods: ["transaction_or_balance_evidence", "balance_trend_consistency"],
  requiredEvidence: [EvidenceType.TRANSACTION_DATA, EvidenceType.SCREENSHOT],
  verificationQuestions: [
    "How much did you set aside since the last check-in, and from where?",
    "Is the balance trending toward the target at the pace you planned?",
    "Did anything unexpected help or set you back?",
  ],
  frequency: CheckInFrequency.MONTHLY,
  confidenceThreshold: 70,
  fallback:
    "Prefer verifiable transaction/balance data; never ask for more private financial detail than needed. Fall back to redacted screenshots plus trend consistency.",
}));

registerCategory(GoalCategory.SPENDING, (goalId) => ({
  goalId,
  measurement: "Reduction in spend within a category, seen as a downward trend.",
  methods: ["transaction_category_evidence", "spend_trend_consistency"],
  requiredEvidence: [EvidenceType.TRANSACTION_DATA, EvidenceType.SCREENSHOT],
  verificationQuestions: [
    "What did spending in this category look like this period versus before?",
    "What changes did you make that brought it down?",
    "Were there any one-off expenses that skew the picture?",
  ],
  frequency: CheckInFrequency.MONTHLY,
  confidenceThreshold: 70,
  fallback:
    "Prefer categorised transaction data; fall back to redacted statements plus a consistent downward trend across check-ins.",
}));

registerCategory(GoalCategory.GENERIC, (goalId) => ({
  goalId,
  measurement:
    "Self-reported progress, corroborated by a consistent check-in history and specifics.",
  methods: ["check_in_cadence_consistency", "self_report_specificity"],
  requiredEvidence: [EvidenceType.TEXT, EvidenceType.PHOTO],
  verificationQuestions: [
    "What concretely did you do toward this since the last check-in?",
    "What can you point to that shows the progress?",
    "What's the next step?",
  ],
  frequency: CheckInFrequency.WEEKLY,
  confidenceThreshold: 70,
  fallback:
    "With no category-specific signal, combine the specificity of the self-report with the consistency of the check-in history; ask for a concrete artifact where possible.",
}));
