/**
 * The achievement catalog (build item 7) — the SINGLE source of truth for what
 * achievements exist, their display metadata, and the earn PREDICATE (a real
 * per-wallet metric count crossing a threshold).
 *
 * Both the pure serializer (`deriveAchievements`) and the `AchievementDefinition`
 * catalog TABLE (`lib/db/repositories/achievements.ts`, synced from this constant)
 * derive from here, so the code predicate and the persisted metadata can never
 * drift. `earned` is ALWAYS a live function of real counts — this file stores
 * thresholds, never a per-user `earned` flag or timestamp (CLAUDE.md rule 1).
 */

/** Real per-wallet counts the earn predicate is evaluated against. */
export interface AchievementCounts {
  checkIns: number;
  verifiedMilestones: number;
  onChainCommitments: number;
  goalsCompleted: number;
  streakWeeks: number;
}

/** One catalog entry: display metadata + the `metric >= threshold` earn rule. */
export interface AchievementDefinitionSpec {
  id: string;
  name: string;
  description: string;
  /** Which `AchievementCounts` field this achievement is measured against. */
  metric: keyof AchievementCounts;
  /** The count at or above which the achievement is earned. */
  threshold: number;
}

export const ACHIEVEMENT_CATALOG: readonly AchievementDefinitionSpec[] = [
  {
    id: "first-check-in",
    name: "First honest check-in",
    description: "Logged your first check-in against a goal.",
    metric: "checkIns",
    threshold: 1,
  },
  {
    id: "ten-verified-milestones",
    name: "Ten verified milestones",
    description: "Ten milestones passed verification with evidence.",
    metric: "verifiedMilestones",
    threshold: 10,
  },
  {
    id: "skin-in-the-game",
    name: "Skin in the game",
    description: "Opened your first on-chain self-commitment.",
    metric: "onChainCommitments",
    threshold: 1,
  },
  {
    id: "finished-what-you-started",
    name: "Finished what you started",
    description: "Completed a goal all the way to its deadline.",
    metric: "goalsCompleted",
    threshold: 1,
  },
  {
    id: "season-of-consistency",
    name: "A season of consistency",
    description: "Twelve consecutive weeks with a check-in.",
    metric: "streakWeeks",
    threshold: 12,
  },
] as const;

/** Whether one catalog entry is earned for a given set of real counts. */
export function isAchievementEarned(
  def: AchievementDefinitionSpec,
  counts: AchievementCounts,
): boolean {
  return counts[def.metric] >= def.threshold;
}

/** The ids currently earned for a set of counts, in catalog order. */
export function earnedAchievementIds(counts: AchievementCounts): string[] {
  return ACHIEVEMENT_CATALOG.filter((def) => isAchievementEarned(def, counts)).map((def) => def.id);
}
