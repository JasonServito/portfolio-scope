import type { FactSelection, PeriodKind } from "@/lib/sec/normalization";

/**
 * Deterministic metrics derived from selected SEC facts. The formulas mirror
 * the stock-page headline calculators (free cash flow, operating margin, and
 * long-term debt-to-equity) and extend them with growth, net margin, free
 * cash flow margin, current ratio, net cash, and diluted-share change. Every
 * value is computed only from inputs whose period boundaries and units match,
 * and every unavailable value states why. Research applies stricter guards
 * than the stock page: negative equity, non-positive current liabilities, and
 * negative reported capital expenditures stay unavailable with a reason.
 */
export const SEC_DERIVED_METRICS_VERSION = "sec-derived-v1";

export type DerivedMetricInputFact = {
  referenceId: string;
  metric: string;
  value: number;
  unit: string;
  periodKind: PeriodKind;
  periodStart: string | null;
  periodEnd: string;
  filedAt: string;
  selection: FactSelection;
};

export type DerivedMetricId =
  | "REVENUE_GROWTH_YOY"
  | "DILUTED_EPS_GROWTH_YOY"
  | "OPERATING_MARGIN"
  | "NET_MARGIN"
  | "FREE_CASH_FLOW"
  | "FREE_CASH_FLOW_MARGIN"
  | "DEBT_TO_EQUITY"
  | "CURRENT_RATIO"
  | "NET_CASH"
  | "DILUTED_SHARE_CHANGE_YOY";

export type DerivedMetricUnit = "USD" | "PERCENT" | "RATIO";
export type DerivedMetricPeriodKind = "ANNUAL" | "QUARTERLY" | "INSTANT";

export type DerivedMetricInput = {
  role: string;
  referenceId: string;
  metric: string;
  value: number;
  unit: string;
  periodStart: string | null;
  periodEnd: string;
};

export type DerivedMetric = {
  id: DerivedMetricId;
  label: string;
  formula: string;
  unit: DerivedMetricUnit;
  periodKind: DerivedMetricPeriodKind;
  periodStart: string | null;
  periodEnd: string | null;
  value: number | null;
  inputs: DerivedMetricInput[];
  unavailableReason: string | null;
  calculationVersion: typeof SEC_DERIVED_METRICS_VERSION;
};

export type PeriodBoundaries = {
  periodStart: string | null;
  periodEnd: string;
};

const DURATION_PERIOD_KINDS: DerivedMetricPeriodKind[] = ["ANNUAL", "QUARTERLY"];
// Derived values keep 12 significant digits so they survive JSON stores that
// format doubles with 16 digits (Prisma Json columns) without changing the
// immutable snapshot hash. Excerpts round further for display.
const VALUE_SIGNIFICANT_DIGITS = 12;
const COMPARABLE_MIN_DAYS = 340;
const COMPARABLE_MAX_DAYS = 390;
const COMPARABLE_LENGTH_TOLERANCE_DAYS = 14;

type Definition = Pick<DerivedMetric, "id" | "label" | "formula" | "unit">;

