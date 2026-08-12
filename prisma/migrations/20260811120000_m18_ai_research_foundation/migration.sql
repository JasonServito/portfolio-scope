-- CreateEnum
CREATE TYPE "ResearchGenerationMode" AS ENUM ('DETERMINISTIC', 'RECORDED', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "AiBudgetScope" AS ENUM ('GLOBAL', 'USER');

-- CreateEnum
CREATE TYPE "AiUsageStatus" AS ENUM ('RESERVED', 'SETTLED', 'RELEASED', 'UNCONFIRMED');

-- CreateEnum
CREATE TYPE "ResearchClaimCategory" AS ENUM ('SUPPORTIVE', 'COUNTERPOINT', 'RISK');

-- CreateEnum
CREATE TYPE "EvidenceRole" AS ENUM ('SUPPORTING', 'COUNTER');

-- CreateEnum
CREATE TYPE "EvidenceSourceKind" AS ENUM ('SEC_FACT', 'SEC_FILING', 'COMPANY_PROFILE', 'PEER_SET', 'DETERMINISTIC');

-- Existing research records remain deterministic. Version and provider fields
-- are nullable so the migration does not invent provenance for historical rows.
ALTER TABLE "ResearchJob"
ADD COLUMN "generationMode" "ResearchGenerationMode" NOT NULL DEFAULT 'DETERMINISTIC',
ADD COLUMN "requestedRegeneration" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "generationFingerprint" TEXT,
ADD COLUMN "sourceDataVersion" TEXT,
ADD COLUMN "inputDataVersion" TEXT,
ADD COLUMN "retrievalVersion" TEXT,
ADD COLUMN "calculationVersion" TEXT,
ADD COLUMN "sourceSnapshotJson" JSONB,
ADD COLUMN "sourceSnapshotSha256" TEXT,
ADD COLUMN "aiTokenLimit" INTEGER,
ADD COLUMN "aiCostLimitUsd" DECIMAL(12,6),
ADD COLUMN "aiReservedTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "aiUsedTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "aiReservedCostUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
ADD COLUMN "aiUsedCostUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
ADD CONSTRAINT "ResearchJob_ai_limits_check" CHECK (
  "aiReservedTokens" >= 0 AND
  "aiUsedTokens" >= 0 AND
  "aiReservedCostUsd" >= 0 AND
  "aiUsedCostUsd" >= 0 AND
  ("aiTokenLimit" IS NULL OR (
    "aiTokenLimit" > 0 AND
    "aiReservedTokens" + "aiUsedTokens" <= "aiTokenLimit"
  )) AND
  ("aiCostLimitUsd" IS NULL OR (
    "aiCostLimitUsd" > 0 AND
    "aiReservedCostUsd" + "aiUsedCostUsd" <= "aiCostLimitUsd"
  ))
);

ALTER TABLE "AgentRun"
ADD COLUMN "claimsJson" JSONB,
ADD COLUMN "missingDataJson" JSONB,
ADD COLUMN "provider" TEXT,
ADD COLUMN "model" TEXT,
ADD COLUMN "modelConfigJson" JSONB,
ADD COLUMN "promptVersion" TEXT,
ADD COLUMN "outputSchemaVersion" TEXT,
ADD COLUMN "agentVersion" TEXT;

ALTER TABLE "ResearchReport"
ADD COLUMN "rating" "AgentRating" NOT NULL DEFAULT 'MIXED',
ADD COLUMN "disagreementsJson" JSONB,
ADD COLUMN "provider" TEXT,
ADD COLUMN "model" TEXT,
ADD COLUMN "modelConfigJson" JSONB,
ADD COLUMN "promptVersion" TEXT,
ADD COLUMN "retrievalVersion" TEXT,
ADD COLUMN "calculationVersion" TEXT,
ADD COLUMN "inputDataVersion" TEXT,
ADD COLUMN "outputSchemaVersion" TEXT,
ADD COLUMN "sourceSnapshotSha256" TEXT,
ADD COLUMN "inputTokens" INTEGER,
ADD COLUMN "outputTokens" INTEGER,
ADD COLUMN "estimatedCostUsd" DECIMAL(12,6),
ADD COLUMN "reportVersion" TEXT,
ADD CONSTRAINT "ResearchReport_ai_usage_check" CHECK (
  ("inputTokens" IS NULL OR "inputTokens" >= 0) AND
  ("outputTokens" IS NULL OR "outputTokens" >= 0) AND
  ("estimatedCostUsd" IS NULL OR "estimatedCostUsd" >= 0)
);

-- CreateTable
CREATE TABLE "AiBudgetPeriod" (
  "id" TEXT NOT NULL,
  "scope" "AiBudgetScope" NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "userId" TEXT,
  "periodStart" DATE NOT NULL,
  "limitUsd" DECIMAL(12,6) NOT NULL,
  "reservedUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "usedUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AiBudgetPeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiBudgetPeriod_scope_check" CHECK (
    ("scope" = 'GLOBAL' AND "scopeKey" = 'GLOBAL' AND "userId" IS NULL) OR
    ("scope" = 'USER' AND "userId" IS NOT NULL AND "scopeKey" = "userId")
  ),
  CONSTRAINT "AiBudgetPeriod_period_check" CHECK (
    "periodStart" = date_trunc('month', "periodStart")::date
  ),
  CONSTRAINT "AiBudgetPeriod_amounts_check" CHECK (
    "limitUsd" > 0 AND
    "limitUsd" <= 5.000000 AND
    "reservedUsd" >= 0 AND
    "usedUsd" >= 0 AND
    "reservedUsd" + "usedUsd" <= "limitUsd"
  )
);

