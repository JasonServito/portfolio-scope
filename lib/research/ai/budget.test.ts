import { describe, expect, it } from "vitest";

import {
  calculateAiCostUsd,
  estimateInputTokenUpperBound,
  utcMonthStart,
} from "./budget";

const pricing = {
  inputUsdPerMillion: 0.25,
  cachedInputUsdPerMillion: 0.025,
  outputUsdPerMillion: 2,
};

describe("AI usage calculations", () => {
  it("uses a byte-based conservative input-token upper bound", () => {
    expect(estimateInputTokenUpperBound("evidence")).toBe(8);
    expect(estimateInputTokenUpperBound("ðŸ“ˆ")).toBeGreaterThan(1);
  });

  it("calculates uncached, cached, and output usage with upward rounding", () => {
    expect(
      calculateAiCostUsd(
        { inputTokens: 1_000, cachedInputTokens: 250, outputTokens: 500 },
        pricing,
      ),
    ).toBe(0.001194);
  });

  it("uses a UTC calendar-month boundary", () => {
    expect(utcMonthStart(new Date("2026-08-31T23:59:59-06:00"))).toEqual(
      new Date("2026-09-01T00:00:00.000Z"),
    );
  });
});
