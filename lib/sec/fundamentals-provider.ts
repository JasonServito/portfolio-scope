import { z } from "zod";

import { db } from "@/lib/db";
import {
  cachePolicies,
  ephemeralStore,
  type EphemeralStore,
} from "@/lib/cache/redis";
import {
  SEC_NORMALIZATION_VERSION,
  expectedMetricNames,
  type FactSelection,
  type PeriodKind,
} from "@/lib/sec/normalization";
import {
  getSupportedCompany,
  normalizeTicker,
} from "@/lib/sec/company-registry";

export type FundamentalsFreshness =
  | "CURRENT"
  | "RECENT"
  | "DELAYED"
  | "STALE"
  | "MISSING"
  | "FAILED"
  | "UNSUPPORTED";

export type CanonicalFundamentalFact = {
  metric: string;
  label: string;
  value: number;
  unit: string;
  originalValue: string;
  originalUnit: string;
  taxonomy: string;
  concept: string;
  periodStart: string | null;
  periodEnd: string;
  periodKind: PeriodKind;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  formType: string;
  filedAt: string;
  accessionNumber: string;
  sourceUrl: string;
  observedAt: string;
  normalizationVersion: string;
  isDerived: boolean;
  selection: FactSelection;
};

export type FundamentalsSnapshot = {
  ticker: string;
  companyName: string;
  cik: string | null;
  provider: "SEC_EDGAR" | "SEEDED_FIXTURE";
  freshness: FundamentalsFreshness;
  retrievedAt: string | null;
  facts: CanonicalFundamentalFact[];
  trendPeriods: string[];
  trendFacts: CanonicalFundamentalFact[];
  missingMetrics: string[];
  ambiguousMetrics: string[];
  lastErrorCode: string | null;
};

export interface FundamentalsProvider {
  getFundamentals(ticker: string): Promise<FundamentalsSnapshot>;
}

export function classifyFundamentalsFreshness(
  retrievedAt: Date | null,
  now = new Date(),
): FundamentalsFreshness {
  if (!retrievedAt) return "MISSING";
  const ageDays = Math.max(
    0,
    (now.getTime() - retrievedAt.getTime()) / 86_400_000,
  );
  if (ageDays <= 3) return "CURRENT";
  if (ageDays <= 14) return "RECENT";
  if (ageDays <= 45) return "DELAYED";
  return "STALE";
}