-- CreateTable
CREATE TABLE "AiUsage" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "AiUsageStatus" NOT NULL DEFAULT 'RESERVED',
  "userId" TEXT,
  "researchJobId" TEXT,
  "agentRunId" TEXT,
  "periodStart" DATE NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "pricingVersion" TEXT NOT NULL,
  "inputCostPerMillionUsd" DECIMAL(12,6) NOT NULL,
  "cachedInputCostPerMillionUsd" DECIMAL(12,6) NOT NULL,
  "outputCostPerMillionUsd" DECIMAL(12,6) NOT NULL,
  "reservedInputTokens" INTEGER NOT NULL,
  "reservedOutputTokens" INTEGER NOT NULL,
  "reservedCostUsd" DECIMAL(12,6) NOT NULL,
  "inputTokens" INTEGER,
  "cachedInputTokens" INTEGER,
  "outputTokens" INTEGER,
  "estimatedCostUsd" DECIMAL(12,6),
  "providerRequestId" TEXT,
  "attemptNumber" INTEGER NOT NULL DEFAULT 1,
  "errorCode" TEXT,
  "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiUsage_tokens_check" CHECK (
    "reservedInputTokens" >= 0 AND
    "reservedOutputTokens" >= 0 AND
    ("inputTokens" IS NULL OR "inputTokens" >= 0) AND
    ("cachedInputTokens" IS NULL OR "cachedInputTokens" >= 0) AND
    ("outputTokens" IS NULL OR "outputTokens" >= 0)
  ),
  CONSTRAINT "AiUsage_cost_check" CHECK (
    "inputCostPerMillionUsd" >= 0 AND
    "cachedInputCostPerMillionUsd" >= 0 AND
    "outputCostPerMillionUsd" >= 0 AND
    "reservedCostUsd" >= 0 AND
    ("estimatedCostUsd" IS NULL OR "estimatedCostUsd" >= 0)
  ),
  CONSTRAINT "AiUsage_attempt_check" CHECK ("attemptNumber" BETWEEN 1 AND 10),
  CONSTRAINT "AiUsage_period_check" CHECK (
    "periodStart" = date_trunc('month', "periodStart")::date
  )
);

-- CreateTable
CREATE TABLE "ResearchClaim" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "agentRunId" TEXT,
  "claimKey" TEXT NOT NULL,
  "category" "ResearchClaimCategory" NOT NULL,
  "statement" TEXT NOT NULL,
  "confidence" DECIMAL(4,3) NOT NULL,
  "assumptionsJson" JSONB NOT NULL,
  "sourceDate" DATE,
  "asOfDate" DATE NOT NULL,
  "isMaterial" BOOLEAN NOT NULL DEFAULT true,
  "ordinal" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ResearchClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResearchClaim_confidence_check" CHECK ("confidence" BETWEEN 0 AND 1),
  CONSTRAINT "ResearchClaim_ordinal_check" CHECK ("ordinal" >= 0),
  CONSTRAINT "ResearchClaim_statement_check" CHECK (length(btrim("statement")) BETWEEN 1 AND 4000)
);

