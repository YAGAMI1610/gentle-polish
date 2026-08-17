-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "GoalMode" AS ENUM ('ACCOUNTABILITY', 'SELF_COMMITMENT');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "GoalCategory" AS ENUM ('FITNESS_WEIGHT', 'READING', 'RUNNING', 'CODING', 'LEARNING', 'SAVING', 'SPENDING', 'GENERIC');

-- CreateEnum
CREATE TYPE "CheckInFrequency" AS ENUM ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'ON_COMPLETION');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('TEXT', 'PHOTO', 'SCREENSHOT', 'FILE', 'CONNECTED_TRACKER', 'GITHUB', 'TRANSACTION_DATA');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'NEEDS_MORE_EVIDENCE', 'UNVERIFIED', 'REJECTED_AS_INCONSISTENT');

-- CreateEnum
CREATE TYPE "SignalLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "CommitmentStatus" AS ENUM ('NONE', 'CREATED', 'ACTIVE', 'COMPLETION_REQUESTED', 'APPROVED', 'CANCELLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChainTxKind" AS ENUM ('REGISTER_GOAL', 'REGISTER_MILESTONE', 'CREATE_COMMITMENT', 'FUND_REWARD', 'LOCK_FUNDS', 'REQUEST_COMPLETION', 'APPROVE_COMPLETION', 'RELEASE_PRINCIPAL', 'CLAIM_REWARD', 'CANCEL_COMMITMENT');

