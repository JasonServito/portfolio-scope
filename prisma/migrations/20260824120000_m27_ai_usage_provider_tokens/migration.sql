-- Preserve the complete provider-declared token tuple for each metered attempt.
-- Existing attempts remain unknown rather than receiving invented zero values.
ALTER TABLE "AiUsage"
ADD COLUMN "reasoningTokens" INTEGER,
ADD COLUMN "providerTotalTokens" INTEGER,
ADD CONSTRAINT "AiUsage_provider_tokens_check" CHECK (
  ("reasoningTokens" IS NULL OR "reasoningTokens" >= 0) AND
  ("providerTotalTokens" IS NULL OR "providerTotalTokens" >= 0)
);
