-- CreateEnum
CREATE TYPE "BackgroundJobType" AS ENUM (
    'SEC_SUBMISSIONS_SYNC',
    'SEC_COMPANY_FACTS_SYNC',
    'SEC_FILING_FETCH',
    'SEC_FACT_NORMALIZATION',
    'PORTFOLIO_SNAPSHOT_REFRESH',
    'RESEARCH_AGENT_RUN',
    'RESEARCH_SYNTHESIS',
    'MAINTENANCE_CLEANUP'
);

-- CreateEnum
CREATE TYPE "BackgroundJobStatus" AS ENUM (
    'QUEUED',
    'RUNNING',
    'RETRYING',
    'PARTIALLY_COMPLETED',
    'COMPLETED',
    'FAILED',
    'CANCELLED'
);

-- CreateEnum
CREATE TYPE "BackgroundJobAttemptStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BackgroundJobControlAction" AS ENUM ('RETRY', 'CANCEL');

-- AlterTable
ALTER TABLE "ResearchJob"
ADD COLUMN "correlationId" TEXT,
ADD COLUMN "startedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL,
    "type" "BackgroundJobType" NOT NULL,
    "status" "BackgroundJobStatus" NOT NULL DEFAULT 'QUEUED',
    "userId" TEXT,
    "companyId" TEXT,
    "portfolioId" TEXT,
    "researchJobId" TEXT,
    "agentName" "AgentName",
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "resultJson" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "timeoutMs" INTEGER NOT NULL,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "qstashMessageId" TEXT,
    "cancelRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BackgroundJob_attemptCount_check" CHECK ("attemptCount" >= 0),
    CONSTRAINT "BackgroundJob_maxAttempts_check" CHECK ("maxAttempts" BETWEEN 1 AND 10),
    CONSTRAINT "BackgroundJob_timeoutMs_check" CHECK ("timeoutMs" BETWEEN 1000 AND 300000)
);

-- CreateTable
CREATE TABLE "BackgroundJobAttempt" (
    "id" TEXT NOT NULL,
    "backgroundJobId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "BackgroundJobAttemptStatus" NOT NULL DEFAULT 'RUNNING',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackgroundJobAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BackgroundJobAttempt_attemptNumber_check" CHECK ("attemptNumber" > 0)
);

-- CreateTable
CREATE TABLE "BackgroundJobControlEvent" (
    "id" TEXT NOT NULL,
    "backgroundJobId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" "BackgroundJobControlAction" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackgroundJobControlEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResearchJob_correlationId_key" ON "ResearchJob"("correlationId");
CREATE UNIQUE INDEX "BackgroundJob_idempotencyKey_key" ON "BackgroundJob"("idempotencyKey");
CREATE INDEX "BackgroundJob_status_queuedAt_idx" ON "BackgroundJob"("status", "queuedAt");
CREATE INDEX "BackgroundJob_type_status_queuedAt_idx" ON "BackgroundJob"("type", "status", "queuedAt");
CREATE INDEX "BackgroundJob_companyId_status_idx" ON "BackgroundJob"("companyId", "status");
CREATE INDEX "BackgroundJob_portfolioId_status_idx" ON "BackgroundJob"("portfolioId", "status");
CREATE INDEX "BackgroundJob_researchJobId_status_idx" ON "BackgroundJob"("researchJobId", "status");
CREATE INDEX "BackgroundJob_userId_createdAt_idx" ON "BackgroundJob"("userId", "createdAt");
CREATE INDEX "BackgroundJob_correlationId_idx" ON "BackgroundJob"("correlationId");
CREATE UNIQUE INDEX "BackgroundJobAttempt_backgroundJobId_attemptNumber_key" ON "BackgroundJobAttempt"("backgroundJobId", "attemptNumber");
CREATE INDEX "BackgroundJobAttempt_status_startedAt_idx" ON "BackgroundJobAttempt"("status", "startedAt");
CREATE INDEX "BackgroundJobControlEvent_backgroundJobId_createdAt_idx" ON "BackgroundJobControlEvent"("backgroundJobId", "createdAt");
CREATE INDEX "BackgroundJobControlEvent_actorUserId_createdAt_idx" ON "BackgroundJobControlEvent"("actorUserId", "createdAt");

-- Prevent conflicting active ingestion jobs for one company and duplicate
-- active agent/synthesis work for one research request. Terminal history is
-- intentionally retained and does not block a later freshness bucket.
CREATE UNIQUE INDEX "BackgroundJob_active_company_type_key"
ON "BackgroundJob"("companyId", "type")
WHERE "companyId" IS NOT NULL AND "status" IN ('QUEUED', 'RUNNING', 'RETRYING');

CREATE UNIQUE INDEX "BackgroundJob_active_research_agent_key"
ON "BackgroundJob"("researchJobId", "type", "agentName")
WHERE "researchJobId" IS NOT NULL AND "status" IN ('QUEUED', 'RUNNING', 'RETRYING');

CREATE UNIQUE INDEX "BackgroundJob_active_research_synthesis_key"
ON "BackgroundJob"("researchJobId", "type")
WHERE "researchJobId" IS NOT NULL AND "agentName" IS NULL AND "status" IN ('QUEUED', 'RUNNING', 'RETRYING');

CREATE UNIQUE INDEX "BackgroundJob_active_portfolio_type_key"
ON "BackgroundJob"("portfolioId", "type")
WHERE "portfolioId" IS NOT NULL AND "status" IN ('QUEUED', 'RUNNING', 'RETRYING');

CREATE UNIQUE INDEX "ResearchJob_active_user_stock_key"
ON "ResearchJob"("userId", "stockId")
WHERE "status" IN ('PENDING', 'RUNNING', 'PARTIALLY_COMPLETED');

-- AddForeignKey
ALTER TABLE "BackgroundJob" ADD CONSTRAINT "BackgroundJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BackgroundJob" ADD CONSTRAINT "BackgroundJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BackgroundJob" ADD CONSTRAINT "BackgroundJob_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BackgroundJob" ADD CONSTRAINT "BackgroundJob_researchJobId_fkey" FOREIGN KEY ("researchJobId") REFERENCES "ResearchJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BackgroundJobAttempt" ADD CONSTRAINT "BackgroundJobAttempt_backgroundJobId_fkey" FOREIGN KEY ("backgroundJobId") REFERENCES "BackgroundJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BackgroundJobControlEvent" ADD CONSTRAINT "BackgroundJobControlEvent_backgroundJobId_fkey" FOREIGN KEY ("backgroundJobId") REFERENCES "BackgroundJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BackgroundJobControlEvent" ADD CONSTRAINT "BackgroundJobControlEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
