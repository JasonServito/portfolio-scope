-- CreateEnum
CREATE TYPE "SecRawSourceKind" AS ENUM ('SUBMISSIONS', 'COMPANY_FACTS', 'FILING_DOCUMENT');

-- CreateEnum
CREATE TYPE "SecIngestionStatus" AS ENUM ('RUNNING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "SecFactPeriodType" AS ENUM ('INSTANT', 'DURATION');

-- CreateEnum
CREATE TYPE "SecFactPeriodKind" AS ENUM ('INSTANT', 'QUARTERLY', 'YEAR_TO_DATE', 'ANNUAL');

-- CreateEnum
CREATE TYPE "SecFactSelection" AS ENUM ('SELECTED', 'SUPERSEDED', 'AMBIGUOUS');

-- AlterTable
ALTER TABLE "Stock" ADD COLUMN "companyId" TEXT;

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSupported" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecEntity" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cik" VARCHAR(10) NOT NULL,
    "legalName" TEXT NOT NULL,
    "sic" TEXT,
    "sicDescription" TEXT,
    "fiscalYearEnd" TEXT,
    "stateOfIncorporation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecFiling" (
    "id" TEXT NOT NULL,
    "secEntityId" TEXT NOT NULL,
    "accessionNumber" TEXT NOT NULL,
    "formType" TEXT NOT NULL,
    "filingDate" DATE NOT NULL,
    "reportDate" DATE,
    "acceptanceDateTime" TIMESTAMP(3),
    "primaryDocument" TEXT,
    "primaryDocumentDescription" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "isAmendment" BOOLEAN NOT NULL DEFAULT false,
    "amendsAccessionNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecFiling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecRawSource" (
    "id" TEXT NOT NULL,
    "secEntityId" TEXT NOT NULL,
    "kind" "SecRawSourceKind" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteLength" BIGINT NOT NULL,
    "firstRetrievedAt" TIMESTAMP(3) NOT NULL,
    "lastRetrievedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecRawSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecFinancialFact" (
    "id" TEXT NOT NULL,
    "secEntityId" TEXT NOT NULL,
    "filingId" TEXT,
    "rawSourceId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "canonicalMetric" TEXT NOT NULL,
    "taxonomy" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "originalValue" DECIMAL(38,10) NOT NULL,
    "originalUnit" TEXT NOT NULL,
    "normalizedValue" DECIMAL(38,10) NOT NULL,
    "normalizedUnit" TEXT NOT NULL,
    "periodStart" DATE,
    "periodEnd" DATE NOT NULL,
    "periodType" "SecFactPeriodType" NOT NULL,
    "periodKind" "SecFactPeriodKind" NOT NULL,
    "fiscalYear" INTEGER,
    "fiscalPeriod" TEXT,
    "formType" TEXT NOT NULL,
    "filedAt" DATE NOT NULL,
    "accessionNumber" TEXT NOT NULL,
    "frame" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "normalizationVersion" TEXT NOT NULL,
    "isDerived" BOOLEAN NOT NULL DEFAULT false,
    "selection" "SecFactSelection" NOT NULL,
    "ambiguityReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecFinancialFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecIngestionRun" (
    "id" TEXT NOT NULL,
    "secEntityId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "status" "SecIngestionStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "filingsProcessed" INTEGER NOT NULL DEFAULT 0,
    "factsProcessed" INTEGER NOT NULL DEFAULT 0,
    "factsSelected" INTEGER NOT NULL DEFAULT 0,
    "ambiguousFacts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecIngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");
CREATE UNIQUE INDEX "SecEntity_companyId_key" ON "SecEntity"("companyId");
CREATE UNIQUE INDEX "SecEntity_cik_key" ON "SecEntity"("cik");
CREATE UNIQUE INDEX "SecFiling_accessionNumber_key" ON "SecFiling"("accessionNumber");
CREATE INDEX "SecFiling_secEntityId_filingDate_idx" ON "SecFiling"("secEntityId", "filingDate");
CREATE INDEX "SecFiling_secEntityId_reportDate_formType_idx" ON "SecFiling"("secEntityId", "reportDate", "formType");
CREATE UNIQUE INDEX "SecRawSource_objectKey_key" ON "SecRawSource"("objectKey");
CREATE UNIQUE INDEX "SecRawSource_secEntityId_kind_sha256_key" ON "SecRawSource"("secEntityId", "kind", "sha256");
CREATE INDEX "SecRawSource_secEntityId_kind_lastRetrievedAt_idx" ON "SecRawSource"("secEntityId", "kind", "lastRetrievedAt");
CREATE UNIQUE INDEX "SecFinancialFact_externalKey_key" ON "SecFinancialFact"("externalKey");
CREATE INDEX "SecFinancialFact_secEntityId_canonicalMetric_selection_periodEnd_idx" ON "SecFinancialFact"("secEntityId", "canonicalMetric", "selection", "periodEnd");
CREATE INDEX "SecFinancialFact_secEntityId_periodKind_periodEnd_idx" ON "SecFinancialFact"("secEntityId", "periodKind", "periodEnd");
CREATE INDEX "SecFinancialFact_accessionNumber_idx" ON "SecFinancialFact"("accessionNumber");
CREATE INDEX "SecFinancialFact_filingId_idx" ON "SecFinancialFact"("filingId");
CREATE INDEX "SecFinancialFact_rawSourceId_idx" ON "SecFinancialFact"("rawSourceId");
CREATE UNIQUE INDEX "SecIngestionRun_correlationId_key" ON "SecIngestionRun"("correlationId");
CREATE INDEX "SecIngestionRun_secEntityId_startedAt_idx" ON "SecIngestionRun"("secEntityId", "startedAt");
CREATE INDEX "SecIngestionRun_requestedByUserId_startedAt_idx" ON "SecIngestionRun"("requestedByUserId", "startedAt");
CREATE INDEX "SecIngestionRun_status_startedAt_idx" ON "SecIngestionRun"("status", "startedAt");
CREATE INDEX "Stock_companyId_idx" ON "Stock"("companyId");

-- AddForeignKey
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SecEntity" ADD CONSTRAINT "SecEntity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecFiling" ADD CONSTRAINT "SecFiling_secEntityId_fkey" FOREIGN KEY ("secEntityId") REFERENCES "SecEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecRawSource" ADD CONSTRAINT "SecRawSource_secEntityId_fkey" FOREIGN KEY ("secEntityId") REFERENCES "SecEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecFinancialFact" ADD CONSTRAINT "SecFinancialFact_secEntityId_fkey" FOREIGN KEY ("secEntityId") REFERENCES "SecEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecFinancialFact" ADD CONSTRAINT "SecFinancialFact_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "SecFiling"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SecFinancialFact" ADD CONSTRAINT "SecFinancialFact_rawSourceId_fkey" FOREIGN KEY ("rawSourceId") REFERENCES "SecRawSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SecIngestionRun" ADD CONSTRAINT "SecIngestionRun_secEntityId_fkey" FOREIGN KEY ("secEntityId") REFERENCES "SecEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecIngestionRun" ADD CONSTRAINT "SecIngestionRun_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