export class SecEdgarFundamentalsProvider implements FundamentalsProvider {
  async getFundamentals(ticker: string): Promise<FundamentalsSnapshot> {
    const symbol = normalizeTicker(ticker);
    const supported = getSupportedCompany(symbol);

    if (!supported) {
      return {
        ticker: symbol,
        companyName: symbol,
        cik: null,
        provider: "SEC_EDGAR",
        freshness: "UNSUPPORTED",
        retrievedAt: null,
        facts: [],
        trendPeriods: [],
        trendFacts: [],
        missingMetrics: expectedMetricNames,
        ambiguousMetrics: [],
        lastErrorCode: null,
      };
    }

    const company = await db.company.findFirst({
      where: {
        isSupported: true,
        securities: { some: { ticker: symbol } },
      },
      select: {
        name: true,
        secEntity: {
          select: {
            cik: true,
            rawSources: {
              where: { kind: "COMPANY_FACTS" },
              orderBy: { lastRetrievedAt: "desc" },
              take: 1,
              select: { lastRetrievedAt: true },
            },
            ingestionRuns: {
              orderBy: { startedAt: "desc" },
              take: 1,
              select: {
                status: true,
                errorCode: true,
                completedAt: true,
              },
            },
            financialFacts: {
              where: {
                normalizationVersion: SEC_NORMALIZATION_VERSION,
                selection: { in: ["SELECTED", "AMBIGUOUS"] },
              },
              orderBy: [{ periodEnd: "desc" }, { filedAt: "desc" }],
              select: {
                canonicalMetric: true,
                label: true,
                normalizedValue: true,
                normalizedUnit: true,
                originalValue: true,
                originalUnit: true,
                taxonomy: true,
                concept: true,
                periodStart: true,
                periodEnd: true,
                periodKind: true,
                fiscalYear: true,
                fiscalPeriod: true,
                formType: true,
                filedAt: true,
                accessionNumber: true,
                sourceUrl: true,
                observedAt: true,
                normalizationVersion: true,
                isDerived: true,
                selection: true,
              },
            },
          },
        },
      },
    });

    if (!company?.secEntity) {
      return {
        ticker: symbol,
        companyName: supported.companyName,
        cik: supported.cik,
        provider: "SEC_EDGAR",
        freshness: "MISSING",
        retrievedAt: null,
        facts: [],
        trendPeriods: [],
        trendFacts: [],
        missingMetrics: expectedMetricNames,
        ambiguousMetrics: [],
        lastErrorCode: null,
      };
    }

    const latestRun = company.secEntity.ingestionRuns[0] ?? null;
    const retrievedAt =
      company.secEntity.rawSources[0]?.lastRetrievedAt ?? null;
    const resolvedKeys = new Set<string>();
    const resolvedTrendPeriods = new Set<string>();
    const resolvedTrendKeys = new Set<string>();
    const selectedFacts: CanonicalFundamentalFact[] = [];
    const trendPeriods: string[] = [];
    const trendFacts: CanonicalFundamentalFact[] = [];
    const ambiguousMetrics = new Set<string>();

    const toCanonicalFact = (
      fact: (typeof company.secEntity.financialFacts)[number],
    ): CanonicalFundamentalFact => ({
      metric: fact.canonicalMetric,
      label: fact.label,
      value: fact.normalizedValue.toNumber(),
      unit: fact.normalizedUnit,
      originalValue: fact.originalValue.toString(),
      originalUnit: fact.originalUnit,
      taxonomy: fact.taxonomy,
      concept: fact.concept,
      periodStart: fact.periodStart?.toISOString() ?? null,
      periodEnd: fact.periodEnd.toISOString(),
      periodKind: fact.periodKind,
      fiscalYear: fact.fiscalYear,
      fiscalPeriod: fact.fiscalPeriod,
      formType: fact.formType,
      filedAt: fact.filedAt.toISOString(),
      accessionNumber: fact.accessionNumber,
      sourceUrl: fact.sourceUrl,
      observedAt: fact.observedAt.toISOString(),
      normalizationVersion: fact.normalizationVersion,
      isDerived: fact.isDerived,
      selection: fact.selection,
    });

    for (const fact of company.secEntity.financialFacts) {
      const isTrendMetric = [
        "REVENUE",
        "DILUTED_EPS",
        "OPERATING_CASH_FLOW",
        "CAPITAL_EXPENDITURES",
      ].includes(fact.canonicalMetric);
      const trendPeriod = fact.periodEnd.toISOString();
      const trendKey = `${fact.canonicalMetric}:${trendPeriod}`;

      if (
        isTrendMetric &&
        fact.periodKind === "QUARTERLY" &&
        !resolvedTrendPeriods.has(trendPeriod) &&
        trendPeriods.length < 8
      ) {
        trendPeriods.push(trendPeriod);
        resolvedTrendPeriods.add(trendPeriod);
      }

      if (
        isTrendMetric &&
        fact.periodKind === "QUARTERLY" &&
        fact.selection === "SELECTED" &&
        !resolvedTrendKeys.has(trendKey)
      ) {
        const metricFactCount = trendFacts.filter(
          (candidate) => candidate.metric === fact.canonicalMetric,
        ).length;
        if (metricFactCount < 8) {
          trendFacts.push(toCanonicalFact(fact));
          resolvedTrendKeys.add(trendKey);
        }
      }

      const key = `${fact.canonicalMetric}:${fact.periodKind}`;
      if (resolvedKeys.has(key)) continue;
      resolvedKeys.add(key);

      if (fact.selection === "AMBIGUOUS") {
        ambiguousMetrics.add(fact.canonicalMetric);
        continue;
      }

      selectedFacts.push(toCanonicalFact(fact));
    }

    const availableMetrics = new Set(selectedFacts.map((fact) => fact.metric));
    const refreshFailed =
      latestRun?.status === "FAILED" ||
      latestRun?.status === "PARTIALLY_COMPLETED";
    const freshness = refreshFailed
      ? "FAILED"
      : classifyFundamentalsFreshness(retrievedAt);

    return {
      ticker: symbol,
      companyName: company.name,
      cik: company.secEntity.cik,
      provider: "SEC_EDGAR",
      freshness,
      retrievedAt: retrievedAt?.toISOString() ?? null,
      facts: selectedFacts,
      trendPeriods,
      trendFacts: trendFacts.filter((fact) =>
        resolvedTrendPeriods.has(fact.periodEnd),
      ),
      missingMetrics: expectedMetricNames.filter(
        (metric) => !availableMetrics.has(metric),
      ),
      ambiguousMetrics: [...ambiguousMetrics].sort(),
      lastErrorCode: refreshFailed ? (latestRun?.errorCode ?? null) : null,
    };
  }
}