const definitions = {
  REVENUE_GROWTH_YOY: {
    id: "REVENUE_GROWTH_YOY",
    label: "Revenue growth (year over year)",
    formula:
      "(REVENUE[current] - REVENUE[prior year]) / |REVENUE[prior year]| x 100",
    unit: "PERCENT",
  },
  DILUTED_EPS_GROWTH_YOY: {
    id: "DILUTED_EPS_GROWTH_YOY",
    label: "Diluted EPS growth (year over year)",
    formula:
      "(DILUTED_EPS[current] - DILUTED_EPS[prior year]) / |DILUTED_EPS[prior year]| x 100",
    unit: "PERCENT",
  },
  OPERATING_MARGIN: {
    id: "OPERATING_MARGIN",
    label: "Operating margin",
    formula: "OPERATING_INCOME / REVENUE x 100",
    unit: "PERCENT",
  },
  NET_MARGIN: {
    id: "NET_MARGIN",
    label: "Net margin",
    formula: "NET_INCOME / REVENUE x 100",
    unit: "PERCENT",
  },
  FREE_CASH_FLOW: {
    id: "FREE_CASH_FLOW",
    label: "Free cash flow",
    formula: "OPERATING_CASH_FLOW - CAPITAL_EXPENDITURES",
    unit: "USD",
  },
  FREE_CASH_FLOW_MARGIN: {
    id: "FREE_CASH_FLOW_MARGIN",
    label: "Free cash flow margin",
    formula: "(OPERATING_CASH_FLOW - CAPITAL_EXPENDITURES) / REVENUE x 100",
    unit: "PERCENT",
  },
  DEBT_TO_EQUITY: {
    id: "DEBT_TO_EQUITY",
    label: "Long-term debt-to-equity",
    formula: "LONG_TERM_DEBT / STOCKHOLDERS_EQUITY",
    unit: "RATIO",
  },
  CURRENT_RATIO: {
    id: "CURRENT_RATIO",
    label: "Current ratio",
    formula: "CURRENT_ASSETS / CURRENT_LIABILITIES",
    unit: "RATIO",
  },
  NET_CASH: {
    id: "NET_CASH",
    label: "Net cash",
    formula: "CASH_AND_EQUIVALENTS - LONG_TERM_DEBT",
    unit: "USD",
  },
  DILUTED_SHARE_CHANGE_YOY: {
    id: "DILUTED_SHARE_CHANGE_YOY",
    label: "Diluted share change (year over year)",
    formula:
      "(DILUTED_SHARES[current] - DILUTED_SHARES[prior year]) / |DILUTED_SHARES[prior year]| x 100",
    unit: "PERCENT",
  },
} satisfies Record<DerivedMetricId, Definition>;

function dateOnly(value: string) {
  return value.slice(0, 10);
}

function daysBetween(start: string, end: string) {
  return Math.round(
    (Date.parse(`${dateOnly(end)}T00:00:00.000Z`) -
      Date.parse(`${dateOnly(start)}T00:00:00.000Z`)) /
      86_400_000,
  );
}

function periodLengthDays(period: PeriodBoundaries) {
  return period.periodStart === null
    ? 0
    : daysBetween(period.periodStart, period.periodEnd) + 1;
}

/** Whether two observations share exact period boundaries. */
export function samePeriod(left: PeriodBoundaries, right: PeriodBoundaries) {
  return (
    dateOnly(left.periodEnd) === dateOnly(right.periodEnd) &&
    (left.periodStart === null ? null : dateOnly(left.periodStart)) ===
      (right.periodStart === null ? null : dateOnly(right.periodStart))
  );
}

/**
 * Whether `candidate` ends roughly one year before `reference` with a similar
 * span, allowing for 52/53-week fiscal calendars.
 */
export function isPriorYearComparable(
  candidate: PeriodBoundaries,
  reference: PeriodBoundaries,
) {
  const gap = daysBetween(candidate.periodEnd, reference.periodEnd);
  return (
    gap >= COMPARABLE_MIN_DAYS &&
    gap <= COMPARABLE_MAX_DAYS &&
    Math.abs(periodLengthDays(candidate) - periodLengthDays(reference)) <=
      COMPARABLE_LENGTH_TOLERANCE_DAYS
  );
}

/** Distance from an exact one-year gap, used to prefer the nearest comparable. */
export function priorYearDistance(
  candidate: PeriodBoundaries,
  reference: PeriodBoundaries,
) {
  return Math.abs(daysBetween(candidate.periodEnd, reference.periodEnd) - 365);
}

function describePeriod(fact: PeriodBoundaries) {
  return fact.periodStart
    ? `${dateOnly(fact.periodStart)} through ${dateOnly(fact.periodEnd)}`
    : `ending ${dateOnly(fact.periodEnd)}`;
}

