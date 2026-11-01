import { evidenceId, type ResearchEvidence } from "@/lib/research/ai/schemas";
import type { ResearchAgentName } from "@/lib/research/types";
import {
  buildDerivedMetrics,
  DERIVED_METRIC_CAVEATS,
  formatDerivedValue,
  roundDerivedValue,
  SEC_DERIVED_METRICS_VERSION,
  type DerivedMetric,
  type DerivedMetricInputFact,
} from "@/lib/sec/derived-metrics";
import { buildFinancialTrends } from "@/lib/sec/financial-trends";
import type { CanonicalFundamentalFact } from "@/lib/sec/fundamentals-provider";
import {
  expectedMetricNames,
  metricDefinitions,
  type FactSelection,
  type PeriodKind,
} from "@/lib/sec/normalization";

/**
 * Always-included structured evidence built deterministically from selected
 * SEC facts: derived metrics, a financial summary table, an eight-quarter
 * trend excerpt, a peer comparison table, and the stored upcoming earnings
 * event. Every value is either a reported fact or a deterministic derivation
 * whose inputs are recorded; nothing here comes from a model. Evidence text
 * avoids the application name so privacy checks can grep for "portfolio".
 */

export type StructuredFact = {
  referenceId: string;
  evidenceId: string | null;
  externalKey: string;
  metric: string;
  label: string;
  value: number;
  unit: string;
  periodKind: PeriodKind;
  periodStart: string | null;
  periodEnd: string;
  filedAt: string;
  accessionNumber: string;
  selection: FactSelection;
};

export type StructuredStock = {
  ticker: string;
  companyName: string;
  cik: string | null;
};

export type StructuredPeer = {
  ticker: string;
  companyName: string;
  cik: string | null;
  relationship: "INDUSTRY" | "SECTOR";
  facts: readonly StructuredFact[];
  ambiguousMetrics: readonly string[];
};

// The fetch time deliberately stays out of the snapshot: the earnings state
// is refreshed every day or two, and including it would change the snapshot
// fingerprint and defeat report reuse without any new information.
export type UpcomingEarningsObservation = {
  eventDate: string;
  marketSession: string | null;
  source: string;
};

export const STRUCTURED_EVIDENCE_TYPES = {
  derivedMetric: "DERIVED_METRIC",
  financialSummary: "FINANCIAL_SUMMARY_TABLE",
  financialTrend: "FINANCIAL_TREND_EXCERPT",
  peerComparison: "PEER_COMPARISON_TABLE",
  upcomingEarnings: "UPCOMING_EARNINGS_EVENT",
} as const;

const MAX_EXCERPT = 4_000;
// A quarter is compared with the one ending about a year earlier; fiscal
// quarters end on different weekdays, so the window allows a few days.
const SAME_QUARTER_MIN_DAYS = 350;
const SAME_QUARTER_MAX_DAYS = 380;
const TREND_SERIES_NAMES: Record<string, string> = {
  REVENUE: "Revenue",
  DILUTED_EPS: "Diluted EPS",
  FREE_CASH_FLOW: "Free cash flow",
};
const TREND_METRICS = [
  "REVENUE",
  "DILUTED_EPS",
  "OPERATING_CASH_FLOW",
  "CAPITAL_EXPENDITURES",
] as const;
const MANDATORY_DERIVED_FOR_FINANCIALS = new Set([
  "REVENUE_GROWTH_YOY:ANNUAL",
  "OPERATING_MARGIN:ANNUAL",
  "FREE_CASH_FLOW_MARGIN:ANNUAL",
  "DEBT_TO_EQUITY:INSTANT",
]);
const MANDATORY_DERIVED_FOR_RISK = new Set([
  "DEBT_TO_EQUITY:INSTANT",
  "CURRENT_RATIO:INSTANT",
  "NET_CASH:INSTANT",
]);
const MANDATORY_DERIVED_FOR_SYNTHESIS = new Set(["REVENUE_GROWTH_YOY:ANNUAL"]);