export class SeededFinancialsProvider implements FundamentalsProvider {
  constructor(
    private readonly fixtures: Record<string, FundamentalsSnapshot>,
  ) {}

  async getFundamentals(ticker: string) {
    const symbol = normalizeTicker(ticker);
    return (
      this.fixtures[symbol] ?? {
        ticker: symbol,
        companyName: symbol,
        cik: null,
        provider: "SEEDED_FIXTURE" as const,
        freshness: "MISSING" as const,
        retrievedAt: null,
        facts: [],
        trendPeriods: [],
        trendFacts: [],
        missingMetrics: expectedMetricNames,
        ambiguousMetrics: [],
        lastErrorCode: null,
      }
    );
  }
}

type FundamentalsCache = Pick<EphemeralStore, "getJson" | "setJson">;

const canonicalFundamentalFactSchema = z
  .object({
    metric: z.string(),
    label: z.string(),
    value: z.number().finite(),
    unit: z.string(),
    originalValue: z.string(),
    originalUnit: z.string(),
    taxonomy: z.string(),
    concept: z.string(),
    periodStart: z.string().datetime().nullable(),
    periodEnd: z.string().datetime(),
    periodKind: z.enum(["INSTANT", "QUARTERLY", "YEAR_TO_DATE", "ANNUAL"]),
    fiscalYear: z.number().int().nullable(),
    fiscalPeriod: z.string().nullable(),
    formType: z.string(),
    filedAt: z.string().datetime(),
    accessionNumber: z.string().regex(/^\d{10}-\d{2}-\d{6}$/),
    sourceUrl: z
      .string()
      .url()
      .refine((value) => {
        const hostname = new URL(value).hostname;
        return hostname === "sec.gov" || hostname.endsWith(".sec.gov");
      }),
    observedAt: z.string().datetime(),
    normalizationVersion: z.string(),
    isDerived: z.boolean(),
    selection: z.enum(["SELECTED", "SUPERSEDED", "AMBIGUOUS"]),
  })
  .strict();

const fundamentalsSnapshotSchema: z.ZodType<FundamentalsSnapshot> = z
  .object({
    ticker: z.string().regex(/^[A-Z][A-Z0-9.-]{0,9}$/),
    companyName: z.string(),
    cik: z
      .string()
      .regex(/^\d{10}$/)
      .nullable(),
    provider: z.enum(["SEC_EDGAR", "SEEDED_FIXTURE"]),
    freshness: z.enum([
      "CURRENT",
      "RECENT",
      "DELAYED",
      "STALE",
      "MISSING",
      "FAILED",
      "UNSUPPORTED",
    ]),
    retrievedAt: z.string().datetime().nullable(),
    facts: z.array(canonicalFundamentalFactSchema),
    trendPeriods: z.array(z.string().datetime()).max(8),
    trendFacts: z.array(canonicalFundamentalFactSchema).max(32),
    missingMetrics: z.array(z.string()),
    ambiguousMetrics: z.array(z.string()),
    lastErrorCode: z.string().nullable(),
  })
  .strict();

export class CachedFundamentalsProvider implements FundamentalsProvider {
  constructor(
    private readonly source: FundamentalsProvider,
    private readonly cache: FundamentalsCache = ephemeralStore,
  ) {}

  async getFundamentals(ticker: string) {
    const symbol = normalizeTicker(ticker);
    const cached = fundamentalsSnapshotSchema.safeParse(
      await this.cache.getJson("fundamentals", symbol),
    );
    if (cached.success) return cached.data;

    const snapshot = await this.source.getFundamentals(symbol);
    await this.cache.setJson(
      "fundamentals",
      symbol,
      snapshot,
      cachePolicies.normalizedFundamentals.ttlSeconds,
    );
    return snapshot;
  }
}

export const secEdgarFundamentalsProvider = new CachedFundamentalsProvider(
  new SecEdgarFundamentalsProvider(),
);
