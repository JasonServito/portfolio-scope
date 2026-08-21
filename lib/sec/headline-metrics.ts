import type {
  CanonicalFundamentalFact,
  FundamentalsSnapshot,
} from "@/lib/sec/fundamentals-provider";
import type { PeriodKind } from "@/lib/sec/normalization";

export type HeadlineMetricUnit = "USD" | "USD_PER_SHARE" | "PERCENT" | "RATIO";

export type HeadlineMetric = {
  id:
    | "MARKET_CAPITALIZATION"
    | "REVENUE"
    | "REVENUE_GROWTH"
    | "EPS"
    | "EPS_GROWTH"
    | "FREE_CASH_FLOW"
    | "OPERATING_MARGIN"
    | "PE_RATIO"
    | "DEBT_TO_EQUITY"
    | "ROIC";
  label: string;
  explanation: string;
  value: number | null;
  unit: HeadlineMetricUnit;
  periodKind: PeriodKind | null;
  periodEnd: string | null;
  unavailableReason: string | null;
};

const durationPeriodPriority: PeriodKind[] = [
  "ANNUAL",
  "YEAR_TO_DATE",
  "QUARTERLY",
];

function findFact(
  facts: CanonicalFundamentalFact[],
  metric: string,
  periodKinds: PeriodKind[],
) {
  for (const periodKind of periodKinds) {
    const fact = facts.find(
      (candidate) =>
        candidate.metric === metric && candidate.periodKind === periodKind,
    );
    if (fact) return fact;
  }
  return null;
}

function findMatchingFacts(
  facts: CanonicalFundamentalFact[],
  leftMetric: string,
  rightMetric: string,
  periodKinds: PeriodKind[],
) {
  for (const periodKind of periodKinds) {
    const left = findFact(facts, leftMetric, [periodKind]);
    const right = findFact(facts, rightMetric, [periodKind]);
    if (
      left &&
      right &&
      left.unit === "USD" &&
      right.unit === "USD" &&
      left.periodStart === right.periodStart &&
      left.periodEnd === right.periodEnd
    ) {
      return [left, right] as const;
    }
  }
  return null;
}

function unavailableReason(snapshot: FundamentalsSnapshot, metrics: string[]) {
  return metrics.some((metric) => snapshot.ambiguousMetrics.includes(metric))
    ? "Conflicting filing observations were withheld."
    : "The required filing data is not available.";
}

function reportedMetric(input: {
  snapshot: FundamentalsSnapshot;
  id: HeadlineMetric["id"];
  label: string;
  explanation: string;
  canonicalMetric: string;
  expectedUnit: string;
  unit: HeadlineMetricUnit;
}) {
  const fact = findFact(
    input.snapshot.facts,
    input.canonicalMetric,
    durationPeriodPriority,
  );
  const usable = fact?.unit === input.expectedUnit ? fact : null;

  return {
    id: input.id,
    label: input.label,
    explanation: input.explanation,
    value: usable?.value ?? null,
    unit: input.unit,
    periodKind: usable?.periodKind ?? null,
    periodEnd: usable?.periodEnd ?? null,
    unavailableReason: usable
      ? null
      : unavailableReason(input.snapshot, [input.canonicalMetric]),
  } satisfies HeadlineMetric;
}

function calculatedMetric(input: {
  snapshot: FundamentalsSnapshot;
  id: HeadlineMetric["id"];
  label: string;
  explanation: string;
  leftMetric: string;
  rightMetric: string;
  periodKinds: PeriodKind[];
  calculate: (left: number, right: number) => number | null;
  unit: HeadlineMetricUnit;
}) {
  const facts = findMatchingFacts(
    input.snapshot.facts,
    input.leftMetric,
    input.rightMetric,
    input.periodKinds,
  );
  const value = facts ? input.calculate(facts[0].value, facts[1].value) : null;
  const usableValue = value !== null && Number.isFinite(value) ? value : null;

  return {
    id: input.id,
    label: input.label,
    explanation: input.explanation,
    value: usableValue,
    unit: input.unit,
    periodKind: usableValue !== null && facts ? facts[0].periodKind : null,
    periodEnd: usableValue !== null && facts ? facts[0].periodEnd : null,
    unavailableReason:
      usableValue !== null
        ? null
        : unavailableReason(input.snapshot, [
            input.leftMetric,
            input.rightMetric,
          ]),
  } satisfies HeadlineMetric;
}

