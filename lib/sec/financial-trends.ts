import type {
  CanonicalFundamentalFact,
  FundamentalsSnapshot,
} from "@/lib/sec/fundamentals-provider";

export type FinancialTrendPoint = {
  periodEnd: string;
  periodLabel: string;
  value: number | null;
};

export type FinancialTrend = {
  id: "REVENUE" | "DILUTED_EPS" | "FREE_CASH_FLOW";
  title: string;
  description: string;
  unit: "USD" | "USD_PER_SHARE";
  status: "AVAILABLE" | "PARTIAL" | "MISSING";
  summary: string;
  points: FinancialTrendPoint[];
  missingPeriods: string[];
};

const maximumPeriods = 8;

function formatPeriod(periodEnd: string) {
  return `Quarter ended ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(periodEnd))}`;
}

function formatValue(value: number, unit: FinancialTrend["unit"]) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: unit === "USD" ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value);
}

function quarterlyFactMap(
  facts: CanonicalFundamentalFact[],
  metric: string,
  unit: string,
) {
  return new Map(
    facts
      .filter(
        (fact) =>
          fact.metric === metric &&
          fact.periodKind === "QUARTERLY" &&
          fact.selection === "SELECTED" &&
          fact.unit === unit,
      )
      .map((fact) => [fact.periodEnd, fact]),
  );
}

function describeTrend(
  title: string,
  points: FinancialTrendPoint[],
  unit: FinancialTrend["unit"],
) {
  const available = points.filter(
    (point): point is FinancialTrendPoint & { value: number } =>
      point.value !== null,
  );

  if (available.length === 0) {
    return `No selected quarterly ${title.toLowerCase()} values are available.`;
  }

  const first = available[0];
  const last = available.at(-1)!;
  if (available.length === 1) {
    return `${formatValue(last.value, unit)} is available for the ${last.periodLabel.toLowerCase()}. More quarters are needed to show a trend.`;
  }

  const direction =
    last.value > first.value
      ? "increased"
      : last.value < first.value
        ? "decreased"
        : "was unchanged";

  return `${title} ${direction} from ${formatValue(first.value, unit)} to ${formatValue(last.value, unit)} across ${available.length} available quarters.`;
}

function buildSeries(input: {
  id: FinancialTrend["id"];
  title: string;
  description: string;
  unit: FinancialTrend["unit"];
  periods: string[];
  values: Map<string, number>;
}) {
  const points = input.periods.map((periodEnd) => ({
    periodEnd,
    periodLabel: formatPeriod(periodEnd),
    value: input.values.get(periodEnd) ?? null,
  }));
  const availableCount = points.filter((point) => point.value !== null).length;
  const missingPeriods = points
    .filter((point) => point.value === null)
    .map((point) => point.periodLabel);

  return {
    id: input.id,
    title: input.title,
    description: input.description,
    unit: input.unit,
    status:
      availableCount === 0
        ? "MISSING"
        : missingPeriods.length > 0 || availableCount === 1
          ? "PARTIAL"
          : "AVAILABLE",
    summary: describeTrend(input.title, points, input.unit),
    points,
    missingPeriods,
  } satisfies FinancialTrend;
}

export function buildFinancialTrends(
  snapshot: Pick<FundamentalsSnapshot, "trendFacts" | "trendPeriods">,
): FinancialTrend[] {
  const revenueFacts = quarterlyFactMap(snapshot.trendFacts, "REVENUE", "USD");
  const epsFacts = quarterlyFactMap(
    snapshot.trendFacts,
    "DILUTED_EPS",
    "USD/share",
  );
  const operatingCashFlowFacts = quarterlyFactMap(
    snapshot.trendFacts,
    "OPERATING_CASH_FLOW",
    "USD",
  );
  const capitalExpenditureFacts = quarterlyFactMap(
    snapshot.trendFacts,
    "CAPITAL_EXPENDITURES",
    "USD",
  );
  const periods = [...new Set(snapshot.trendPeriods)]
    .sort()
    .slice(-maximumPeriods);
  const freeCashFlow = new Map<string, number>();

  for (const periodEnd of periods) {
    const operatingCashFlow = operatingCashFlowFacts.get(periodEnd);
    const capitalExpenditures = capitalExpenditureFacts.get(periodEnd);
    if (
      operatingCashFlow &&
      capitalExpenditures &&
      operatingCashFlow.periodStart === capitalExpenditures.periodStart
    ) {
      freeCashFlow.set(
        periodEnd,
        operatingCashFlow.value - capitalExpenditures.value,
      );
    }
  }

  return [
    buildSeries({
      id: "REVENUE",
      title: "Quarterly Revenue",
      description: "Sales reported for each available quarter.",
      unit: "USD",
      periods,
      values: new Map(
        [...revenueFacts].map(([periodEnd, fact]) => [periodEnd, fact.value]),
      ),
    }),
    buildSeries({
      id: "DILUTED_EPS",
      title: "Quarterly Diluted EPS",
      description: "Profit attributable to each diluted share for the quarter.",
      unit: "USD_PER_SHARE",
      periods,
      values: new Map(
        [...epsFacts].map(([periodEnd, fact]) => [periodEnd, fact.value]),
      ),
    }),
    buildSeries({
      id: "FREE_CASH_FLOW",
      title: "Quarterly Free Cash Flow",
      description:
        "Operating cash flow minus capital expenditures for matching quarters.",
      unit: "USD",
      periods,
      values: freeCashFlow,
    }),
  ];
}