const metricLabels = new Map(
  metricDefinitions.map((definition) => [
    definition.canonicalMetric,
    definition.label,
  ]),
);

function clip(value: string, maximum = MAX_EXCERPT) {
  const normalized = value.trim();
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function integer(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    Math.round(value),
  );
}

function formatFactValue(value: number, unit: string) {
  if (unit === "USD/share") return `${value.toFixed(2)} USD per share`;
  if (unit === "shares") return `${integer(value)} shares`;
  return `${integer(value)} ${unit}`;
}

function describePeriod(fact: {
  periodStart: string | null;
  periodEnd: string;
}) {
  return fact.periodStart
    ? `${fact.periodStart} to ${fact.periodEnd}`
    : `at ${fact.periodEnd}`;
}

function toDerivedInput(fact: StructuredFact): DerivedMetricInputFact {
  return {
    referenceId: fact.referenceId,
    metric: fact.metric,
    value: fact.value,
    unit: fact.unit,
    periodKind: fact.periodKind,
    periodStart: fact.periodStart,
    periodEnd: fact.periodEnd,
    filedAt: fact.filedAt,
    selection: fact.selection,
  };
}

function metricKey(metric: DerivedMetric) {
  return `${metric.id}:${metric.periodKind}`;
}

function latestSelected(
  facts: readonly StructuredFact[],
  metric: string,
  periodKind: PeriodKind,
) {
  return facts
    .filter(
      (fact) =>
        fact.metric === metric &&
        fact.periodKind === periodKind &&
        fact.selection === "SELECTED",
    )
    .sort(
      (left, right) =>
        right.periodEnd.localeCompare(left.periodEnd) ||
        right.filedAt.localeCompare(left.filedAt) ||
        left.referenceId.localeCompare(right.referenceId),
    )[0];
}

function inputsById(facts: readonly StructuredFact[]) {
  return new Map(facts.map((fact) => [fact.referenceId, fact]));
}

function describeInput(input: DerivedMetric["inputs"][number]) {
  return `${input.role} ${input.metric} ${formatFactValue(input.value, input.unit)} (${describePeriod(input)})`;
}

function latestFiledAt(
  metric: DerivedMetric,
  factsByReference: Map<string, StructuredFact>,
) {
  return (
    metric.inputs
      .map((input) => factsByReference.get(input.referenceId)?.filedAt ?? null)
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null
  );
}

function derivedTitle(metric: DerivedMetric) {
  const scope =
    metric.periodKind === "INSTANT"
      ? `at ${metric.periodEnd}`
      : `${metric.periodKind.toLowerCase()} period ending ${metric.periodEnd}`;
  return `${metric.label} — ${scope}`;
}

const DERIVED_AGENT_NAMES: ResearchAgentName[] = [
  "FINANCIALS",
  "RISK",
  "COMPETITORS",
  "SYNTHESIS",
];

function derivedMandatoryAgents(metric: DerivedMetric): ResearchAgentName[] {
  const key = metricKey(metric);
  const agents: ResearchAgentName[] = [];
  if (MANDATORY_DERIVED_FOR_FINANCIALS.has(key)) agents.push("FINANCIALS");
  if (MANDATORY_DERIVED_FOR_RISK.has(key)) agents.push("RISK");
  if (MANDATORY_DERIVED_FOR_SYNTHESIS.has(key)) agents.push("SYNTHESIS");
  return agents;
}

