-- CreateTable
CREATE TABLE "AchievementDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AchievementDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EarnedAchievement" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EarnedAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EarnedAchievement_walletAddress_idx" ON "EarnedAchievement"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "EarnedAchievement_walletAddress_achievementId_key" ON "EarnedAchievement"("walletAddress", "achievementId");

-- AddForeignKey
ALTER TABLE "EarnedAchievement" ADD CONSTRAINT "EarnedAchievement_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarnedAchievement" ADD CONSTRAINT "EarnedAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "AchievementDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
