import type { PerformancePeriod, SnapshotPoint } from "@/lib/portfolio/types";

export type PerformancePoint = SnapshotPoint;

const PERIOD_DAYS: Record<PerformancePeriod, number> = {
  "1D": 1,
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
};

export function calculatePeriodReturn(startValue: number, endValue: number) {
  return startValue === 0 ? 0 : (endValue - startValue) / startValue;
}

export function latestPerformancePoint(points: PerformancePoint[]) {
  return points.at(-1) ?? null;
}

export function getPeriodDays(period: PerformancePeriod) {
  return PERIOD_DAYS[period];
}

export function isPerformancePeriod(value: string): value is PerformancePeriod {
  return value in PERIOD_DAYS;
}

export function getPeriodStartDate(endDate: Date, period: PerformancePeriod) {
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - getPeriodDays(period));
  return startDate;
}