export function buildDerivedMetricEvidence(
  stock: StructuredStock,
  facts: readonly StructuredFact[],
  ambiguousMetrics: readonly string[] = [],
): { metrics: DerivedMetric[]; evidence: ResearchEvidence[] } {
  const metrics = buildDerivedMetrics(facts.map(toDerivedInput), {
    ambiguousMetrics,
  });
  const factsByReference = inputsById(facts);
  const evidence = metrics
    .filter(
      (metric): metric is DerivedMetric & { value: number; periodEnd: string } =>
        metric.value !== null && metric.periodEnd !== null,
    )
    .map((metric): ResearchEvidence => {
      const sourceReference = `derived-metric:${stock.ticker}:${metric.id}:${metric.periodKind}:${metric.periodEnd}`;
      const inputs = metric.inputs.map((input) => ({
        ...input,
        evidenceId:
          factsByReference.get(input.referenceId)?.evidenceId ?? null,
        externalKey: factsByReference.get(input.referenceId)?.externalKey ?? null,
        accessionNumber:
          factsByReference.get(input.referenceId)?.accessionNumber ?? null,
      }));
      const excerpt = [
        `${metric.label}, ${metric.periodKind === "INSTANT" ? `at ${metric.periodEnd}` : `${metric.periodKind.toLowerCase()} period ${metric.periodStart} to ${metric.periodEnd}`}: ${formatDerivedValue(metric.value, metric.unit)}.`,
        `Formula: ${metric.formula}.`,
        `Inputs: ${metric.inputs.map(describeInput).join("; ")}.`,
        `A derived value (${SEC_DERIVED_METRICS_VERSION}) from the cited SEC facts; not reported by the filer.`,
      ].join(" ");
      return {
        id: evidenceId({ sourceKind: "DERIVED", sourceReference }),
        sourceKind: "DERIVED",
        title: clip(derivedTitle(metric), 240),
        sourceReference,
        sourceUrl: null,
        accessionNumber: null,
        section: "Derived metric",
        objectKey: null,
        sha256: null,
        sourceDate: latestFiledAt(metric, factsByReference),
        retrievedAt: null,
        excerpt: clip(excerpt),
        passageStart: null,
        passageEnd: null,
        secFilingId: null,
        secRawSourceId: null,
        secFinancialFactId: null,
        metadata: {
          evidenceType: STRUCTURED_EVIDENCE_TYPES.derivedMetric,
          agentNames: [...DERIVED_AGENT_NAMES],
          mandatoryAgentNames: derivedMandatoryAgents(metric),
          ticker: stock.ticker,
          metricId: metric.id,
          label: metric.label,
          formula: metric.formula,
          value: metric.value,
          unit: metric.unit,
          periodKind: metric.periodKind,
          periodStart: metric.periodStart,
          periodEnd: metric.periodEnd,
          inputs,
          inputEvidenceIds: inputs
            .map((input) => input.evidenceId)
            .filter((id): id is string => id !== null),
          isDerived: true,
          calculationVersion: metric.calculationVersion,
        },
      };
    });
  return { metrics, evidence };
}

function reportedRow(facts: readonly StructuredFact[], metric: string) {
  const label = metricLabels.get(metric) ?? metric;
  const instant = latestSelected(facts, metric, "INSTANT");
  if (instant) {
    return {
      text: `${label}: ${formatFactValue(instant.value, instant.unit)} ${describePeriod(instant)}.`,
      cells: [{ periodKind: "INSTANT", fact: instant }],
    };
  }
  const cells = (["ANNUAL", "QUARTERLY"] as const).flatMap((periodKind) => {
    const fact = latestSelected(facts, metric, periodKind);
    return fact ? [{ periodKind, fact }] : [];
  });
  if (cells.length === 0) {
    return { text: `${label}: not in the selected facts.`, cells };
  }
  return {
    text: `${label}: ${cells
      .map(
        (cell) =>
          `${cell.periodKind.toLowerCase()} ${formatFactValue(cell.fact.value, cell.fact.unit)} (${describePeriod(cell.fact)})`,
      )
      .join("; ")}.`,
    cells,
  };
}

