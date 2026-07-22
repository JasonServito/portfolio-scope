-- AlterTable
ALTER TABLE "User"
    ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- DropForeignKey
ALTER TABLE "WatchlistItem" DROP CONSTRAINT "WatchlistItem_stockId_fkey";

-- DropForeignKey
ALTER TABLE "ResearchJob" DROP CONSTRAINT "ResearchJob_stockId_fkey";

-- DropForeignKey
ALTER TABLE "ResearchReport" DROP CONSTRAINT "ResearchReport_stockId_fkey";

-- CreateIndex
CREATE INDEX "ResearchJob_userId_createdAt_idx" ON "ResearchJob"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchJob" ADD CONSTRAINT "ResearchJob_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchReport" ADD CONSTRAINT "ResearchReport_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
