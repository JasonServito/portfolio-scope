import { BackgroundJobStatus, BackgroundJobType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  calculateRetryDelaySeconds,
  canCancelJob,
  canClaimJob,
  canRetryJob,
  parseJobPayload,
} from "@/lib/jobs/types";

describe("background job policy", () => {
  it("uses bounded exponential retry delays", () => {
    expect([1, 2, 3, 4, 9].map(calculateRetryDelaySeconds)).toEqual([
      15, 30, 60, 120, 300,
    ]);
  });

  it("permits only safe lifecycle operations", () => {
    expect(canClaimJob(BackgroundJobStatus.QUEUED)).toBe(true);
    expect(canClaimJob(BackgroundJobStatus.RETRYING)).toBe(true);
    expect(canClaimJob(BackgroundJobStatus.RUNNING)).toBe(false);
    expect(canCancelJob(BackgroundJobStatus.QUEUED)).toBe(true);
    expect(canCancelJob(BackgroundJobStatus.RUNNING)).toBe(false);
    expect(canRetryJob(BackgroundJobStatus.FAILED)).toBe(true);
    expect(canRetryJob(BackgroundJobStatus.COMPLETED)).toBe(false);
  });

  it("strictly validates stored payloads before handler execution", () => {
    expect(
      parseJobPayload(BackgroundJobType.SEC_SUBMISSIONS_SYNC, {
        ticker: "AAPL",
      }),
    ).toEqual({ ticker: "AAPL" });
    expect(() =>
      parseJobPayload(BackgroundJobType.SEC_SUBMISSIONS_SYNC, {
        ticker: "AAPL",
        userId: "forged-user",
      }),
    ).toThrow();
  });
});