function derivedRow(
  metrics: readonly DerivedMetric[],
  id: DerivedMetric["id"],
  withReasons: boolean,
) {
  const entries = metrics.filter((metric) => metric.id === id);
  const label = entries[0]?.label ?? id;
  const parts = entries.map((metric) => {
    const scope =
      metric.periodKind === "INSTANT" ? "" : `${metric.periodKind.toLowerCase()} `;
    if (metric.value === null) {
      return `${scope}unavailable${withReasons && metric.unavailableReason ? ` (${metric.unavailableReason})` : ""}`;
    }
    return `${scope}${formatDerivedValue(metric.value, metric.unit)} (${metric.periodKind === "INSTANT" ? `at ${metric.periodEnd}` : `period ending ${metric.periodEnd}`})`;
  });
  const caveat = DERIVED_METRIC_CAVEATS[id];
  return `${label}: ${parts.join("; ")}.${caveat ? ` ${caveat}` : ""}`;
}

const DERIVED_ROW_ORDER: DerivedMetric["id"][] = [
  "REVENUE_GROWTH_YOY",
  "DILUTED_EPS_GROWTH_YOY",
  "OPERATING_MARGIN",
  "NET_MARGIN",
  "FREE_CASH_FLOW",
  "FREE_CASH_FLOW_MARGIN",
  "DEBT_TO_EQUITY",
  "CURRENT_RATIO",
  "NET_CASH",
  "DILUTED_SHARE_CHANGE_YOY",
];

export function buildFinancialSummaryEvidence(
  stock: StructuredStock,
  facts: readonly StructuredFact[],
  metrics: readonly DerivedMetric[],
): ResearchEvidence {
  const sourceReference = `derived-financial-summary:${stock.ticker}`;
  const reported = [...expectedMetricNames]
    .sort()
    .map((metric) => ({ metric, ...reportedRow(facts, metric) }));
  const render = (withReasons: boolean) =>
    [
      `${stock.ticker} financial summary from selected SEC facts: latest annual and latest quarterly value per reported metric, plus derived metrics (${SEC_DERIVED_METRICS_VERSION}) calculated from those facts. Missing or unavailable values are stated, never zero.`,
      `Reported: ${reported.map((row) => row.text).join(" ")}`,
      `Derived: ${DERIVED_ROW_ORDER.map((id) => derivedRow(metrics, id, withReasons)).join(" ")}`,
    ].join("\n");
  const full = render(true);
  const excerpt = full.length <= MAX_EXCERPT ? full : clip(render(false));
  const cells = reported.flatMap((row) =>
    row.cells.map((cell) => ({
      metric: row.metric,
      periodKind: cell.periodKind,
      evidenceId: cell.fact.evidenceId,
      externalKey: cell.fact.externalKey,
      value: cell.fact.value,
      unit: cell.fact.unit,
      periodStart: cell.fact.periodStart,
      periodEnd: cell.fact.periodEnd,
      accessionNumber: cell.fact.accessionNumber,
    })),
  );
  return {
    id: evidenceId({ sourceKind: "DERIVED", sourceReference }),
    sourceKind: "DERIVED",
    title: `${stock.ticker} financial summary table`,
    sourceReference,
    sourceUrl: null,
    accessionNumber: null,
    section: "Financial summary",
    objectKey: null,
    sha256: null,
    sourceDate:
      cells
        .map((cell) => facts.find((fact) => fact.externalKey === cell.externalKey)?.filedAt ?? null)
        .filter((value): value is string => value !== null)
        .sort()
        .at(-1) ?? null,
    retrievedAt: null,
    excerpt,
    passageStart: null,
    passageEnd: null,
    secFilingId: null,
    secRawSourceId: null,
    secFinancialFactId: null,
    metadata: {
      evidenceType: STRUCTURED_EVIDENCE_TYPES.financialSummary,
      agentNames: ["FINANCIALS", "RISK", "COMPETITORS", "SYNTHESIS"],
      mandatoryAgentNames: ["FINANCIALS", "RISK", "SYNTHESIS"],
      ticker: stock.ticker,
      reported: cells,
      derived: metrics.map((metric) => ({
        metricId: metric.id,
        periodKind: metric.periodKind,
        periodStart: metric.periodStart,
        periodEnd: metric.periodEnd,
        value: metric.value,
        unit: metric.unit,
        unavailableReason: metric.unavailableReason,
        inputReferenceIds: metric.inputs.map((input) => input.referenceId),
      })),
      inputEvidenceIds: [
        ...new Set([
          ...cells.map((cell) => cell.evidenceId),
          ...metrics.flatMap((metric) =>
            metric.inputs.map(
              (input) =>
                facts.find((fact) => fact.referenceId === input.referenceId)
                  ?.evidenceId ?? null,
            ),
          ),
        ]),
      ].filter((id): id is string => id !== null),
      isDerived: true,
      calculationVersion: SEC_DERIVED_METRICS_VERSION,
    },
  };
}

