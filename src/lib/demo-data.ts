/**
 * DEMO DATA ONLY.
 * Every value in this file is placeholder content used by the hooks in
 * src/hooks/*. When the real backend lands, delete this file and let the
 * hooks fetch instead — no component imports this module directly.
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

export const demoGoals: Goal[] = [
  {
    id: "g-read-12",
    title: "Read 12 books this year",
    summary: "One book a month, mixed fiction and non-fiction, with short written reflections.",
    mode: "self-commitment",
    status: "active",
    progress: 58,
    nextCheckIn: "2026-08-19",
    checkInFrequency: "Weekly, Wednesdays",
    deadline: "2026-12-31",
    verificationStrategy: [
      "Short written reflection on what you read",
      "Follow-up questions about specifics only a reader would know",
      "Optional photo of the finished book or e-reader progress",
    ],
    commitmentId: "c-001",
    milestones: [
      {
        id: "m-1",
        title: "Books 1-3 finished",
        dueDate: "2026-03-31",
        done: true,
        verification: {
          id: "v-1",
          submittedAt: "2026-03-29",
          status: "verified",
          confidence: 94,
          reasoning:
            "Your reflections referenced plot details and page-specific arguments consistent with the books listed.",
          evidenceSummary: "3 written reflections, 1 photo",
          evidenceHash: "0x9f31…c4a7",
        },
      },
      {
        id: "m-2",
        title: "Books 4-6 finished",
        dueDate: "2026-06-30",
        done: true,
        verification: {
          id: "v-2",
          submittedAt: "2026-06-28",
          status: "verified",
          confidence: 88,
          reasoning:
            "Two of three reflections were detailed. The third was brief but your follow-up answers held up.",
          evidenceSummary: "3 written reflections",
          evidenceHash: "0x41bd…7e02",
        },
      },
      {
        id: "m-3",
        title: "Book 7 finished",
        dueDate: "2026-08-31",
        done: false,
        verification: {
          id: "v-3",
          submittedAt: "2026-08-14",
          status: "needs-evidence",
          confidence: 52,
          reasoning:
            "Your summary stayed general. A couple of specifics from the second half would settle it.",
          evidenceSummary: "1 written reflection",
          evidenceHash: "0x77aa…19c3",
        },
      },
      { id: "m-4", title: "Books 8-12 finished", dueDate: "2026-12-31", done: false },
    ],
  },
  {
    id: "g-run-5k",
    title: "Run a sub-25 minute 5K",
    summary: "Three runs a week, one of them intervals. Currently at 27:40.",
    mode: "accountability",
    status: "active",
    progress: 34,
    nextCheckIn: "2026-08-17",
    checkInFrequency: "Twice weekly",
    deadline: "2026-11-15",
    verificationStrategy: [
      "Connected fitness tracker data",
      "Screenshot of run summary",
      "Questions about route, weather and effort",
    ],
    milestones: [
      {
        id: "m-r1",
        title: "Four consistent training weeks",
        dueDate: "2026-07-20",
        done: true,
        verification: {
          id: "v-r1",
          submittedAt: "2026-07-19",
          status: "verified",
          confidence: 91,
          reasoning: "Tracker data showed 11 of 12 planned runs with consistent pacing.",
          evidenceSummary: "Connected tracker export",
          evidenceHash: "0x2c98…4410",
        },
      },
      { id: "m-r2", title: "Time trial under 26:30", dueDate: "2026-09-10", done: false },
      { id: "m-r3", title: "Time trial under 25:00", dueDate: "2026-11-15", done: false },
    ],
  },
  {
    id: "g-ship-side",
    title: "Ship the side project v1",
    summary: "A small budgeting tool. Public repo, weekly commits, launch by October.",
    mode: "accountability",
    status: "active",
    progress: 71,
    nextCheckIn: "2026-08-16",
    checkInFrequency: "Weekly, Sundays",
    deadline: "2026-10-05",
    verificationStrategy: ["Connected GitHub activity", "Description of what shipped this week"],
    milestones: [
      {
        id: "m-s1",
        title: "Core data model done",
        dueDate: "2026-06-15",
        done: true,
        verification: {
          id: "v-s1",
          submittedAt: "2026-06-14",
          status: "verified",
          confidence: 96,
          reasoning: "Repo activity matched the described work within the stated window.",
          evidenceSummary: "GitHub commit history",
          evidenceHash: "0x5ef1…b3d8",
        },
      },
      { id: "m-s2", title: "Public beta", dueDate: "2026-09-01", done: false },
      { id: "m-s3", title: "v1 launch", dueDate: "2026-10-05", done: false },
    ],
  },
];

export const demoCommitments: Commitment[] = [
  {
    id: "c-001",
    goalId: "g-read-12",
    goalTitle: "Read 12 books this year",
    amountLocked: 20,
    reward: 3,
    token: "BOT",
    status: "active",
    releaseCondition:
      "Your 20 BOT returns to you when 12 books are verified before 31 Dec 2026. The 3 BOT reward is added on top.",
    failurePath:
      "If the goal isn't met, your 20 BOT is still returned — you simply forfeit the reward. CommitAI never keeps your principal.",
    txHash: "0xa41f9c2b7de85031aa64c9f0b7e3d5218c40ab77",
    createdAt: "2026-01-08",
  },
  {
    id: "c-002",
    goalId: "g-old-writing",
    goalTitle: "Write 30 days straight",
    amountLocked: 10,
    reward: 1.5,
    token: "BOT",
    status: "completed",
    releaseCondition: "Principal plus reward released after 30 verified daily entries.",
    failurePath: "Principal would have been returned in full at the deadline regardless.",
    txHash: "0x77b3ca90ef4412d6058a1cbb2f9d3e7740aa6f11",
    createdAt: "2026-04-02",
  },
  {
    id: "c-003",
    goalId: "g-old-spanish",
    goalTitle: "Daily Spanish for 8 weeks",
    amountLocked: 15,
    reward: 2,
    token: "BOT",
    status: "cancelled",
    releaseCondition: "Principal plus reward after 8 verified weeks.",
    failurePath: "You cancelled in week 3. Principal was returned the same day, no penalty.",
    txHash: "0x1029dd44be7761ff30ca8b0e5d92a3417f8c0b25",
    createdAt: "2026-05-19",
  },
];

export const demoRewards: Reward[] = [
  {
    id: "r-1",
    goalTitle: "Write 30 days straight",
    commitmentId: "c-002",
    amount: 1.5,
    token: "BOT",
    state: "claimable",
    earnedAt: "2026-05-04",
  },
  {
    id: "r-2",
    goalTitle: "Read 12 books this year — halfway milestone",
    commitmentId: "c-001",
    amount: 0.5,
    token: "BOT",
    state: "claimable",
    earnedAt: "2026-06-30",
  },
  {
    id: "r-3",
    goalTitle: "Four consistent training weeks",
    amount: 0.25,
    token: "BOT",
    state: "claimed",
    earnedAt: "2026-07-19",
    claimedAt: "2026-07-21",
  },
];

export const demoAchievements: Achievement[] = [
  {
    id: "a-1",
    name: "First honest check-in",
    description: "You reported a week that didn't go to plan instead of skipping it.",
    earned: true,
    earnedAt: "2026-02-11",
  },
  {
    id: "a-2",
    name: "Ten verified milestones",
    description: "Ten milestones passed verification with evidence.",
    earned: true,
    earnedAt: "2026-06-28",
  },
  {
    id: "a-3",
    name: "Skin in the game",
    description: "Your first on-chain self-commitment.",
    earned: true,
    earnedAt: "2026-01-08",
  },
  {
    id: "a-4",
    name: "Finished what you started",
    description: "Complete a goal all the way to its deadline.",
    earned: false,
  },
  {
    id: "a-5",
    name: "A season of consistency",
    description: "Twelve weeks without a missed check-in.",
    earned: false,
  },
];

export const demoActivity: ActivityEvent[] = [
  {
    id: "e-1",
    type: "ai",
    title: "Needs more evidence — 52% confidence",
    detail: "Book 7 reflection was general. Two specifics from the second half would settle it.",
    at: "2026-08-14T18:20:00Z",
  },
  {
    id: "e-2",
    type: "chain",
    title: "Verification hash anchored",
    detail: "Only the hash of your evidence went on-chain. The evidence itself stayed private.",
    at: "2026-08-14T18:21:00Z",
    txHash: "0x77aa19c3b0d4415f9a2e6cc1f0347d8be5921a44",
  },
  {
    id: "e-3",
    type: "ai",
    title: "Milestone verified — 91% confidence",
    detail: "Four consistent training weeks confirmed from connected tracker data.",
    at: "2026-07-19T09:05:00Z",
  },
  {
    id: "e-4",
    type: "chain",
    title: "20 BOT locked",
    detail: "Self-commitment opened for “Read 12 books this year”.",
    at: "2026-01-08T12:00:00Z",
    txHash: "0xa41f9c2b7de85031aa64c9f0b7e3d5218c40ab77",
  },
  {
    id: "e-5",
    type: "chain",
    title: "Principal released",
    detail: "10 BOT principal plus 1.5 BOT reward released for “Write 30 days straight”.",
    at: "2026-05-04T15:42:00Z",
    txHash: "0x77b3ca90ef4412d6058a1cbb2f9d3e7740aa6f11",
  },
];

export const demoProfile: WalletProfile = {
  address: "0x8Cd2A41f90b7e3D5218c40Ab77Ee5310aa64C9f0",
  connected: false,
  accountabilityScore: 78,
  scoreBreakdown: [
    { label: "Check-ins kept", value: 84, weight: "40% of score" },
    { label: "Verification strength", value: 76, weight: "35% of score" },
    { label: "Goals seen through", value: 62, weight: "15% of score" },
    { label: "Honesty on missed weeks", value: 92, weight: "10% of score" },
  ],
  goalsCompleted: 4,
  goalsActive: 3,
  goalsAbandoned: 1,
  currentStreak: 6,
};