function describeKind(periodKind: PeriodKind) {
  return periodKind === "INSTANT"
    ? "reporting date"
    : `${periodKind.toLowerCase()} period`;
}

function compareLatest(
  left: DerivedMetricInputFact,
  right: DerivedMetricInputFact,
) {
  return (
    dateOnly(right.periodEnd).localeCompare(dateOnly(left.periodEnd)) ||
    dateOnly(right.filedAt).localeCompare(dateOnly(left.filedAt)) ||
    left.referenceId.localeCompare(right.referenceId)
  );
}

type DerivationContext = {
  facts: readonly DerivedMetricInputFact[];
  ambiguousMetrics: ReadonlySet<string>;
};

function factsFor(
  context: DerivationContext,
  metric: string,
  periodKind: PeriodKind,
) {
  return context.facts
    .filter(
      (fact) =>
        fact.metric === metric &&
        fact.periodKind === periodKind &&
        fact.selection !== "SUPERSEDED",
    )
    .sort(compareLatest);
}

type Resolved =
  | { fact: DerivedMetricInputFact; reason?: never }
  | { fact?: never; reason: string };

function missingReason(
  context: DerivationContext,
  metric: string,
  periodKind: PeriodKind,
  detail: string,
) {
  return context.ambiguousMetrics.has(metric)
    ? `${metric} is withheld because its latest ${describeKind(periodKind)} observation is ambiguous across filings.`
    : detail;
}

/** The latest observation of a metric, or the reason it cannot be used. */
function latest(
  context: DerivationContext,
  metric: string,
  periodKind: PeriodKind,
  expectedUnit: string,
): Resolved {
  const candidates = factsFor(context, metric, periodKind);
  const newest = candidates[0];
  if (!newest) {
    return {
      reason: missingReason(
        context,
        metric,
        periodKind,
        `${metric} has no selected ${describeKind(periodKind)} observation.`,
      ),
    };
  }
  const latestPeriod = candidates.filter((fact) => samePeriod(fact, newest));
  if (latestPeriod.some((fact) => fact.selection === "AMBIGUOUS")) {
    return {
      reason: `${metric} for the ${describeKind(periodKind)} ${describePeriod(newest)} is ambiguous across filings.`,
    };
  }
  return unitChecked(newest, expectedUnit);
}

/** The observation of a metric that shares the reference fact's exact period. */
function matching(
  context: DerivationContext,
  metric: string,
  reference: DerivedMetricInputFact,
  expectedUnit: string,
): Resolved {
  const candidates = factsFor(context, metric, reference.periodKind).filter(
    (fact) => samePeriod(fact, reference),
  );
  if (candidates.some((fact) => fact.selection === "AMBIGUOUS")) {
    return {
      reason: `${metric} for the ${describeKind(reference.periodKind)} ${describePeriod(reference)} is ambiguous across filings.`,
    };
  }
  const fact = candidates.find((candidate) => candidate.selection === "SELECTED");
  if (!fact) {
    return {
      reason: missingReason(
        context,
        metric,
        reference.periodKind,
        `${metric} for the ${describeKind(reference.periodKind)} ${describePeriod(reference)} is not in the selected facts.`,
      ),
    };
  }
  return unitChecked(fact, expectedUnit);
}

/** The observation one year before the reference fact with a comparable span. */
function priorYear(
  context: DerivationContext,
  reference: DerivedMetricInputFact,
  expectedUnit: string,
): Resolved {
  const window = factsFor(
    context,
    reference.metric,
    reference.periodKind,
  ).filter((fact) => isPriorYearComparable(fact, reference));
  const nearest = [...window].sort(
    (left, right) =>
      priorYearDistance(left, reference) - priorYearDistance(right, reference) ||
      compareLatest(left, right),
  )[0];
  if (!nearest) {
    return {
      reason: `${reference.metric} for the prior-year ${describeKind(reference.periodKind)} comparable to ${describePeriod(reference)} is not in the selected facts.`,
    };
  }
  if (
    window.some(
      (fact) => samePeriod(fact, nearest) && fact.selection === "AMBIGUOUS",
    )
  ) {
    return {
      reason: `${reference.metric} for the prior-year ${describeKind(reference.periodKind)} ${describePeriod(nearest)} is ambiguous across filings.`,
    };
  }
  return unitChecked(nearest, expectedUnit);
}