function toCanonicalFact(fact: StructuredFact): CanonicalFundamentalFact {
  return {
    metric: fact.metric,
    label: fact.label,
    value: fact.value,
    unit: fact.unit,
    originalValue: String(fact.value),
    originalUnit: fact.unit,
    taxonomy: "us-gaap",
    concept: fact.metric,
    periodStart: fact.periodStart,
    periodEnd: fact.periodEnd,
    periodKind: fact.periodKind,
    fiscalYear: null,
    fiscalPeriod: null,
    formType: "",
    filedAt: fact.filedAt,
    accessionNumber: fact.accessionNumber,
    sourceUrl: "https://www.sec.gov/",
    observedAt: fact.filedAt,
    normalizationVersion: "",
    isDerived: false,
    selection: fact.selection,
  };
}

function daysApart(earlier: string, later: string) {
  return Math.round(
    (Date.parse(`${later.slice(0, 10)}T00:00:00.000Z`) -
      Date.parse(`${earlier.slice(0, 10)}T00:00:00.000Z`)) /
      86_400_000,
  );
}

/**
 * Same-quarter year-over-year changes within the trend window, using the
 * derived growth formula. Adjacent quarters are not compared because many
 * businesses are seasonal.
 */
function sameQuarterChanges(
  points: readonly {
    periodEnd: string;
    value: number | null;
    inputEvidenceIds: string[];
  }[],
) {
  return points.flatMap((point) => {
    if (point.value === null) return [];
    const prior = points.find((candidate) => {
      const days = daysApart(candidate.periodEnd, point.periodEnd);
      return days >= SAME_QUARTER_MIN_DAYS && days <= SAME_QUARTER_MAX_DAYS;
    });
    if (!prior || prior.value === null || prior.value === 0) return [];
    return [
      {
        periodEnd: point.periodEnd,
        priorPeriodEnd: prior.periodEnd,
        // Rounded like every derived value so the snapshot hash survives
        // Prisma Json storage.
        changePercent: roundDerivedValue(
          ((point.value - prior.value) / Math.abs(prior.value)) * 100,
        ),
        inputEvidenceIds: [
          ...new Set([...prior.inputEvidenceIds, ...point.inputEvidenceIds]),
        ],
      },
    ];
  });
}