-- CreateTable
CREATE TABLE "EvidenceReference" (
  "id" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "role" "EvidenceRole" NOT NULL,
  "referenceKey" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "sourceKind" "EvidenceSourceKind" NOT NULL,
  "title" TEXT NOT NULL,
  "sourceReference" TEXT NOT NULL,
  "secFilingId" TEXT,
  "secRawSourceId" TEXT,
  "secFinancialFactId" TEXT,
  "accessionNumber" TEXT,
  "section" TEXT,
  "sourceUrl" TEXT,
  "objectKey" TEXT,
  "sha256" TEXT,
  "retrievedAt" TIMESTAMP(3),
  "sourceDate" DATE,
  "passageStart" INTEGER,
  "passageEnd" INTEGER,
  "excerpt" TEXT NOT NULL,
  "metadataJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EvidenceReference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EvidenceReference_ordinal_check" CHECK ("ordinal" >= 0),
  CONSTRAINT "EvidenceReference_passage_check" CHECK (
    ("passageStart" IS NULL AND "passageEnd" IS NULL) OR
    ("passageStart" >= 0 AND "passageEnd" > "passageStart")
  ),
  CONSTRAINT "EvidenceReference_excerpt_check" CHECK (length(btrim("excerpt")) BETWEEN 1 AND 4000)
);

-- CreateIndex
CREATE INDEX "ResearchJob_userId_stockId_generationFingerprint_completedAt_idx"
ON "ResearchJob"("userId", "stockId", "generationFingerprint", "completedAt");
CREATE UNIQUE INDEX "AiBudgetPeriod_scopeKey_periodStart_key" ON "AiBudgetPeriod"("scopeKey", "periodStart");
CREATE INDEX "AiBudgetPeriod_scope_periodStart_idx" ON "AiBudgetPeriod"("scope", "periodStart");
CREATE INDEX "AiBudgetPeriod_userId_periodStart_idx" ON "AiBudgetPeriod"("userId", "periodStart");
CREATE UNIQUE INDEX "AiUsage_idempotencyKey_key" ON "AiUsage"("idempotencyKey");
CREATE INDEX "AiUsage_periodStart_status_idx" ON "AiUsage"("periodStart", "status");
CREATE INDEX "AiUsage_userId_periodStart_status_idx" ON "AiUsage"("userId", "periodStart", "status");
CREATE INDEX "AiUsage_researchJobId_status_idx" ON "AiUsage"("researchJobId", "status");
CREATE INDEX "AiUsage_agentRunId_idx" ON "AiUsage"("agentRunId");
CREATE INDEX "AiUsage_provider_providerRequestId_idx" ON "AiUsage"("provider", "providerRequestId");
CREATE UNIQUE INDEX "AiUsage_provider_request_key" ON "AiUsage"("provider", "providerRequestId") WHERE "providerRequestId" IS NOT NULL;
CREATE UNIQUE INDEX "ResearchClaim_reportId_claimKey_key" ON "ResearchClaim"("reportId", "claimKey");
CREATE UNIQUE INDEX "ResearchClaim_reportId_ordinal_key" ON "ResearchClaim"("reportId", "ordinal");
CREATE INDEX "ResearchClaim_agentRunId_idx" ON "ResearchClaim"("agentRunId");
CREATE UNIQUE INDEX "EvidenceReference_claimId_role_referenceKey_key" ON "EvidenceReference"("claimId", "role", "referenceKey");
CREATE UNIQUE INDEX "EvidenceReference_claimId_role_ordinal_key" ON "EvidenceReference"("claimId", "role", "ordinal");
CREATE INDEX "EvidenceReference_secFilingId_idx" ON "EvidenceReference"("secFilingId");
CREATE INDEX "EvidenceReference_secRawSourceId_idx" ON "EvidenceReference"("secRawSourceId");
CREATE INDEX "EvidenceReference_secFinancialFactId_idx" ON "EvidenceReference"("secFinancialFactId");

-- AddForeignKey
ALTER TABLE "AiBudgetPeriod" ADD CONSTRAINT "AiBudgetPeriod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_researchJobId_fkey" FOREIGN KEY ("researchJobId") REFERENCES "ResearchJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ResearchClaim" ADD CONSTRAINT "ResearchClaim_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ResearchReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchClaim" ADD CONSTRAINT "ResearchClaim_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EvidenceReference" ADD CONSTRAINT "EvidenceReference_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ResearchClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvidenceReference" ADD CONSTRAINT "EvidenceReference_secFilingId_fkey" FOREIGN KEY ("secFilingId") REFERENCES "SecFiling"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EvidenceReference" ADD CONSTRAINT "EvidenceReference_secRawSourceId_fkey" FOREIGN KEY ("secRawSourceId") REFERENCES "SecRawSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EvidenceReference" ADD CONSTRAINT "EvidenceReference_secFinancialFactId_fkey" FOREIGN KEY ("secFinancialFactId") REFERENCES "SecFinancialFact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
