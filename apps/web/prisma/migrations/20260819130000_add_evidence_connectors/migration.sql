-- CreateEnum
CREATE TYPE "ConnectorProvider" AS ENUM ('GITHUB');

-- CreateTable
CREATE TABLE "EvidenceConnector" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "provider" "ConnectorProvider" NOT NULL,
    "externalLogin" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceConnector_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvidenceConnector_walletAddress_idx" ON "EvidenceConnector"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceConnector_walletAddress_provider_key" ON "EvidenceConnector"("walletAddress", "provider");

-- AddForeignKey
ALTER TABLE "EvidenceConnector" ADD CONSTRAINT "EvidenceConnector_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE CASCADE ON UPDATE CASCADE;
