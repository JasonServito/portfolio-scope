import { describe, expect, it } from "vitest";

import {
  calculatePeriodReturn,
  getPeriodDays,
  getPeriodStartDate,
  isPerformancePeriod,
  latestPerformancePoint,
} from "./performance";

describe("portfolio performance helpers", () => {
  it("calculates period returns and guards zero starting values", () => {
    expect(calculatePeriodReturn(1000, 1125)).toBe(0.125);
    expect(calculatePeriodReturn(1000, 875)).toBe(-0.125);
    expect(calculatePeriodReturn(0, 875)).toBe(0);
  });

  it("maps supported performance periods to day windows", () => {
    expect(getPeriodDays("1D")).toBe(1);
    expect(getPeriodDays("1W")).toBe(7);
    expect(getPeriodDays("1M")).toBe(30);
    expect(getPeriodDays("3M")).toBe(90);
    expect(getPeriodDays("1Y")).toBe(365);
  });

  it("validates period values before they reach service calls", () => {
    expect(isPerformancePeriod("1M")).toBe(true);
    expect(isPerformancePeriod("YTD")).toBe(false);
    expect(isPerformancePeriod("")).toBe(false);
  });

  it("finds start dates in UTC without mutating the source date", () => {
    const endDate = new Date("2026-06-30T21:00:00.000Z");
    const startDate = getPeriodStartDate(endDate, "1M");

    expect(startDate.toISOString()).toBe("2026-05-31T21:00:00.000Z");
    expect(endDate.toISOString()).toBe("2026-06-30T21:00:00.000Z");
  });

  it("returns the latest performance point or null for empty series", () => {
    expect(
      latestPerformancePoint([
        { date: "2026-06-29T21:00:00.000Z", value: 1000 },
        { date: "2026-06-30T21:00:00.000Z", value: 1040 },
      ]),
    ).toEqual({ date: "2026-06-30T21:00:00.000Z", value: 1040 });
    expect(latestPerformancePoint([])).toBeNull();
  });
});
