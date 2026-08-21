-- CreateEnum
CREATE TYPE "EarningsMarketSession" AS ENUM ('BEFORE_MARKET', 'AFTER_MARKET');

-- CreateTable
CREATE TABLE "UpcomingEarningsState" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "eventDate" DATE,
    "marketSession" "EarningsMarketSession",
    "source" VARCHAR(64) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpcomingEarningsState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UpcomingEarningsState_stockId_key" ON "UpcomingEarningsState"("stockId");

-- CreateIndex
CREATE INDEX "UpcomingEarningsState_eventDate_idx" ON "UpcomingEarningsState"("eventDate");

-- CreateIndex
CREATE INDEX "UpcomingEarningsState_fetchedAt_idx" ON "UpcomingEarningsState"("fetchedAt");

-- AddForeignKey
ALTER TABLE "UpcomingEarningsState" ADD CONSTRAINT "UpcomingEarningsState_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
