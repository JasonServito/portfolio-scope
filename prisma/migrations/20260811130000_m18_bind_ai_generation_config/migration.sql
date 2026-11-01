-- Bind queued external work to the safe, output-affecting configuration that
-- was approved when the immutable source snapshot was created.
ALTER TABLE "ResearchJob"
ADD COLUMN "generationConfigJson" JSONB;
