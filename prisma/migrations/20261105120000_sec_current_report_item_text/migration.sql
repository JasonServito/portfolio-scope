-- Form 8-K item text: the listed items of each current report (for example
-- Item 5.02) are extracted from the primary 8-K document into the existing
-- extraction and passage tables under one new section kind. Additive only:
-- no existing row changes, and 10-Q Part II Item 1A Risk Factors reuses the
-- existing RISK_FACTORS kind.

-- AlterEnum
ALTER TYPE "SecFilingSectionKind" ADD VALUE 'CURRENT_REPORT_ITEM';