export function buildTrendEvidence(
  stock: StructuredStock,
  facts: readonly StructuredFact[],
): ResearchEvidence {
  const sourceReference = `derived-financial-trend:${stock.ticker}`;
  const trendFacts = facts.filter(
    (fact) =>
      (TREND_METRICS as readonly string[]).includes(fact.metric) &&
      fact.periodKind === "QUARTERLY" &&
      fact.selection === "SELECTED",
  );
  const trendPeriods = [...new Set(trendFacts.map((fact) => fact.periodEnd))]
    .sort()
    .slice(-8);
  const trends = buildFinancialTrends({
    trendPeriods,
    trendFacts: trendFacts
      .filter((fact) => trendPeriods.includes(fact.periodEnd))
      .map(toCanonicalFact),
  });
  const factFor = (metric: string, periodEnd: string) =>
    trendFacts.find(
      (fact) => fact.metric === metric && fact.periodEnd === periodEnd,
    );
  const series = trends.map((trend) => ({
    id: trend.id,
    title: trend.title,
    unit: trend.unit,
    status: trend.status,
    summary: trend.summary,
    points: trend.points.map((point) => {
      const inputMetrics =
        trend.id === "FREE_CASH_FLOW"
          ? ["OPERATING_CASH_FLOW", "CAPITAL_EXPENDITURES"]
          : [trend.id];
      const inputs = inputMetrics
        .map((metric) => factFor(metric, point.periodEnd))
        .filter((fact): fact is StructuredFact => fact !== undefined);
      return {
        periodEnd: point.periodEnd,
        value: point.value,
        inputEvidenceIds: inputs
          .map((fact) => fact.evidenceId)
          .filter((id): id is string => id !== null),
        inputExternalKeys: inputs.map((fact) => fact.externalKey),
      };
    }),
  }));
  const lines = series.map((item) => {
    const points = item.points
      .map(
        (point) =>
          `${point.periodEnd}: ${
            point.value === null
              ? "not available"
              : item.unit === "USD_PER_SHARE"
                ? `${point.value.toFixed(2)} USD per share`
                : `${integer(point.value)} USD`
          }`,
      )
      .join("; ");
    // The first-to-last summary is omitted: it ignores seasonality, and the
    // same-quarter changes below state the comparable movement.
    return `${item.title}${item.id === "FREE_CASH_FLOW" ? " (operating cash flow minus capital expenditures)" : ""}: ${points}.`;
  });
  const yearOverYear = series.map((item) => ({
    id: item.id,
    title: item.title,
    changes: sameQuarterChanges(item.points).slice(-3),
  }));
  const yearOverYearText = yearOverYear
    .filter((item) => item.changes.length)
    .map(
      (item) =>
        `${TREND_SERIES_NAMES[item.id] ?? item.title} ${item.changes
          .map(
            (change) =>
              `${change.periodEnd}: ${formatDerivedValue(change.changePercent, "PERCENT")}`,
          )
          .join("; ")}`,
    )
    .join(". ");
  const excerpt = clip(
    [
      `${stock.ticker} eight-quarter trend excerpt from selected quarterly SEC facts (${trendPeriods.length} quarter${trendPeriods.length === 1 ? "" : "s"} available). A quarter marked not available has no selected quarterly observation; it is not zero.`,
      ...lines,
      ...(yearOverYearText
        ? [
            `Change from the same quarter a year earlier: ${yearOverYearText}.`,
          ]
        : []),
    ].join("\n"),
  );
  return {
    id: evidenceId({ sourceKind: "DERIVED", sourceReference }),
    sourceKind: "DERIVED",
    title: `${stock.ticker} quarterly trend excerpt`,
    sourceReference,
    sourceUrl: null,
    accessionNumber: null,
    section: "Financial trends",
    objectKey: null,
    sha256: null,
    sourceDate: trendFacts.map((fact) => fact.filedAt).sort().at(-1) ?? null,
    retrievedAt: null,
    excerpt,
    passageStart: null,
    passageEnd: null,
    secFilingId: null,
    secRawSourceId: null,
    secFinancialFactId: null,
    metadata: {
      evidenceType: STRUCTURED_EVIDENCE_TYPES.financialTrend,
      agentNames: ["FINANCIALS", "RISK", "SYNTHESIS"],
      mandatoryAgentNames: ["FINANCIALS", "SYNTHESIS"],
      ticker: stock.ticker,
      periods: trendPeriods,
      series,
      yearOverYear,
      inputEvidenceIds: [
        ...new Set(
          series.flatMap((item) =>
            item.points.flatMap((point) => point.inputEvidenceIds),
          ),
        ),
      ],
      isDerived: true,
      calculationVersion: SEC_DERIVED_METRICS_VERSION,
    },
  };
}

