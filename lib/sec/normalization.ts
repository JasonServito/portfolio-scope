import { createHash } from "node:crypto";

import { buildSecFilingIndexUrl } from "@/lib/sec/client";
import { formatCik } from "@/lib/sec/company-registry";
import { isCurrentReportForm, parseItemCodes } from "@/lib/sec/current-reports";
import type { SecCompanyFacts, SecSubmissions } from "@/lib/sec/schemas";

export const SEC_NORMALIZATION_VERSION = "sec-xbrl-v1";

type PeriodType = "INSTANT" | "DURATION";
export type PeriodKind = "INSTANT" | "QUARTERLY" | "YEAR_TO_DATE" | "ANNUAL";
export type FactSelection = "SELECTED" | "SUPERSEDED" | "AMBIGUOUS";

type MetricDefinition = {
  canonicalMetric: string;
  label: string;
  concepts: string[];
  units: string[];
  periodType: PeriodType;
};

export const metricDefinitions: MetricDefinition[] = [
  {
    canonicalMetric: "REVENUE",
    label: "Revenue",
    concepts: [
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "Revenues",
      "SalesRevenueNet",
    ],
    units: ["USD"],
    periodType: "DURATION",
  },
  {
    canonicalMetric: "NET_INCOME",
    label: "Net income",
    concepts: ["NetIncomeLoss", "ProfitLoss"],
    units: ["USD"],
    periodType: "DURATION",
  },
  {
    canonicalMetric: "OPERATING_INCOME",
    label: "Operating income",
    concepts: ["OperatingIncomeLoss"],
    units: ["USD"],
    periodType: "DURATION",
  },
  {
    canonicalMetric: "ASSETS",
    label: "Assets",
    concepts: ["Assets"],
    units: ["USD"],
    periodType: "INSTANT",
  },
  {
    canonicalMetric: "LIABILITIES",
    label: "Liabilities",
    concepts: ["Liabilities"],
    units: ["USD"],
    periodType: "INSTANT",
  },
  {
    canonicalMetric: "STOCKHOLDERS_EQUITY",
    label: "Stockholders' equity",
    concepts: [
      "StockholdersEquity",
      "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ],
    units: ["USD"],
    periodType: "INSTANT",
  },
  {
    canonicalMetric: "CASH_AND_EQUIVALENTS",
    label: "Cash and equivalents",
    concepts: [
      "CashAndCashEquivalentsAtCarryingValue",
      "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ],
    units: ["USD"],
    periodType: "INSTANT",
  },
  {
    canonicalMetric: "OPERATING_CASH_FLOW",
    label: "Operating cash flow",
    concepts: ["NetCashProvidedByUsedInOperatingActivities"],
    units: ["USD"],
    periodType: "DURATION",
  },
  {
    canonicalMetric: "CAPITAL_EXPENDITURES",
    label: "Capital expenditures",
    concepts: ["PaymentsToAcquirePropertyPlantAndEquipment"],
    units: ["USD"],
    periodType: "DURATION",
  },
  {
    canonicalMetric: "DILUTED_SHARES",
    label: "Diluted shares",
    concepts: ["WeightedAverageNumberOfDilutedSharesOutstanding"],
    units: ["shares"],
    periodType: "DURATION",
  },
  {
    canonicalMetric: "DILUTED_EPS",
    label: "Diluted EPS",
    concepts: ["EarningsPerShareDiluted"],
    units: ["USD/shares", "USD-per-shares"],
    periodType: "DURATION",
  },
  {
    canonicalMetric: "LONG_TERM_DEBT",
    label: "Long-term debt",
    concepts: [
      "LongTermDebtNoncurrent",
      "LongTermDebtAndFinanceLeaseObligationsNoncurrent",
      "LongTermDebt",
    ],
    units: ["USD"],
    periodType: "INSTANT",
  },
  {
    canonicalMetric: "CURRENT_ASSETS",
    label: "Current assets",
    concepts: ["AssetsCurrent"],
    units: ["USD"],
    periodType: "INSTANT",
  },
  {
    canonicalMetric: "CURRENT_LIABILITIES",
    label: "Current liabilities",
    concepts: ["LiabilitiesCurrent"],
    units: ["USD"],
    periodType: "INSTANT",
  },
];

export const expectedMetricNames = metricDefinitions.map(
  ({ canonicalMetric }) => canonicalMetric,
);

export type ParsedSecFiling = {
  accessionNumber: string;
  formType: string;
  filingDate: Date;
  reportDate: Date | null;
  acceptanceDateTime: Date | null;
  primaryDocument: string | null;
  primaryDocumentDescription: string | null;
  sourceUrl: string;
  isAmendment: boolean;
  amendsAccessionNumber: string | null;
  /** Form 8-K item codes; empty for 10-K and 10-Q filings. */
  itemCodes: string[];
};

export type ParseRecentFilingsOptions = {
  /**
   * When set, Form 8-K and 8-K/A filings filed on or after this date are
   * retained with their item codes (M32). Absent or null keeps the original
   * 10-K and 10-Q filter unchanged.
   */
  currentReportsFiledOnOrAfter?: Date | null;
};

export type NormalizedSecFact = {
  externalKey: string;
  canonicalMetric: string;
  taxonomy: string;
  concept: string;
  label: string;
  description: string | null;
  originalValue: string;
  originalUnit: string;
  normalizedValue: string;
  normalizedUnit: string;
  periodStart: Date | null;
  periodEnd: Date;
  periodType: PeriodType;
  periodKind: PeriodKind;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  formType: string;
  filedAt: Date;
  accessionNumber: string;
  frame: string | null;
  sourceUrl: string;
  observedAt: Date;
  normalizationVersion: string;
  isDerived: false;
  selection: FactSelection;
  ambiguityReason: string | null;
  conceptPriority: number;
};

function parseDate(value: string | undefined) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateTime(value: string | undefined) {
  if (!value) return null;
  const normalized = /^\d{14}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}Z`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function durationInDays(start: Date, end: Date) {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function classifyPeriod(input: {
  periodType: PeriodType;
  start: Date | null;
  end: Date;
  formType: string;
  fiscalPeriod: string | null;
}): PeriodKind | null {
  if (input.periodType === "INSTANT") {
    return input.start ? null : "INSTANT";
  }
  if (!input.start || input.end < input.start) return null;

  const days = durationInDays(input.start, input.end);
  const baseForm = input.formType.replace(/\/A$/, "");

  if (baseForm === "10-K" && days >= 300 && days <= 430) return "ANNUAL";
  if (days >= 70 && days <= 120) return "QUARTERLY";
  if (baseForm === "10-Q" && days > 120 && days < 300) {
    return "YEAR_TO_DATE";
  }
  if (input.fiscalPeriod === "FY" && days >= 300 && days <= 430) {
    return "ANNUAL";
  }

  return null;
}

function normalizeUnit(unit: string) {
  if (unit === "USD/shares" || unit === "USD-per-shares") return "USD/share";
  return unit;
}

function factExternalKey(parts: Array<string | number | null>) {
  return createHash("sha256")
    .update(parts.map((part) => part ?? "").join("|"))
    .digest("hex");
}

export function parseRecentFilings(
  submissions: SecSubmissions,
  cik: string,
  options: ParseRecentFilingsOptions = {},
): ParsedSecFiling[] {
  const recent = submissions.filings.recent;
  const filings: ParsedSecFiling[] = [];
  const currentReportsFrom = options.currentReportsFiledOnOrAfter ?? null;

  for (let index = 0; index < recent.accessionNumber.length; index += 1) {
    const accessionNumber = recent.accessionNumber[index];
    const formType = recent.form[index];
    const filingDate = parseDate(recent.filingDate[index]);

    if (!accessionNumber || !formType || !filingDate) continue;
    const retained =
      /^10-(?:K|Q)(?:\/A)?$/.test(formType) ||
      (currentReportsFrom !== null &&
        isCurrentReportForm(formType) &&
        filingDate >= currentReportsFrom);
    if (!retained) continue;

    const reportDate = parseDate(recent.reportDate[index]);
    const isAmendment = formType.endsWith("/A");

    filings.push({
      accessionNumber,
      formType,
      filingDate,
      reportDate,
      acceptanceDateTime: parseDateTime(recent.acceptanceDateTime?.[index]),
      primaryDocument: recent.primaryDocument?.[index] || null,
      primaryDocumentDescription: recent.primaryDocDescription?.[index] || null,
      sourceUrl: buildSecFilingIndexUrl(cik, accessionNumber),
      isAmendment,
      amendsAccessionNumber: null,
      itemCodes: parseItemCodes(recent.items?.[index]),
    });
  }

  for (const filing of filings) {
    if (!filing.isAmendment) continue;
    const baseForm = filing.formType.replace(/\/A$/, "");
    const amended = filings
      .filter(
        (candidate) =>
          candidate.formType === baseForm &&
          candidate.filingDate <= filing.filingDate &&
          candidate.reportDate?.getTime() === filing.reportDate?.getTime(),
      )
      .sort(
        (left, right) => right.filingDate.getTime() - left.filingDate.getTime(),
      )[0];
    filing.amendsAccessionNumber = amended?.accessionNumber ?? null;
  }

  return filings;
}

function applySelectionRules(facts: NormalizedSecFact[]) {
  const groups = new Map<string, NormalizedSecFact[]>();

  for (const fact of facts) {
    const groupKey = [
      fact.canonicalMetric,
      fact.normalizedUnit,
      fact.periodEnd.toISOString().slice(0, 10),
      fact.periodKind,
    ].join("|");
    const group = groups.get(groupKey) ?? [];
    group.push(fact);
    groups.set(groupKey, group);
  }

  for (const group of groups.values()) {
    const bestPriority = Math.min(...group.map((fact) => fact.conceptPriority));
    const preferredConceptFacts = group.filter(
      (fact) => fact.conceptPriority === bestPriority,
    );
    const latestFiledAt = Math.max(
      ...preferredConceptFacts.map((fact) => fact.filedAt.getTime()),
    );
    const latestFacts = preferredConceptFacts.filter(
      (fact) => fact.filedAt.getTime() === latestFiledAt,
    );
    const latestAmendments = latestFacts.filter((fact) =>
      fact.formType.endsWith("/A"),
    );
    const selectionCandidates =
      latestAmendments.length > 0 ? latestAmendments : latestFacts;
    const distinctValues = new Set(
      selectionCandidates.map((fact) => fact.normalizedValue),
    );

    for (const fact of group) {
      fact.selection = "SUPERSEDED";
      fact.ambiguityReason = null;
    }

    if (distinctValues.size > 1) {
      for (const fact of selectionCandidates) {
        fact.selection = "AMBIGUOUS";
        fact.ambiguityReason =
          "Multiple latest SEC observations report different values for the same normalized period.";
      }
      continue;
    }

    selectionCandidates.sort((left, right) =>
      right.accessionNumber.localeCompare(left.accessionNumber),
    );
    selectionCandidates[0].selection = "SELECTED";
  }

  return facts;
}

export function normalizeCompanyFacts(
  companyFacts: SecCompanyFacts,
  input: { cik: string; observedAt: Date },
) {
  const cik = formatCik(input.cik);
  const taxonomy = "us-gaap";
  const concepts = companyFacts.facts[taxonomy] ?? {};
  const facts: NormalizedSecFact[] = [];

  for (const definition of metricDefinitions) {
    definition.concepts.forEach((conceptName, conceptPriority) => {
      const concept = concepts[conceptName];
      if (!concept) return;

      for (const [unit, observations] of Object.entries(concept.units)) {
        if (!definition.units.includes(unit)) continue;

        for (const observation of observations) {
          if (!/^10-(?:K|Q)(?:\/A)?$/.test(observation.form)) continue;

          const periodStart = parseDate(observation.start);
          const periodEnd = parseDate(observation.end);
          const filedAt = parseDate(observation.filed);
          if (!periodEnd || !filedAt) continue;

          const periodKind = classifyPeriod({
            periodType: definition.periodType,
            start: periodStart,
            end: periodEnd,
            formType: observation.form,
            fiscalPeriod: observation.fp ?? null,
          });
          if (!periodKind) continue;

          const normalizedUnit = normalizeUnit(unit);
          const value = observation.val.toString();

          facts.push({
            externalKey: factExternalKey([
              cik,
              taxonomy,
              conceptName,
              unit,
              observation.accn,
              observation.start ?? null,
              observation.end,
              observation.fy ?? null,
              observation.fp ?? null,
              observation.form,
              observation.filed,
              observation.frame ?? null,
              value,
            ]),
            canonicalMetric: definition.canonicalMetric,
            taxonomy,
            concept: conceptName,
            label: definition.label,
            description: concept.description ?? null,
            originalValue: value,
            originalUnit: unit,
            normalizedValue: value,
            normalizedUnit,
            periodStart,
            periodEnd,
            periodType: definition.periodType,
            periodKind,
            fiscalYear: observation.fy ?? null,
            fiscalPeriod: observation.fp ?? null,
            formType: observation.form,
            filedAt,
            accessionNumber: observation.accn,
            frame: observation.frame ?? null,
            sourceUrl: buildSecFilingIndexUrl(cik, observation.accn),
            observedAt: input.observedAt,
            normalizationVersion: SEC_NORMALIZATION_VERSION,
            isDerived: false,
            selection: "SUPERSEDED",
            ambiguityReason: null,
            conceptPriority,
          });
        }
      }
    });
  }

  return applySelectionRules(facts);
}