function unitChecked(
  fact: DerivedMetricInputFact,
  expectedUnit: string,
): Resolved {
  if (fact.unit !== expectedUnit) {
    return {
      reason: `${fact.metric} for the ${describeKind(fact.periodKind)} ${describePeriod(fact)} is reported in ${fact.unit}, not ${expectedUnit}.`,
    };
  }
  return { fact };
}

function input(role: string, fact: DerivedMetricInputFact): DerivedMetricInput {
  return {
    role,
    referenceId: fact.referenceId,
    metric: fact.metric,
    value: fact.value,
    unit: fact.unit,
    periodStart: fact.periodStart === null ? null : dateOnly(fact.periodStart),
    periodEnd: dateOnly(fact.periodEnd),
  };
}

function unavailable(
  definition: Definition,
  periodKind: DerivedMetricPeriodKind,
  reason: string,
  reference?: DerivedMetricInputFact,
): DerivedMetric {
  return {
    ...definition,
    periodKind,
    periodStart:
      reference?.periodStart === undefined || reference.periodStart === null
        ? null
        : dateOnly(reference.periodStart),
    periodEnd: reference ? dateOnly(reference.periodEnd) : null,
    value: null,
    inputs: [],
    unavailableReason: reason,
    calculationVersion: SEC_DERIVED_METRICS_VERSION,
  };
}

function available(
  definition: Definition,
  periodKind: DerivedMetricPeriodKind,
  reference: DerivedMetricInputFact,
  value: number,
  inputs: DerivedMetricInput[],
): DerivedMetric {
  if (!Number.isFinite(value)) {
    return unavailable(
      definition,
      periodKind,
      "The calculation did not produce a finite value.",
      reference,
    );
  }
  return {
    ...definition,
    periodKind,
    periodStart:
      reference.periodStart === null ? null : dateOnly(reference.periodStart),
    periodEnd: dateOnly(reference.periodEnd),
    value: Number(value.toPrecision(VALUE_SIGNIFICANT_DIGITS)),
    inputs,
    unavailableReason: null,
    calculationVersion: SEC_DERIVED_METRICS_VERSION,
  };
}

function growth(
  context: DerivationContext,
  definition: Definition,
  metric: string,
  unit: string,
  periodKind: DerivedMetricPeriodKind,
): DerivedMetric {
  const current = latest(context, metric, periodKind, unit);
  if (!current.fact) return unavailable(definition, periodKind, current.reason);
  const prior = priorYear(context, current.fact, unit);
  if (!prior.fact) {
    return unavailable(definition, periodKind, prior.reason, current.fact);
  }
  if (prior.fact.value === 0) {
    return unavailable(
      definition,
      periodKind,
      `${metric} for the prior-year ${describeKind(periodKind)} ${describePeriod(prior.fact)} is zero, so growth cannot be computed.`,
      current.fact,
    );
  }
  return available(
    definition,
    periodKind,
    current.fact,
    ((current.fact.value - prior.fact.value) / Math.abs(prior.fact.value)) *
      100,
    [input("current", current.fact), input("prior year", prior.fact)],
  );
}