type PeerRow = {
  ticker: string;
  companyName: string;
  cik: string | null;
  relationship: "SUBJECT" | "INDUSTRY" | "SECTOR";
  revenue: StructuredFact | undefined;
  metrics: DerivedMetric[];
};

function peerCell(row: PeerRow, id: DerivedMetric["id"]) {
  const metric = row.metrics.find(
    (candidate) =>
      candidate.id === id &&
      (id === "DEBT_TO_EQUITY" || id === "CURRENT_RATIO"
        ? candidate.periodKind === "INSTANT"
        : candidate.periodKind === "ANNUAL"),
  );
  if (!metric || metric.value === null) return "n/a";
  return `${formatDerivedValue(metric.value, metric.unit)}${metric.periodKind === "INSTANT" ? ` (at ${metric.periodEnd})` : ""}`;
}

function peerRowText(row: PeerRow) {
  const name = `${row.ticker}${row.relationship === "SUBJECT" ? " (subject)" : ""}`;
  if (!row.revenue && row.metrics.every((metric) => metric.value === null)) {
    return `${name}: no selected annual SEC facts in this snapshot.`;
  }
  return `${name}: revenue ${row.revenue ? `${formatFactValue(row.revenue.value, row.revenue.unit)} (annual period ending ${row.revenue.periodEnd})` : "n/a"}; revenue growth ${peerCell(row, "REVENUE_GROWTH_YOY")}; operating margin ${peerCell(row, "OPERATING_MARGIN")}; net margin ${peerCell(row, "NET_MARGIN")}; free cash flow margin ${peerCell(row, "FREE_CASH_FLOW_MARGIN")}; long-term debt-to-equity ${peerCell(row, "DEBT_TO_EQUITY")}; current ratio ${peerCell(row, "CURRENT_RATIO")}.`;
}