function alwaysUnavailableMetric(
  metric: Pick<HeadlineMetric, "id" | "label" | "explanation" | "unit"> & {
    reason: string;
  },
) {
  return {
    id: metric.id,
    label: metric.label,
    explanation: metric.explanation,
    value: null,
    unit: metric.unit,
    periodKind: null,
    periodEnd: null,
    unavailableReason: metric.reason,
  } satisfies HeadlineMetric;
}

export function buildHeadlineMetrics(
  snapshot: FundamentalsSnapshot,
): HeadlineMetric[] {
  return [
    alwaysUnavailableMetric({
      id: "MARKET_CAPITALIZATION",
      label: "Market Capitalization",
      explanation: "The total market value of a company's outstanding shares.",
      unit: "USD",
      reason:
        "A current programmatic quote and compatible shares outstanding are not available.",
    }),
    reportedMetric({
      snapshot,
      id: "REVENUE",
      label: "Revenue",
      explanation:
        "Money earned from the company's main business before expenses.",
      canonicalMetric: "REVENUE",
      expectedUnit: "USD",
      unit: "USD",
    }),
    alwaysUnavailableMetric({
      id: "REVENUE_GROWTH",
      label: "Revenue Growth",
      explanation:
        "How much revenue changed compared with the same period one year earlier.",
      unit: "PERCENT",
      reason: "A comparable prior-year revenue period is not available.",
    }),
    reportedMetric({
      snapshot,
      id: "EPS",
      label: "Diluted EPS",
      explanation:
        "Profit attributable to each diluted share during the period.",
      canonicalMetric: "DILUTED_EPS",
      expectedUnit: "USD/share",
      unit: "USD_PER_SHARE",
    }),
    alwaysUnavailableMetric({
      id: "EPS_GROWTH",
      label: "EPS Growth",
      explanation:
        "How much diluted earnings per share changed from the same period one year earlier.",
      unit: "PERCENT",
      reason: "A comparable prior-year EPS period is not available.",
    }),
    calculatedMetric({
      snapshot,
      id: "FREE_CASH_FLOW",
      label: "Free Cash Flow",
      explanation:
        "Cash from operations left after spending on property and equipment.",
      leftMetric: "OPERATING_CASH_FLOW",
      rightMetric: "CAPITAL_EXPENDITURES",
      periodKinds: durationPeriodPriority,
      calculate: (operatingCashFlow, capitalExpenditures) =>
        operatingCashFlow - capitalExpenditures,
      unit: "USD",
    }),
    calculatedMetric({
      snapshot,
      id: "OPERATING_MARGIN",
      label: "Operating Margin",
      explanation:
        "The share of revenue remaining after normal operating costs, before interest and taxes.",
      leftMetric: "OPERATING_INCOME",
      rightMetric: "REVENUE",
      periodKinds: durationPeriodPriority,
      calculate: (operatingIncome, revenue) =>
        revenue === 0 ? null : (operatingIncome / revenue) * 100,
      unit: "PERCENT",
    }),
    alwaysUnavailableMetric({
      id: "PE_RATIO",
      label: "P/E Ratio",
      explanation:
        "The share price divided by earnings per share, used to compare price with recent profit.",
      unit: "RATIO",
      reason:
        "A current programmatic quote and compatible trailing earnings are not available.",
    }),
    calculatedMetric({
      snapshot,
      id: "DEBT_TO_EQUITY",
      label: "Long-term Debt-to-Equity",
      explanation:
        "Long-term debt compared with shareholders' equity at the same reporting date.",
      leftMetric: "LONG_TERM_DEBT",
      rightMetric: "STOCKHOLDERS_EQUITY",
      periodKinds: ["INSTANT"],
      calculate: (longTermDebt, equity) =>
        equity === 0 ? null : longTermDebt / equity,
      unit: "RATIO",
    }),
    alwaysUnavailableMetric({
      id: "ROIC",
      label: "Return on Invested Capital",
      explanation:
        "Operating profit after tax compared with the capital invested in the business.",
      unit: "PERCENT",
      reason:
        "Reliable tax and invested-capital inputs are not currently normalized.",
    }),
  ];
}
