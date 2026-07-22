import { randomUUID } from "node:crypto";

import { BackgroundJobType } from "@prisma/client";

import type { JobPublisher } from "@/lib/jobs/qstash";
import { enqueueBackgroundJob } from "@/lib/jobs/service";

function minuteBucket(date: Date) {
  const bucket = new Date(date);
  bucket.setUTCSeconds(0, 0);
  return bucket;
}

export function queuePortfolioSnapshotRefresh(
  userId: string,
  portfolioId: string,
  input: {
    now?: () => Date;
    publisher?: JobPublisher;
    environment?: NodeJS.ProcessEnv;
  } = {},
) {
  const asOf = minuteBucket(input.now?.() ?? new Date());
  return enqueueBackgroundJob(
    {
      type: BackgroundJobType.PORTFOLIO_SNAPSHOT_REFRESH,
      idempotencyKey: `portfolio-snapshot:${portfolioId}:${asOf.toISOString()}`,
      correlationId: randomUUID(),
      payload: { portfolioId, asOf: asOf.toISOString() },
      userId,
      portfolioId,
    },
    { publisher: input.publisher, environment: input.environment },
  );
}