export function buildPeerComparisonEvidence(
  stock: StructuredStock,
  subject: { facts: readonly StructuredFact[]; metrics: readonly DerivedMetric[] },
  peers: readonly StructuredPeer[],
): ResearchEvidence {
  const sourceReference = `derived-peer-comparison:${stock.ticker}`;
  const rows: PeerRow[] = [
    {
      ticker: stock.ticker,
      companyName: stock.companyName,
      cik: stock.cik,
      relationship: "SUBJECT",
      revenue: latestSelected(subject.facts, "REVENUE", "ANNUAL"),
      metrics: [...subject.metrics],
    },
    ...peers.map((peer) => ({
      ticker: peer.ticker,
      companyName: peer.companyName,
      cik: peer.cik,
      relationship: peer.relationship,
      revenue: latestSelected(peer.facts, "REVENUE", "ANNUAL"),
      metrics: buildDerivedMetrics(peer.facts.map(toDerivedInput), {
        ambiguousMetrics: peer.ambiguousMetrics,
      }),
    })),
  ];
  const excerpt = clip(
    [
      `Peer comparison for ${stock.ticker} using each company's latest annual selected SEC facts and the same derived metrics (${SEC_DERIVED_METRICS_VERSION}). Fiscal periods differ by company and are stated per row; n/a means the value is not computable from the selected facts, never zero. Peers are the deterministic public peer set; no market share or ranking is implied.`,
      ...rows.map(peerRowText),
    ].join("\n"),
  );
  const factReference = (row: PeerRow, referenceId: string) => {
    const facts = row.relationship === "SUBJECT" ? subject.facts : peers.find((peer) => peer.ticker === row.ticker)?.facts ?? [];
    const fact = facts.find((candidate) => candidate.referenceId === referenceId);
    return fact
      ? {
          referenceId,
          evidenceId: fact.evidenceId,
          externalKey: fact.externalKey,
          accessionNumber: fact.accessionNumber,
          metric: fact.metric,
          value: fact.value,
          unit: fact.unit,
          periodStart: fact.periodStart,
          periodEnd: fact.periodEnd,
        }
      : {
          referenceId,
          evidenceId: null,
          externalKey: null,
          accessionNumber: null,
          metric: null,
          value: null,
          unit: null,
          periodStart: null,
          periodEnd: null,
        };
  };
  return {
    id: evidenceId({ sourceKind: "DERIVED", sourceReference }),
    sourceKind: "DERIVED",
    title: `${stock.ticker} peer comparison table`,
    sourceReference,
    sourceUrl: null,
    accessionNumber: null,
    section: "Peer comparison",
    objectKey: null,
    sha256: null,
    sourceDate:
      [...subject.facts, ...peers.flatMap((peer) => peer.facts)]
        .map((fact) => fact.filedAt)
        .sort()
        .at(-1) ?? null,
    retrievedAt: null,
    excerpt,
    passageStart: null,
    passageEnd: null,
    secFilingId: null,
    secRawSourceId: null,
    secFinancialFactId: null,
    metadata: {
      evidenceType: STRUCTURED_EVIDENCE_TYPES.peerComparison,
      agentNames: ["COMPETITORS", "FINANCIALS", "RISK", "SYNTHESIS"],
      mandatoryAgentNames: ["COMPETITORS", "SYNTHESIS"],
      ticker: stock.ticker,
      rows: rows.map((row) => ({
        ticker: row.ticker,
        companyName: row.companyName,
        cik: row.cik,
        relationship: row.relationship,
        revenue: row.revenue
          ? factReference(row, row.revenue.referenceId)
          : null,
        metrics: row.metrics.map((metric) => ({
          metricId: metric.id,
          periodKind: metric.periodKind,
          periodStart: metric.periodStart,
          periodEnd: metric.periodEnd,
          value: metric.value,
          unit: metric.unit,
          unavailableReason: metric.unavailableReason,
          inputs: metric.inputs.map((input) =>
            factReference(row, input.referenceId),
          ),
        })),
      })),
      inputEvidenceIds: [
        ...new Set(
          subject.metrics.flatMap((metric) =>
            metric.inputs
              .map(
                (input) =>
                  subject.facts.find(
                    (fact) => fact.referenceId === input.referenceId,
                  )?.evidenceId ?? null,
              )
              .filter((id): id is string => id !== null),
          ),
        ),
      ],
      isDerived: true,
      calculationVersion: SEC_DERIVED_METRICS_VERSION,
    },
  };
}

export function buildUpcomingEarningsEvidence(
  stock: StructuredStock,
  observation: UpcomingEarningsObservation,
): ResearchEvidence {
  const sourceReference = `upcoming-earnings:${stock.ticker}`;
  const session =
    observation.marketSession === "BEFORE_MARKET"
      ? " before market open"
      : observation.marketSession === "AFTER_MARKET"
        ? " after market close"
        : "";
  const excerpt = `The stored upcoming earnings event for ${stock.ticker} is dated ${observation.eventDate}${session}, as recorded from a third-party earnings calendar. The date may change and is not a company confirmation or a result.`;
  return {
    id: evidenceId({ sourceKind: "DETERMINISTIC", sourceReference }),
    sourceKind: "DETERMINISTIC",
    title: `${stock.ticker} upcoming earnings event`,
    sourceReference,
    sourceUrl: null,
    accessionNumber: null,
    section: "Upcoming earnings",
    objectKey: null,
    sha256: null,
    sourceDate: null,
    retrievedAt: null,
    excerpt,
    passageStart: null,
    passageEnd: null,
    secFilingId: null,
    secRawSourceId: null,
    secFinancialFactId: null,
    metadata: {
      evidenceType: STRUCTURED_EVIDENCE_TYPES.upcomingEarnings,
      agentNames: ["FINANCIALS", "RISK", "COMPETITORS", "SYNTHESIS"],
      mandatoryAgentNames: ["FINANCIALS", "RISK", "SYNTHESIS"],
      ticker: stock.ticker,
      eventDate: observation.eventDate,
      marketSession: observation.marketSession,
      source: observation.source,
    },
  };
}
