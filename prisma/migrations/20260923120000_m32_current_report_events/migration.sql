-- M32 adds recent-event evidence from Form 8-K current reports: 8-K filing
-- metadata keeps its item codes, and the Exhibit 99.1 press release attached
-- to an Item 2.02 results filing is extracted as one PRESS_RELEASE section
-- using the M31 extraction and passage tables. Every change is additive:
-- existing filings keep an empty item-code list and no extraction state.

-- AlterEnum
ALTER TYPE "SecFilingSectionKind" ADD VALUE 'PRESS_RELEASE';

-- AlterTable
ALTER TABLE "SecFiling" ADD COLUMN "itemCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
