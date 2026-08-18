import {
  ChainTxKind,
  CommitmentStatus,
  GoalCategory,
  GoalMode,
  GoalStatus,
  CheckInFrequency,
  Prisma,
  VerificationStatus,
} from "@prisma/client";
import type {
  ChainTransaction,
  Commitment as CommitmentRow,
  DecisionLog,
  Goal as GoalRow,
  Milestone as MilestoneRow,
  VerificationRecord,
  VerificationStrategy,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  commitmentStatusToView,
  computeCheckInStreakWeeks,
  deriveAchievements,
  deriveVerificationStrategy,
  goalModeToView,
  goalStatusToView,
  parseStoredBreakdown,
  toActivityViews,
  toCommitmentView,
  toGoalView,
  toMilestoneView,
  toRewardView,
  toVerificationView,
  toWalletProfileView,
  verificationStatusToView,
  weiToTokenNumber,
} from "./serializers";

/**
 * Always-on unit tests for the Prisma → view serializers (build step 9, phase 2).
 * These are pure functions over in-memory rows: no DB, no chain, no clock beyond
 * values passed in. They lock the enum translation, wei conversion, reward-leg
 * derivation, activity merge order, streak maths and achievement derivation.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const dec = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);
const D = (iso: string): Date => new Date(iso);

// --- row factories (complete rows; override only what a test cares about) ----

function goalRow(overrides: Partial<GoalRow> = {}): GoalRow {
  return {
    id: "g1",
    walletAddress: "0xabc",
    title: "Read 12 books",
    summary: "A book a month",
    category: GoalCategory.READING,
    mode: GoalMode.ACCOUNTABILITY,
    status: GoalStatus.ACTIVE,
    progress: 25,
    currentState: null,
    desiredState: null,
    successMetric: null,
    checkInFrequency: "Weekly",
    checkInCadence: CheckInFrequency.WEEKLY,
    nextCheckIn: D("2026-08-20T00:00:00.000Z"),
    deadline: D("2026-12-31T00:00:00.000Z"),
    goalHash: null,
    onchainGoalId: null,
    createdAt: D("2026-08-01T00:00:00.000Z"),
    updatedAt: D("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function milestoneRow(overrides: Partial<MilestoneRow> = {}): MilestoneRow {
  return {
    id: "m1",
    goalId: "g1",
    title: "Book 1",
    dueDate: D("2026-09-01T00:00:00.000Z"),
    done: false,
    orderIndex: 0,
    milestoneRef: null,
    verificationHash: null,
    onchainConfidence: null,
    createdAt: D("2026-08-01T00:00:00.000Z"),
    updatedAt: D("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function verificationRow(overrides: Partial<VerificationRecord> = {}): VerificationRecord {
  return {
    id: "v1",
    goalId: "g1",
    walletAddress: "0xabc",
    milestoneId: "m1",
    checkInId: null,
    status: VerificationStatus.VERIFIED,
    plausibility: null,
    evidenceQuality: null,
    consistency: null,
    confidence: 88,
    reasoning: "Photo matches the goal.",
    evidenceSummary: "A photo of the finished book",
    evidenceHash: "0xhash",
    verificationHash: "0xvhash",
    modelVersion: null,
    anchoredTxHash: null,
    submittedAt: D("2026-08-10T00:00:00.000Z"),
    ...overrides,
  };
}

function strategyRow(overrides: Partial<VerificationStrategy> = {}): VerificationStrategy {
  return {
    id: "s1",
    goalId: "g1",
    measurement: "Books finished",
    methods: ["photo", "connected tracker"],
    requiredEvidence: ["a photo of the last page"],
    frequency: CheckInFrequency.WEEKLY,
    confidenceThreshold: 70,
    fallbackPlan: null,
    rationale: null,
    createdAt: D("2026-08-01T00:00:00.000Z"),
    updatedAt: D("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function commitmentRow(overrides: Partial<CommitmentRow> = {}): CommitmentRow {
  return {
    id: "c1",
    goalId: "g1",
    walletAddress: "0xabc",
    onchainCommitmentId: null,
    depositor: "0xabc",
    rewardFunder: null,
    principalWei: dec("20000000000000000000"), // 20 BOT
    rewardWei: dec("3000000000000000000"), // 3 BOT
    token: "BOT",
    deadline: D("2026-12-31T00:00:00.000Z"),
    gracePeriodSeconds: 0,
    confidenceThreshold: 70,
    status: CommitmentStatus.ACTIVE,
    rewardFunded: false,
    principalWithdrawn: false,
    rewardWithdrawn: false,
    verificationHash: null,
    attestedConfidence: null,
    releaseCondition: "Finish all 12 books by the deadline.",
    failurePath: "Principal returns in full; only the reward is forfeit.",
    txHash: null,
    createdAt: D("2026-08-01T00:00:00.000Z"),
    updatedAt: D("2026-08-05T00:00:00.000Z"),
    ...overrides,
  };
}

function decisionRow(overrides: Partial<DecisionLog> = {}): DecisionLog {
  return {
    id: "d1",
    walletAddress: "0xabc",
    goalId: "g1",
    milestoneId: null,
    checkInId: null,
    toolName: "verifyEvidence",
    action: "Reviewed evidence for Book 1",
    decision: "Verified with high confidence.",
    confidence: 88,
    evidenceRef: null,
    verificationHash: null,
    modelVersion: null,
    createdAt: D("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function chainTxRow(overrides: Partial<ChainTransaction> = {}): ChainTransaction {
  return {
    id: "t1",
    walletAddress: "0xabc",
    commitmentId: "c1",
    goalId: "g1",
    kind: ChainTxKind.LOCK_FUNDS,
    txHash: "0xdeadbeef",
    blockNumber: null,
    title: "Locked 20 BOT",
    detail: "Funds locked on BOT Chain testnet.",
    createdAt: D("2026-08-10T00:00:00.000Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe("enum translation", () => {
  it("maps goal mode", () => {
    expect(goalModeToView(GoalMode.ACCOUNTABILITY)).toBe("accountability");
    expect(goalModeToView(GoalMode.SELF_COMMITMENT)).toBe("self-commitment");
  });

  it("maps goal status", () => {
    expect(goalStatusToView(GoalStatus.ACTIVE)).toBe("active");
    expect(goalStatusToView(GoalStatus.COMPLETED)).toBe("completed");
    expect(goalStatusToView(GoalStatus.ABANDONED)).toBe("abandoned");
  });

  it("maps every verification status (rejected collapses to unverified)", () => {
    expect(verificationStatusToView(VerificationStatus.PENDING)).toBe("pending");
    expect(verificationStatusToView(VerificationStatus.VERIFIED)).toBe("verified");
    expect(verificationStatusToView(VerificationStatus.NEEDS_MORE_EVIDENCE)).toBe("needs-evidence");
    expect(verificationStatusToView(VerificationStatus.UNVERIFIED)).toBe("unverified");
    expect(verificationStatusToView(VerificationStatus.REJECTED_AS_INCONSISTENT)).toBe(
      "unverified",
    );
    // Exhaustive: no enum member falls through to undefined.
    for (const status of Object.values(VerificationStatus)) {
      expect(["pending", "verified", "needs-evidence", "unverified"]).toContain(
        verificationStatusToView(status),
      );
    }
  });

  it("collapses the 7-state commitment lifecycle into 3 view states", () => {
    expect(commitmentStatusToView(CommitmentStatus.NONE)).toBe("active");
    expect(commitmentStatusToView(CommitmentStatus.CREATED)).toBe("active");
    expect(commitmentStatusToView(CommitmentStatus.ACTIVE)).toBe("active");
    expect(commitmentStatusToView(CommitmentStatus.COMPLETION_REQUESTED)).toBe("active");
    expect(commitmentStatusToView(CommitmentStatus.APPROVED)).toBe("completed");
    expect(commitmentStatusToView(CommitmentStatus.CLOSED)).toBe("completed");
    expect(commitmentStatusToView(CommitmentStatus.CANCELLED)).toBe("cancelled");
    for (const status of Object.values(CommitmentStatus)) {
      expect(["active", "completed", "cancelled"]).toContain(commitmentStatusToView(status));
    }
  });
});

describe("weiToTokenNumber", () => {
  it("converts wei Decimal to a token number", () => {
    expect(weiToTokenNumber(dec("0"))).toBe(0);
    expect(weiToTokenNumber(dec("1000000000000000000"))).toBe(1);
    expect(weiToTokenNumber(dec("2500000000000000000"))).toBe(2.5);
    expect(weiToTokenNumber(dec("20000000000000000000"))).toBe(20);
  });
});

describe("toVerificationView", () => {
  it("maps status and coerces null summary/hash to empty strings", () => {
    const view = toVerificationView(
      verificationRow({
        status: VerificationStatus.NEEDS_MORE_EVIDENCE,
        evidenceSummary: null,
        evidenceHash: null,
      }),
    );
    expect(view.status).toBe("needs-evidence");
    expect(view.evidenceSummary).toBe("");
    expect(view.evidenceHash).toBe("");
    expect(view.submittedAt).toBe("2026-08-10T00:00:00.000Z");
    expect(view.confidence).toBe(88);
  });
});

describe("toMilestoneView", () => {
  it("attaches a verification only when one is supplied", () => {
    const withV = toMilestoneView(milestoneRow(), verificationRow());
    expect(withV.verification?.status).toBe("verified");

    const without = toMilestoneView(milestoneRow(), null);
    expect("verification" in without).toBe(false);
  });

  it("coerces a null due date to an empty string", () => {
    expect(toMilestoneView(milestoneRow({ dueDate: null })).dueDate).toBe("");
  });
});

describe("deriveVerificationStrategy", () => {
  it("returns [] for a null strategy", () => {
    expect(deriveVerificationStrategy(null)).toEqual([]);
  });

  it("unions methods + requiredEvidence, trimmed and deduped, order preserved", () => {
    const out = deriveVerificationStrategy(
      strategyRow({
        methods: ["photo", " tracker ", "photo"],
        requiredEvidence: ["tracker", "a receipt", "   "],
      }),
    );
    expect(out).toEqual(["photo", "tracker", "a receipt"]);
  });
});

describe("toGoalView", () => {
  it("maps scalars, strategy, per-milestone verification and optional commitment", () => {
    const milestones = [milestoneRow({ id: "m1" }), milestoneRow({ id: "m2", title: "Book 2" })];
    const byMilestone = new Map<string, VerificationRecord>([
      ["m1", verificationRow({ id: "v1", milestoneId: "m1" })],
    ]);
    const view = toGoalView(
      goalRow({ mode: GoalMode.SELF_COMMITMENT }),
      milestones,
      byMilestone,
      strategyRow(),
      { id: "c1" },
    );

    expect(view.mode).toBe("self-commitment");
    expect(view.status).toBe("active");
    expect(view.nextCheckIn).toBe("2026-08-20T00:00:00.000Z");
    expect(view.deadline).toBe("2026-12-31T00:00:00.000Z");
    expect(view.verificationStrategy).toEqual([
      "photo",
      "connected tracker",
      "a photo of the last page",
    ]);
    expect(view.commitmentId).toBe("c1");
    expect(view.milestones.find((m) => m.id === "m1")?.verification?.status).toBe("verified");
    expect("verification" in (view.milestones.find((m) => m.id === "m2") ?? {})).toBe(false);
  });

  it("omits commitmentId when there is no commitment; empty dates when null", () => {
    const view = toGoalView(
      goalRow({ nextCheckIn: null, deadline: null }),
      [],
      new Map(),
      null,
      null,
    );
    expect("commitmentId" in view).toBe(false);
    expect(view.nextCheckIn).toBe("");
    expect(view.deadline).toBe("");
    expect(view.verificationStrategy).toEqual([]);
  });
});

describe("toCommitmentView", () => {
  it("converts wei legs, maps status, and never invents a tx hash", () => {
    const view = toCommitmentView(commitmentRow(), "Read 12 books");
    expect(view.amountLocked).toBe(20);
    expect(view.reward).toBe(3);
    expect(view.status).toBe("active");
    expect(view.goalTitle).toBe("Read 12 books");
    expect(view.txHash).toBe("");
  });

  it("passes through a real broadcast hash", () => {
    const view = toCommitmentView(commitmentRow({ txHash: "0xreal" }), "Read 12 books");
    expect(view.txHash).toBe("0xreal");
  });
});

describe("toRewardView", () => {
  it("returns null when there is no reward leg", () => {
    expect(toRewardView(commitmentRow({ rewardWei: dec("0") }), "g")).toBeNull();
  });

  it("returns null while the reward is neither claimable nor claimed", () => {
    expect(toRewardView(commitmentRow({ status: CommitmentStatus.ACTIVE }), "g")).toBeNull();
  });

  it("is claimable when APPROVED and not withdrawn", () => {
    const reward = toRewardView(
      commitmentRow({ status: CommitmentStatus.APPROVED, rewardWithdrawn: false }),
      "Read 12 books",
    );
    expect(reward?.state).toBe("claimable");
    expect(reward?.amount).toBe(3);
    expect(reward?.id).toBe("c1-reward");
    expect(reward?.commitmentId).toBe("c1");
    expect(reward?.earnedAt).toBe("2026-08-05T00:00:00.000Z");
    expect(reward && "claimedAt" in reward).toBe(false);
  });

  it("is claimed once the reward has been withdrawn", () => {
    const reward = toRewardView(
      commitmentRow({ status: CommitmentStatus.CLOSED, rewardWithdrawn: true }),
      "Read 12 books",
    );
    expect(reward?.state).toBe("claimed");
    expect(reward?.claimedAt).toBe("2026-08-05T00:00:00.000Z");
  });
});

describe("toActivityViews", () => {
  it("merges AI decisions and chain txs newest-first, tagging each type", () => {
    const events = toActivityViews(
      [decisionRow({ id: "d1", createdAt: D("2026-08-01T00:00:00.000Z") })],
      [chainTxRow({ id: "t1", createdAt: D("2026-08-10T00:00:00.000Z"), detail: null })],
    );
    expect(events.map((e) => e.id)).toEqual(["t1", "d1"]);
    const chain = events.find((e) => e.id === "t1");
    const ai = events.find((e) => e.id === "d1");
    expect(chain?.type).toBe("chain");
    expect(chain?.txHash).toBe("0xdeadbeef");
    expect(chain?.detail).toBe(""); // null detail coerced
    expect(ai?.type).toBe("ai");
    expect(ai?.txHash).toBeUndefined();
  });
});

describe("toWalletProfileView", () => {
  it("marks connected, formats weights as percentages, and counts goals by status", () => {
    const view = toWalletProfileView({
      address: "0xabc",
      score: 74,
      breakdown: [
        { label: "Kept check-ins", value: 80, weight: 0.4 },
        { label: "Verification strength", value: 66, weight: 0.35 },
      ],
      goalStatuses: [
        GoalStatus.COMPLETED,
        GoalStatus.ACTIVE,
        GoalStatus.ACTIVE,
        GoalStatus.ABANDONED,
      ],
      currentStreak: 5,
    });
    expect(view.connected).toBe(true);
    expect(view.accountabilityScore).toBe(74);
    expect(view.scoreBreakdown[0]?.weight).toBe("40% of score");
    expect(view.scoreBreakdown[1]?.weight).toBe("35% of score");
    expect(view.goalsCompleted).toBe(1);
    expect(view.goalsActive).toBe(2);
    expect(view.goalsAbandoned).toBe(1);
    expect(view.currentStreak).toBe(5);
  });
});

describe("computeCheckInStreakWeeks", () => {
  const now = D("2026-08-18T12:00:00.000Z");
  const weeksAgo = (k: number) => new Date(now.getTime() - k * WEEK_MS);

  it("is 0 with no check-ins", () => {
    expect(computeCheckInStreakWeeks([], now)).toBe(0);
  });

  it("counts a run of consecutive weeks ending this week", () => {
    expect(computeCheckInStreakWeeks([weeksAgo(0), weeksAgo(1), weeksAgo(2)], now)).toBe(3);
  });

  it("counts just this week", () => {
    expect(computeCheckInStreakWeeks([weeksAgo(0)], now)).toBe(1);
  });

  it("allows a one-week grace (last check-in was last week)", () => {
    expect(computeCheckInStreakWeeks([weeksAgo(1), weeksAgo(2)], now)).toBe(2);
  });

  it("stops at the first gap", () => {
    expect(computeCheckInStreakWeeks([weeksAgo(0), weeksAgo(2), weeksAgo(3)], now)).toBe(1);
  });

  it("is 0 when the history is stale (nothing this week or last)", () => {
    expect(computeCheckInStreakWeeks([weeksAgo(2), weeksAgo(3)], now)).toBe(0);
  });
});

describe("deriveAchievements", () => {
  it("earns nothing at zero counts and never fabricates an earnedAt", () => {
    const list = deriveAchievements({
      checkIns: 0,
      verifiedMilestones: 0,
      onChainCommitments: 0,
      goalsCompleted: 0,
      streakWeeks: 0,
    });
    expect(list).toHaveLength(5);
    expect(list.every((a) => a.earned === false)).toBe(true);
    expect(list.every((a) => !("earnedAt" in a))).toBe(true);
  });

  it("crosses each threshold independently", () => {
    const list = deriveAchievements({
      checkIns: 1,
      verifiedMilestones: 10,
      onChainCommitments: 1,
      goalsCompleted: 1,
      streakWeeks: 12,
    });
    const earned = (id: string) => list.find((a) => a.id === id)?.earned;
    expect(earned("first-check-in")).toBe(true);
    expect(earned("ten-verified-milestones")).toBe(true);
    expect(earned("skin-in-the-game")).toBe(true);
    expect(earned("finished-what-you-started")).toBe(true);
    expect(earned("season-of-consistency")).toBe(true);
  });

  it("holds thresholds just below the line", () => {
    const list = deriveAchievements({
      checkIns: 0,
      verifiedMilestones: 9,
      onChainCommitments: 0,
      goalsCompleted: 0,
      streakWeeks: 11,
    });
    expect(list.find((a) => a.id === "ten-verified-milestones")?.earned).toBe(false);
    expect(list.find((a) => a.id === "season-of-consistency")?.earned).toBe(false);
  });
});

describe("parseStoredBreakdown", () => {
  it("parses a well-formed breakdown array", () => {
    expect(parseStoredBreakdown([{ label: "a", value: 50, weight: 0.4 }])).toEqual([
      { label: "a", value: 50, weight: 0.4 },
    ]);
  });

  it("returns [] for malformed input", () => {
    expect(parseStoredBreakdown({ nope: true })).toEqual([]);
    expect(parseStoredBreakdown([{ label: "a" }])).toEqual([]);
    expect(parseStoredBreakdown("not-an-array")).toEqual([]);
    expect(parseStoredBreakdown(null)).toEqual([]);
  });
});