-- CreateTable
CREATE TABLE "Wallet" (
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "category" "GoalCategory" NOT NULL DEFAULT 'GENERIC',
    "mode" "GoalMode" NOT NULL,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentState" TEXT,
    "desiredState" TEXT,
    "successMetric" TEXT,
    "checkInFrequency" TEXT NOT NULL,
    "checkInCadence" "CheckInFrequency" NOT NULL DEFAULT 'WEEKLY',
    "nextCheckIn" TIMESTAMP(3),
    "deadline" TIMESTAMP(3),
    "goalHash" TEXT,
    "onchainGoalId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationStrategy" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "measurement" TEXT NOT NULL,
    "methods" TEXT[],
    "requiredEvidence" TEXT[],
    "frequency" "CheckInFrequency" NOT NULL DEFAULT 'WEEKLY',
    "confidenceThreshold" INTEGER NOT NULL DEFAULT 70,
    "fallbackPlan" TEXT,
    "rationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationStrategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "done" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "milestoneRef" TEXT,
    "verificationHash" TEXT,
    "onchainConfidence" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "milestoneId" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "checkInId" TEXT,
    "type" "EvidenceType" NOT NULL,
    "contentText" TEXT,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "fileName" TEXT,
    "sizeBytes" INTEGER,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationRecord" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "milestoneId" TEXT,
    "checkInId" TEXT,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "plausibility" "SignalLevel",
    "evidenceQuality" "SignalLevel",
    "consistency" "SignalLevel",
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "reasoning" TEXT NOT NULL,
    "evidenceSummary" TEXT,
    "evidenceHash" TEXT,
    "verificationHash" TEXT NOT NULL,
    "modelVersion" TEXT,
    "anchoredTxHash" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commitment" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "onchainCommitmentId" BIGINT,
    "depositor" TEXT NOT NULL,
    "rewardFunder" TEXT,
    "principalWei" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "rewardWei" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "token" TEXT NOT NULL DEFAULT 'BOT',
    "deadline" TIMESTAMP(3),
    "gracePeriodSeconds" INTEGER NOT NULL DEFAULT 0,
    "confidenceThreshold" INTEGER NOT NULL DEFAULT 70,
    "status" "CommitmentStatus" NOT NULL DEFAULT 'NONE',
    "rewardFunded" BOOLEAN NOT NULL DEFAULT false,
    "principalWithdrawn" BOOLEAN NOT NULL DEFAULT false,
    "rewardWithdrawn" BOOLEAN NOT NULL DEFAULT false,
    "verificationHash" TEXT,
    "attestedConfidence" INTEGER,
    "releaseCondition" TEXT NOT NULL,
    "failurePath" TEXT NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountabilityScoreLog" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "reason" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountabilityScoreLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionLog" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "goalId" TEXT,
    "milestoneId" TEXT,
    "checkInId" TEXT,
    "toolName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "confidence" INTEGER,
    "evidenceRef" TEXT,
    "verificationHash" TEXT,
    "modelVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChainTransaction" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "commitmentId" TEXT,
    "goalId" TEXT,
    "kind" "ChainTxKind" NOT NULL,
    "txHash" TEXT NOT NULL,
    "blockNumber" BIGINT,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChainTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Goal_walletAddress_idx" ON "Goal"("walletAddress");

-- CreateIndex
CREATE INDEX "Goal_walletAddress_status_idx" ON "Goal"("walletAddress", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationStrategy_goalId_key" ON "VerificationStrategy"("goalId");

-- CreateIndex
CREATE INDEX "Milestone_goalId_idx" ON "Milestone"("goalId");

-- CreateIndex
CREATE INDEX "CheckIn_walletAddress_idx" ON "CheckIn"("walletAddress");

-- CreateIndex
CREATE INDEX "CheckIn_goalId_idx" ON "CheckIn"("goalId");

-- CreateIndex
CREATE INDEX "Evidence_walletAddress_idx" ON "Evidence"("walletAddress");

-- CreateIndex
CREATE INDEX "Evidence_goalId_idx" ON "Evidence"("goalId");

-- CreateIndex
CREATE INDEX "Evidence_checkInId_idx" ON "Evidence"("checkInId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationRecord_checkInId_key" ON "VerificationRecord"("checkInId");

-- CreateIndex
CREATE INDEX "VerificationRecord_walletAddress_idx" ON "VerificationRecord"("walletAddress");

-- CreateIndex
CREATE INDEX "VerificationRecord_goalId_idx" ON "VerificationRecord"("goalId");

-- CreateIndex
CREATE INDEX "VerificationRecord_milestoneId_idx" ON "VerificationRecord"("milestoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Commitment_goalId_key" ON "Commitment"("goalId");

-- CreateIndex
CREATE INDEX "Commitment_walletAddress_idx" ON "Commitment"("walletAddress");

-- CreateIndex
CREATE INDEX "Commitment_status_idx" ON "Commitment"("status");

-- CreateIndex
CREATE INDEX "AccountabilityScoreLog_walletAddress_computedAt_idx" ON "AccountabilityScoreLog"("walletAddress", "computedAt");

-- CreateIndex
CREATE INDEX "DecisionLog_walletAddress_createdAt_idx" ON "DecisionLog"("walletAddress", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionLog_goalId_idx" ON "DecisionLog"("goalId");

-- CreateIndex
CREATE INDEX "ChainTransaction_walletAddress_createdAt_idx" ON "ChainTransaction"("walletAddress", "createdAt");

-- CreateIndex
CREATE INDEX "ChainTransaction_commitmentId_idx" ON "ChainTransaction"("commitmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ChainTransaction_txHash_key" ON "ChainTransaction"("txHash");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationStrategy" ADD CONSTRAINT "VerificationStrategy_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "CheckIn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRecord" ADD CONSTRAINT "VerificationRecord_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRecord" ADD CONSTRAINT "VerificationRecord_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRecord" ADD CONSTRAINT "VerificationRecord_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRecord" ADD CONSTRAINT "VerificationRecord_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "CheckIn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountabilityScoreLog" ADD CONSTRAINT "AccountabilityScoreLog_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionLog" ADD CONSTRAINT "DecisionLog_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionLog" ADD CONSTRAINT "DecisionLog_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChainTransaction" ADD CONSTRAINT "ChainTransaction_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChainTransaction" ADD CONSTRAINT "ChainTransaction_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChainTransaction" ADD CONSTRAINT "ChainTransaction_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

