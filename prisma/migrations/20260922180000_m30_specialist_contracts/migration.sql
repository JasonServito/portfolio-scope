-- M30 separates "no evidence" from "neutral", labels facts versus
-- interpretation, and stores the deterministic evidence-coverage measure and
-- the synthesis "what would change this analysis" list. Every change is
-- additive and nullable: historical runs, claims, and reports keep their
-- original values and are not relabelled.

-- CreateEnum
CREATE TYPE "AgentAvailability" AS ENUM ('COMPLETE', 'PARTIAL', 'NOT_AVAILABLE');

-- CreateEnum
CREATE TYPE "ResearchClaimKind" AS ENUM ('FACT', 'DERIVED', 'INTERPRETATION');

ALTER TABLE "AgentRun"
ADD COLUMN "availability" "AgentAvailability";

ALTER TABLE "ResearchClaim"
ADD COLUMN "kind" "ResearchClaimKind";

ALTER TABLE "ResearchReport"
ADD COLUMN "evidenceCoverageJson" JSONB,
ADD COLUMN "whatWouldChangeJson" JSONB;
