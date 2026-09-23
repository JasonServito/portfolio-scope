-- M31 adds narrative filing-text evidence: bounded sections of each supported
-- company's latest 10-K and 10-Q primary document are extracted into hashed
-- passages with per-filing extraction state. Every change is additive; the
-- existing FILING_DOCUMENT raw-source kind records the stored document.

-- CreateEnum
CREATE TYPE "SecFilingSectionKind" AS ENUM ('BUSINESS', 'RISK_FACTORS', 'MDA');

-- CreateEnum
CREATE TYPE "SecFilingExtractionStatus" AS ENUM ('COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "SecFilingExtraction" (
    "id" TEXT NOT NULL,
    "filingId" TEXT NOT NULL,
    "rawSourceId" TEXT,
    "status" "SecFilingExtractionStatus" NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "expectedSections" "SecFilingSectionKind"[],
    "extractedSections" "SecFilingSectionKind"[],
    "truncatedSections" "SecFilingSectionKind"[],
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecFilingExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecFilingChunk" (
    "id" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "filingId" TEXT NOT NULL,
    "rawSourceId" TEXT NOT NULL,
    "sectionKind" "SecFilingSectionKind" NOT NULL,
    "sectionLabel" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "passageStart" INTEGER NOT NULL,
    "passageEnd" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecFilingChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SecFilingExtraction_filingId_key" ON "SecFilingExtraction"("filingId");

-- CreateIndex
CREATE INDEX "SecFilingExtraction_status_attemptedAt_idx" ON "SecFilingExtraction"("status", "attemptedAt");

-- CreateIndex
CREATE INDEX "SecFilingExtraction_rawSourceId_idx" ON "SecFilingExtraction"("rawSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "SecFilingChunk_filingId_sectionKind_ordinal_key" ON "SecFilingChunk"("filingId", "sectionKind", "ordinal");

-- CreateIndex
CREATE INDEX "SecFilingChunk_extractionId_idx" ON "SecFilingChunk"("extractionId");

-- CreateIndex
CREATE INDEX "SecFilingChunk_rawSourceId_idx" ON "SecFilingChunk"("rawSourceId");

-- AddForeignKey
ALTER TABLE "SecFilingExtraction" ADD CONSTRAINT "SecFilingExtraction_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "SecFiling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecFilingExtraction" ADD CONSTRAINT "SecFilingExtraction_rawSourceId_fkey" FOREIGN KEY ("rawSourceId") REFERENCES "SecRawSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecFilingChunk" ADD CONSTRAINT "SecFilingChunk_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "SecFilingExtraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecFilingChunk" ADD CONSTRAINT "SecFilingChunk_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "SecFiling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecFilingChunk" ADD CONSTRAINT "SecFilingChunk_rawSourceId_fkey" FOREIGN KEY ("rawSourceId") REFERENCES "SecRawSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
