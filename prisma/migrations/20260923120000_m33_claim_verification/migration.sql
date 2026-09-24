CREATE TYPE "ClaimVerificationStatus" AS ENUM ('UNVERIFIED', 'SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'CONTRADICTED');

ALTER TABLE "ResearchReport" ADD COLUMN "verificationCompleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ResearchClaim"
  ADD COLUMN "verificationStatus" "ClaimVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN "verificationEvidenceIdsJson" JSONB;
