/**
 * Canonical view types for the CommitAI UI (build step 9).
 *
 * These are the shapes every screen and hook consumes, and the single source of
 * truth for them. The API serializers (`lib/api/serializers.ts`) map real Prisma
 * rows onto these types. Prisma enums are UPPER_SNAKE; the UI uses the
 * lowercase/hyphenated unions below, so the serializers translate at the
 * boundary.
 *
 * Nothing in this module touches the database, the chain, or the AI — it is
 * pure type declarations, safe to import from client and server alike.
 */

export type VerificationStatus = "verified" | "needs-evidence" | "unverified" | "pending";
export type GoalMode = "accountability" | "self-commitment";
export type GoalStatus = "active" | "completed" | "abandoned";

export interface Verification {
  id: string;
  submittedAt: string;
  status: VerificationStatus;
  confidence: number;
  reasoning: string;
  evidenceSummary: string;
  evidenceHash: string;
}

export interface Milestone {
  id: string;
  title: string;
  dueDate: string;
  done: boolean;
  verification?: Verification;
}

export interface Goal {
  id: string;
  title: string;
  summary: string;
  mode: GoalMode;
  status: GoalStatus;
  progress: number;
  nextCheckIn: string;
  checkInFrequency: string;
  deadline: string;
  verificationStrategy: string[];
  milestones: Milestone[];
  commitmentId?: string;
}

export interface Commitment {
  id: string;
  goalId: string;
  goalTitle: string;
  amountLocked: number;
  reward: number;
  token: string;
  status: "active" | "completed" | "cancelled";
  releaseCondition: string;
  failurePath: string;
  txHash: string;
  createdAt: string;
}

export interface Reward {
  id: string;
  goalTitle: string;
  commitmentId?: string;
  amount: number;
  token: string;
  state: "claimable" | "claimed";
  earnedAt: string;
  claimedAt?: string;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  earned: boolean;
  earnedAt?: string;
}

export interface ActivityEvent {
  id: string;
  type: "ai" | "chain";
  title: string;
  detail: string;
  at: string;
  txHash?: string;
}

export interface WalletProfile {
  address: string;
  connected: boolean;
  accountabilityScore: number;
  scoreBreakdown: { label: string; value: number; weight: string }[];
  goalsCompleted: number;
  goalsActive: number;
  goalsAbandoned: number;
  currentStreak: number;
}