function ratio(
  context: DerivationContext,
  definition: Definition,
  numeratorMetric: string,
  denominatorMetric: string,
  periodKind: DerivedMetricPeriodKind,
  options: { percent: boolean; denominatorMustBePositive: boolean },
): DerivedMetric {
  const numerator = latest(context, numeratorMetric, periodKind, "USD");
  if (!numerator.fact) {
    return unavailable(definition, periodKind, numerator.reason);
  }
  const denominator = matching(
    context,
    denominatorMetric,
    numerator.fact,
    "USD",
  );
  if (!denominator.fact) {
    return unavailable(
      definition,
      periodKind,
      denominator.reason,
      numerator.fact,
    );
  }
  if (denominator.fact.value === 0) {
    return unavailable(
      definition,
      periodKind,
      `${denominatorMetric} for the ${describeKind(periodKind)} ${describePeriod(denominator.fact)} is zero, so the ratio cannot be computed.`,
      numerator.fact,
    );
  }
  if (options.denominatorMustBePositive && denominator.fact.value < 0) {
    return unavailable(
      definition,
      periodKind,
      `${denominatorMetric} for the ${describeKind(periodKind)} ${describePeriod(denominator.fact)} is negative, so the ratio is not meaningful.`,
      numerator.fact,
    );
  }
  const value = numerator.fact.value / denominator.fact.value;
  return available(
    definition,
    periodKind,
    numerator.fact,
    options.percent ? value * 100 : value,
    [input("numerator", numerator.fact), input("denominator", denominator.fact)],
  );
}

function freeCashFlowInputs(
  context: DerivationContext,
  periodKind: DerivedMetricPeriodKind,
):
  | {
      operatingCashFlow: DerivedMetricInputFact;
      capitalExpenditures: DerivedMetricInputFact;
      value: number;
      reason?: never;
      reference?: never;
    }
  | { reason: string; reference?: DerivedMetricInputFact } {
  const operatingCashFlow = latest(
    context,
    "OPERATING_CASH_FLOW",
    periodKind,
    "USD",
  );
  if (!operatingCashFlow.fact) return { reason: operatingCashFlow.reason };
  const capitalExpenditures = matching(
    context,
    "CAPITAL_EXPENDITURES",
    operatingCashFlow.fact,
    "USD",
  );
  if (!capitalExpenditures.fact) {
    return {
      reason: capitalExpenditures.reason,
      reference: operatingCashFlow.fact,
    };
  }
  if (capitalExpenditures.fact.value < 0) {
    return {
      reason: `CAPITAL_EXPENDITURES for the ${describeKind(periodKind)} ${describePeriod(capitalExpenditures.fact)} was reported with a negative sign, so its cash-outflow convention could not be confirmed.`,
      reference: operatingCashFlow.fact,
    };
  }
  return {
    operatingCashFlow: operatingCashFlow.fact,
    capitalExpenditures: capitalExpenditures.fact,
    value: operatingCashFlow.fact.value - capitalExpenditures.fact.value,
  };
}

function freeCashFlow(
  context: DerivationContext,
  periodKind: DerivedMetricPeriodKind,
): DerivedMetric {
  const definition = definitions.FREE_CASH_FLOW;
  const resolved = freeCashFlowInputs(context, periodKind);
  if (resolved.reason !== undefined) {
    return unavailable(
      definition,
      periodKind,
      resolved.reason,
      resolved.reference,
    );
  }
  return available(
    definition,
    periodKind,
    resolved.operatingCashFlow,
    resolved.value,
    [
      input("operating cash flow", resolved.operatingCashFlow),
      input("capital expenditures", resolved.capitalExpenditures),
    ],
  );
}

function freeCashFlowMargin(
  context: DerivationContext,
  periodKind: DerivedMetricPeriodKind,
): DerivedMetric {
  const definition = definitions.FREE_CASH_FLOW_MARGIN;
  const resolved = freeCashFlowInputs(context, periodKind);
  if (resolved.reason !== undefined) {
    return unavailable(
      definition,
      periodKind,
      resolved.reason,
      resolved.reference,
    );
  }
  const revenue = matching(
    context,
    "REVENUE",
    resolved.operatingCashFlow,
    "USD",
  );
  if (!revenue.fact) {
    return unavailable(
      definition,
      periodKind,
      revenue.reason,
      resolved.operatingCashFlow,
    );
  }
  if (revenue.fact.value === 0) {
    return unavailable(
      definition,
      periodKind,
      `REVENUE for the ${describeKind(periodKind)} ${describePeriod(revenue.fact)} is zero, so the margin cannot be computed.`,
      resolved.operatingCashFlow,
    );
  }
  return available(
    definition,
    periodKind,
    resolved.operatingCashFlow,
    (resolved.value / revenue.fact.value) * 100,
    [
      input("operating cash flow", resolved.operatingCashFlow),
      input("capital expenditures", resolved.capitalExpenditures),
      input("revenue", revenue.fact),
    ],
  );
}

function netCash(context: DerivationContext): DerivedMetric {
  const definition = definitions.NET_CASH;
  const cash = latest(context, "CASH_AND_EQUIVALENTS", "INSTANT", "USD");
  if (!cash.fact) return unavailable(definition, "INSTANT", cash.reason);
  const debt = matching(context, "LONG_TERM_DEBT", cash.fact, "USD");
  if (!debt.fact) {
    return unavailable(definition, "INSTANT", debt.reason, cash.fact);
  }
  return available(
    definition,
    "INSTANT",
    cash.fact,
    cash.fact.value - debt.fact.value,
    [input("cash and equivalents", cash.fact), input("long-term debt", debt.fact)],
  );
}

export function buildDerivedMetrics(
  facts: readonly DerivedMetricInputFact[],
  options: { ambiguousMetrics?: readonly string[] } = {},
): DerivedMetric[] {
  const context: DerivationContext = {
    facts,
    ambiguousMetrics: new Set(options.ambiguousMetrics ?? []),
  };
  const metrics: DerivedMetric[] = [];
  for (const periodKind of DURATION_PERIOD_KINDS) {
    metrics.push(
      growth(
        context,
        definitions.REVENUE_GROWTH_YOY,
        "REVENUE",
        "USD",
        periodKind,
      ),
      growth(
        context,
        definitions.DILUTED_EPS_GROWTH_YOY,
        "DILUTED_EPS",
        "USD/share",
        periodKind,
      ),
      ratio(
        context,
        definitions.OPERATING_MARGIN,
        "OPERATING_INCOME",
        "REVENUE",
        periodKind,
        { percent: true, denominatorMustBePositive: false },
      ),
      ratio(
        context,
        definitions.NET_MARGIN,
        "NET_INCOME",
        "REVENUE",
        periodKind,
        { percent: true, denominatorMustBePositive: false },
      ),
      freeCashFlow(context, periodKind),
      freeCashFlowMargin(context, periodKind),
      growth(
        context,
        definitions.DILUTED_SHARE_CHANGE_YOY,
        "DILUTED_SHARES",
        "shares",
        periodKind,
      ),
    );
  }
  metrics.push(
    ratio(
      context,
      definitions.DEBT_TO_EQUITY,
      "LONG_TERM_DEBT",
      "STOCKHOLDERS_EQUITY",
      "INSTANT",
      { percent: false, denominatorMustBePositive: true },
    ),
    ratio(
      context,
      definitions.CURRENT_RATIO,
      "CURRENT_ASSETS",
      "CURRENT_LIABILITIES",
      "INSTANT",
      { percent: false, denominatorMustBePositive: true },
    ),
    netCash(context),
  );
  return metrics;
}

export function formatDerivedValue(value: number, unit: DerivedMetricUnit) {
  switch (unit) {
    case "PERCENT":
      return `${value.toFixed(1)} percent`;
    case "RATIO":
      return value.toFixed(2);
    case "USD":
      return `${new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 0,
      }).format(Math.round(value))} USD`;
  }
}
