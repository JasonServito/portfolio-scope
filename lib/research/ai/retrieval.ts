import { db } from "@/lib/db";
import {
  AI_RETRIEVAL_VERSION,
  AI_SPECIALIST_CONTEXT_CHAR_BUDGET,
  AI_SPECIALIST_MAX_EVIDENCE_ITEMS,
  AI_SYNTHESIS_CONTEXT_CHAR_BUDGET,
  AI_SYNTHESIS_MAX_EVIDENCE_ITEMS,
} from "@/lib/research/ai/config";
import {
  evidenceId,
  researchEvidenceSchema,
  stableHash,
  type ResearchEvidence,
} from "@/lib/research/ai/schemas";
import {
  buildDerivedMetricEvidence,
  buildFinancialSummaryEvidence,
  buildPeerComparisonEvidence,
  buildTrendEvidence,
  buildUpcomingEarningsEvidence,
  type StructuredFact,
  type StructuredPeer,
} from "@/lib/research/ai/structured-evidence";
import type {
  ResearchAgentName,
  SpecialistAgentName,
} from "@/lib/research/types";
import {
  isPriorYearComparable,
  priorYearDistance,
  samePeriod as sameBoundaries,
  type PeriodBoundaries,
} from "@/lib/sec/derived-metrics";
import { expectedMetricNames } from "@/lib/sec/normalization";
import { z } from "zod";

export const RESEARCH_EVIDENCE_SNAPSHOT_VERSION =
  "m29-public-evidence-snapshot-v2";

const ALL_RESEARCH_AGENTS: readonly ResearchAgentName[] = [
  "NEWS",
  "FINANCIALS",
  "COMPETITORS",
  "POLITICAL_ACTIVITY",
  "RISK",
  "SYNTHESIS",
];

const RISK_METRICS = new Set([
  "ASSETS",
  "LIABILITIES",
  "STOCKHOLDERS_EQUITY",
  "CASH_AND_EQUIVALENTS",
  "OPERATING_CASH_FLOW",
  "CAPITAL_EXPENDITURES",
  "LONG_TERM_DEBT",
  "CURRENT_ASSETS",
  "CURRENT_LIABILITIES",
]);

const DEFAULT_LIMITS = {
  maxPeers: 8,
  factsPerMetric: 4,
  factCandidatesPerMetric: 24,
} as const;
const TREND_QUARTERS = 8;
const TREND_METRICS = new Set([
  "REVENUE",
  "DILUTED_EPS",
  "OPERATING_CASH_FLOW",
  "CAPITAL_EXPENDITURES",
]);
// Peers contribute their latest annual facts plus the prior-year comparable
// and their latest reporting-date facts, so the lookbacks differ by kind.
const PEER_ANNUAL_LOOKBACK_DAYS = 2 * 365 + 60;
const PEER_INSTANT_LOOKBACK_DAYS = 400;
const MAX_PEER_FACT_ROWS = 1_000;
const MAX_SNAPSHOT_EVIDENCE = 160;

const DEFAULT_MAX_RESULTS = 12;
const DEFAULT_CONTEXT_CHAR_BUDGET = 12_000;
const MAX_CONTEXT_CHAR_BUDGET = 32_000;
const MAX_RESULTS = 50;
const MAX_QUERY_CHARACTERS = 1_000;

type DateValue = Date | string;
type StringValue = string | number | bigint | { toString(): string };

type RawSourceRecord = {
  id: string;
  kind: string;
  sourceUrl: string;
  objectKey: string;
  sha256: string;
  contentType: string;
  byteLength: StringValue;
  firstRetrievedAt: DateValue;
  lastRetrievedAt: DateValue;
};

export type PublicStockEvidenceRecord = {
  id: string;
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
  exchange: string;
  currency: string;
  company: {
    id: string;
    slug: string;
    name: string;
    currency: string;
    isActive: boolean;
    isSupported: boolean;
    lastSyncedAt: DateValue | null;
    secEntity: {
      id: string;
      cik: string;
      legalName: string;
      sic: string | null;
      sicDescription: string | null;
      fiscalYearEnd: string | null;
      stateOfIncorporation: string | null;
      rawSources: RawSourceRecord[];
    } | null;
  } | null;
};

export type PublicPeerRecord = {
  id: string;
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
  exchange: string;
  currency: string;
  company: {
    id: string;
    slug: string;
    name: string;
    isSupported: boolean;
    secEntity: { id: string; cik: string; legalName: string } | null;
  } | null;
};

export type PeerSecFactRecord = {
  secEntityId: string;
  externalKey: string;
  canonicalMetric: string;
  label: string;
  normalizedValue: StringValue;
  normalizedUnit: string;
  periodStart: DateValue | null;
  periodEnd: DateValue;
  periodKind: string;
  filedAt: DateValue;
  accessionNumber: string;
  selection: "SELECTED" | "AMBIGUOUS" | "SUPERSEDED";
};

export type UpcomingEarningsRecord = {
  eventDate: DateValue | null;
  marketSession: string | null;
  source: string;
  fetchedAt: DateValue;
};

export type SecFactEvidenceRecord = {
  id: string;
  secEntityId: string;
  filingId: string | null;
  rawSourceId: string;
  externalKey: string;
  canonicalMetric: string;
  taxonomy: string;
  concept: string;
  label: string;
  description: string | null;
  originalValue: StringValue;
  originalUnit: string;
  normalizedValue: StringValue;
  normalizedUnit: string;
  periodStart: DateValue | null;
  periodEnd: DateValue;
  periodType: string;
  periodKind: string;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  formType: string;
  filedAt: DateValue;
  accessionNumber: string;
  frame: string | null;
  sourceUrl: string;
  observedAt: DateValue;
  normalizationVersion: string;
  isDerived: boolean;
  selection: "SELECTED" | "AMBIGUOUS" | "SUPERSEDED";
  ambiguityReason: string | null;
  filing: {
    id: string;
    sourceUrl: string;
    filingDate: DateValue;
    reportDate: DateValue | null;
    primaryDocument: string | null;
    primaryDocumentDescription: string | null;
  } | null;
  rawSource: RawSourceRecord;
};

export type ResearchJobStockIdentity = {
  stockId: string;
  ticker: string;
  companyName: string;
  generationMode?: string;
  sourceSnapshotJson?: unknown;
};

export interface ResearchEvidenceRepository {
  findResearchJobStock(jobId: string): Promise<ResearchJobStockIdentity | null>;
  findPublicStock(stockId: string): Promise<PublicStockEvidenceRecord | null>;
  listSecFactCandidates(input: {
    secEntityId: string;
    metrics: readonly string[];
    takePerMetric: number;
  }): Promise<SecFactEvidenceRecord[]>;
  listPublicPeers(input: {
    stockId: string;
    industry: string;
    sector: string;
    take: number;
  }): Promise<PublicPeerRecord[]>;
  listPeerSecFactCandidates(input: {
    secEntityIds: readonly string[];
    metrics: readonly string[];
    annualPeriodEndFrom: Date;
    instantPeriodEndFrom: Date;
    take: number;
  }): Promise<PeerSecFactRecord[]>;
  findUpcomingEarnings(stockId: string): Promise<UpcomingEarningsRecord | null>;
}

export type ResearchEvidenceDatabase = Pick<
  typeof db,
  "researchJob" | "stock" | "secFinancialFact" | "upcomingEarningsState"
>;

export type EvidenceSnapshotLimits = {
  maxPeers: number;
  factsPerMetric: number;
  factCandidatesPerMetric: number;
};

export type ResearchEvidenceDependencies = {
  repository?: ResearchEvidenceRepository;
  database?: ResearchEvidenceDatabase;
  limits?: Partial<EvidenceSnapshotLimits>;
};

export type ResearchEvidenceStock = Readonly<{
  stockId: string;
  companyId: string | null;
  ticker: string;
  companyName: string;
  legalName: string | null;
  slug: string | null;
  sector: string;
  industry: string;
  exchange: string;
  currency: string;
  cik: string | null;
  sic: string | null;
  sicDescription: string | null;
  fiscalYearEnd: string | null;
  stateOfIncorporation: string | null;
  isSupported: boolean;
  lastSyncedAt: string | null;
}>;

export type ResearchEvidencePeer = Readonly<{
  stockId: string;
  companyId: string | null;
  ticker: string;
  companyName: string;
  legalName: string | null;
  slug: string | null;
  sector: string;
  industry: string;
  exchange: string;
  currency: string;
  cik: string | null;
  relationship: "INDUSTRY" | "SECTOR";
}>;

export type ResearchEvidenceSnapshot = Readonly<{
  schemaVersion: typeof RESEARCH_EVIDENCE_SNAPSHOT_VERSION;
  retrievalVersion: typeof AI_RETRIEVAL_VERSION;
  sourceDataVersion: string;
  inputDataVersion: string;
  sourceSnapshotSha256: string;
  stock: ResearchEvidenceStock;
  peers: readonly ResearchEvidencePeer[];
  missingMetrics: readonly string[];
  ambiguousMetrics: readonly string[];
  evidence: readonly ResearchEvidence[];
}>;

export type EvidenceSourceKind = ResearchEvidence["sourceKind"];
export type MetadataFilterScalar = string | number | boolean | null;
export type MetadataFilterValue =
  | MetadataFilterScalar
  | readonly MetadataFilterScalar[];

export type EvidenceSelectionRequest = Readonly<{
  query: string;
  agent?: ResearchAgentName;
  sourceKinds?: readonly EvidenceSourceKind[];
  metadata?: Readonly<Record<string, MetadataFilterValue>>;
  maxResults?: number;
  contextCharBudget?: number;
}>;

export type EvidenceMatch = Readonly<{
  evidenceId: string;
  score: number;
  matchedTerms: readonly string[];
}>;

export type EvidenceSelectionResult = Readonly<{
  query: string;
  agent: ResearchAgentName | null;
  retrievalVersion: typeof AI_RETRIEVAL_VERSION;
  evidence: readonly ResearchEvidence[];
  evidenceIds: readonly string[];
  mandatoryEvidenceIds: readonly string[];
  matches: readonly EvidenceMatch[];
  context: string;
  contextCharacters: number;
  omittedEvidenceCount: number;
  truncated: boolean;
}>;

const persistedStockSchema = z
  .object({
    stockId: z.string().min(1),
    companyId: z.string().nullable(),
    ticker: z.string().min(1).max(20),
    companyName: z.string().min(1).max(500),
    legalName: z.string().max(500).nullable(),
    slug: z.string().max(240).nullable(),
    sector: z.string().max(240),
    industry: z.string().max(240),
    exchange: z.string().max(120),
    currency: z.string().max(20),
    cik: z.string().nullable(),
    sic: z.string().nullable(),
    sicDescription: z.string().max(500).nullable(),
    fiscalYearEnd: z.string().nullable(),
    stateOfIncorporation: z.string().nullable(),
    isSupported: z.boolean(),
    lastSyncedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

const persistedPeerSchema = z
  .object({
    stockId: z.string().min(1),
    companyId: z.string().nullable(),
    ticker: z.string().min(1).max(20),
    companyName: z.string().min(1).max(500),
    legalName: z.string().max(500).nullable(),
    slug: z.string().max(240).nullable(),
    sector: z.string().max(240),
    industry: z.string().max(240),
    exchange: z.string().max(120),
    currency: z.string().max(20),
    cik: z.string().nullable(),
    relationship: z.enum(["INDUSTRY", "SECTOR"]),
  })
  .strict();

const persistedSnapshotSchema = z
  .object({
    schemaVersion: z.literal(RESEARCH_EVIDENCE_SNAPSHOT_VERSION),
    retrievalVersion: z.literal(AI_RETRIEVAL_VERSION),
    sourceDataVersion: z.string().regex(/^[a-f0-9]{64}$/),
    inputDataVersion: z.string().regex(/^[a-f0-9]{64}$/),
    sourceSnapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
    stock: persistedStockSchema,
    peers: z.array(persistedPeerSchema).max(12),
    missingMetrics: z.array(z.string()).max(expectedMetricNames.length),
    ambiguousMetrics: z.array(z.string()).max(expectedMetricNames.length),
    evidence: z.array(researchEvidenceSchema).max(MAX_SNAPSHOT_EVIDENCE),
  })
  .strict();

export class ResearchEvidenceSnapshotError extends Error {
  readonly code: "RESEARCH_STOCK_NOT_FOUND" | "INVALID_PUBLIC_EVIDENCE";

  constructor(
    code: ResearchEvidenceSnapshotError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ResearchEvidenceSnapshotError";
    this.code = code;
  }
}

export function createPrismaResearchEvidenceRepository(
  database: ResearchEvidenceDatabase = db,
): ResearchEvidenceRepository {
  return {
    async findResearchJobStock(jobId) {
      const job = await database.researchJob.findUnique({
        where: { id: jobId },
        select: {
          generationMode: true,
          sourceSnapshotJson: true,
          stock: {
            select: { id: true, ticker: true, companyName: true },
          },
        },
      });
      if (!job) return null;
      return {
        stockId: job.stock.id,
        ticker: job.stock.ticker,
        companyName: job.stock.companyName,
        generationMode: job.generationMode,
        sourceSnapshotJson: job.sourceSnapshotJson,
      };
    },

    async findPublicStock(stockId) {
      return database.stock.findUnique({
        where: { id: stockId },
        select: {
          id: true,
          ticker: true,
          companyName: true,
          sector: true,
          industry: true,
          exchange: true,
          currency: true,
          company: {
            select: {
              id: true,
              slug: true,
              name: true,
              currency: true,
              isActive: true,
              isSupported: true,
              lastSyncedAt: true,
              secEntity: {
                select: {
                  id: true,
                  cik: true,
                  legalName: true,
                  sic: true,
                  sicDescription: true,
                  fiscalYearEnd: true,
                  stateOfIncorporation: true,
                  rawSources: {
                    where: { kind: "SUBMISSIONS" },
                    orderBy: [
                      { lastRetrievedAt: "desc" },
                      { objectKey: "asc" },
                    ],
                    take: 1,
                    select: {
                      id: true,
                      kind: true,
                      sourceUrl: true,
                      objectKey: true,
                      sha256: true,
                      contentType: true,
                      byteLength: true,
                      firstRetrievedAt: true,
                      lastRetrievedAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
    },

    async listSecFactCandidates({ secEntityId, metrics, takePerMetric }) {
      const result = await Promise.all(
        [...metrics].sort().map((canonicalMetric) =>
          database.secFinancialFact.findMany({
            where: {
              secEntityId,
              canonicalMetric,
              selection: { in: ["SELECTED", "AMBIGUOUS"] },
            },
            orderBy: [
              { periodEnd: "desc" },
              { filedAt: "desc" },
              { externalKey: "asc" },
            ],
            take: takePerMetric,
            select: {
              id: true,
              secEntityId: true,
              filingId: true,
              rawSourceId: true,
              externalKey: true,
              canonicalMetric: true,
              taxonomy: true,
              concept: true,
              label: true,
              description: true,
              originalValue: true,
              originalUnit: true,
              normalizedValue: true,
              normalizedUnit: true,
              periodStart: true,
              periodEnd: true,
              periodType: true,
              periodKind: true,
              fiscalYear: true,
              fiscalPeriod: true,
              formType: true,
              filedAt: true,
              accessionNumber: true,
              frame: true,
              sourceUrl: true,
              observedAt: true,
              normalizationVersion: true,
              isDerived: true,
              selection: true,
              ambiguityReason: true,
              filing: {
                select: {
                  id: true,
                  sourceUrl: true,
                  filingDate: true,
                  reportDate: true,
                  primaryDocument: true,
                  primaryDocumentDescription: true,
                },
              },
              rawSource: {
                select: {
                  id: true,
                  kind: true,
                  sourceUrl: true,
                  objectKey: true,
                  sha256: true,
                  contentType: true,
                  byteLength: true,
                  firstRetrievedAt: true,
                  lastRetrievedAt: true,
                },
              },
            },
          }),
        ),
      );
      return result.flat();
    },

    async listPublicPeers({ stockId, industry, sector, take }) {
      if (take <= 0) return [];
      const select = {
        id: true,
        ticker: true,
        companyName: true,
        sector: true,
        industry: true,
        exchange: true,
        currency: true,
        company: {
          select: {
            id: true,
            slug: true,
            name: true,
            isSupported: true,
            secEntity: { select: { id: true, cik: true, legalName: true } },
          },
        },
      } as const;
      const commonWhere = {
        id: { not: stockId },
        company: { is: { isActive: true, isSupported: true } },
      } as const;
      const industryPeers = industry
        ? await database.stock.findMany({
            where: { ...commonWhere, industry },
            orderBy: { ticker: "asc" },
            take,
            select,
          })
        : [];
      const remaining = take - industryPeers.length;
      if (remaining <= 0) return industryPeers;

      const sectorPeers = sector
        ? await database.stock.findMany({
            where: {
              ...commonWhere,
              sector,
              id: {
                not: stockId,
                notIn: industryPeers.map((peer) => peer.id),
              },
            },
            orderBy: { ticker: "asc" },
            take: remaining,
            select,
          })
        : [];
      return [...industryPeers, ...sectorPeers];
    },

    async listPeerSecFactCandidates({
      secEntityIds,
      metrics,
      annualPeriodEndFrom,
      instantPeriodEndFrom,
      take,
    }) {
      if (secEntityIds.length === 0 || take <= 0) return [];
      return database.secFinancialFact.findMany({
        where: {
          secEntityId: { in: [...secEntityIds] },
          canonicalMetric: { in: [...metrics] },
          selection: { in: ["SELECTED", "AMBIGUOUS"] },
          OR: [
            { periodKind: "ANNUAL", periodEnd: { gte: annualPeriodEndFrom } },
            { periodKind: "INSTANT", periodEnd: { gte: instantPeriodEndFrom } },
          ],
        },
        orderBy: [
          { secEntityId: "asc" },
          { canonicalMetric: "asc" },
          { periodEnd: "desc" },
          { filedAt: "desc" },
          { externalKey: "asc" },
        ],
        take,
        select: {
          secEntityId: true,
          externalKey: true,
          canonicalMetric: true,
          label: true,
          normalizedValue: true,
          normalizedUnit: true,
          periodStart: true,
          periodEnd: true,
          periodKind: true,
          filedAt: true,
          accessionNumber: true,
          selection: true,
        },
      });
    },

    async findUpcomingEarnings(stockId) {
      return database.upcomingEarningsState.findUnique({
        where: { stockId },
        select: {
          eventDate: true,
          marketSession: true,
          source: true,
          fetchedAt: true,
        },
      });
    },
  };
}

function integerLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(maximum, Math.floor(value)));
}

function resolveLimits(
  limits: Partial<EvidenceSnapshotLimits> | undefined,
): EvidenceSnapshotLimits {
  return {
    maxPeers: integerLimit(limits?.maxPeers, DEFAULT_LIMITS.maxPeers, 12),
    factsPerMetric: integerLimit(
      limits?.factsPerMetric,
      DEFAULT_LIMITS.factsPerMetric,
      4,
    ),
    factCandidatesPerMetric: integerLimit(
      limits?.factCandidatesPerMetric,
      DEFAULT_LIMITS.factCandidatesPerMetric,
      40,
    ),
  };
}

function resolveRepository(dependencies: ResearchEvidenceDependencies) {
  return (
    dependencies.repository ??
    createPrismaResearchEvidenceRepository(dependencies.database ?? db)
  );
}

function date(value: DateValue | null) {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function dateOnly(value: DateValue | null) {
  return date(value)?.slice(0, 10) ?? null;
}

function text(value: string | null | undefined, maximum: number) {
  const normalized = value?.trim() ?? "";
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function stringValue(value: StringValue) {
  return value.toString();
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

function validatedEvidence(value: ResearchEvidence) {
  try {
    return deepFreeze(researchEvidenceSchema.parse(value));
  } catch (error) {
    throw new ResearchEvidenceSnapshotError(
      "INVALID_PUBLIC_EVIDENCE",
      "Persisted public evidence could not be shaped safely.",
      { cause: error },
    );
  }
}

function sourceAgents(metric: string): ResearchAgentName[] {
  return RISK_METRICS.has(metric)
    ? ["FINANCIALS", "RISK", "SYNTHESIS"]
    : ["FINANCIALS", "SYNTHESIS"];
}

function makeCompanyEvidence(
  stock: ResearchEvidenceStock,
  rawSource: RawSourceRecord | null,
) {
  const sourceReference = stock.cik
    ? `sec-company:${stock.cik}`
    : `public-stock:${stock.ticker}`;
  const details = [
    `${stock.ticker} identifies ${stock.legalName ?? stock.companyName}.`,
    stock.exchange ? `Exchange: ${stock.exchange}.` : "",
    stock.sector ? `Sector: ${stock.sector}.` : "",
    stock.industry ? `Industry: ${stock.industry}.` : "",
    stock.cik ? `SEC CIK: ${stock.cik}.` : "No SEC CIK is available.",
    stock.sicDescription ? `SEC industry: ${stock.sicDescription}.` : "",
  ].filter(Boolean);
  return validatedEvidence({
    id: evidenceId({ sourceKind: "COMPANY_PROFILE", sourceReference }),
    sourceKind: "COMPANY_PROFILE",
    title: text(`${stock.ticker} public company identity`, 240),
    sourceReference,
    sourceUrl: rawSource?.sourceUrl ?? null,
    accessionNumber: null,
    section: "Company identity",
    objectKey: rawSource ? text(rawSource.objectKey, 1_000) : null,
    sha256: rawSource?.sha256 ?? null,
    sourceDate: dateOnly(stock.lastSyncedAt),
    retrievedAt: rawSource ? date(rawSource.lastRetrievedAt) : null,
    excerpt: text(details.join(" "), 4_000),
    passageStart: null,
    passageEnd: null,
    secFilingId: null,
    secRawSourceId: rawSource?.id ?? null,
    secFinancialFactId: null,
    metadata: {
      evidenceType: "PUBLIC_COMPANY_IDENTITY",
      agentNames: [...ALL_RESEARCH_AGENTS],
      mandatoryAgentNames: ["FINANCIALS", "COMPETITORS", "RISK", "SYNTHESIS"],
      stockId: stock.stockId,
      companyId: stock.companyId,
      ticker: stock.ticker,
      companyName: stock.companyName,
      legalName: stock.legalName,
      slug: stock.slug,
      sector: stock.sector,
      industry: stock.industry,
      exchange: stock.exchange,
      currency: stock.currency,
      cik: stock.cik,
      sic: stock.sic,
      sicDescription: stock.sicDescription,
      fiscalYearEnd: stock.fiscalYearEnd,
      stateOfIncorporation: stock.stateOfIncorporation,
      isSupported: stock.isSupported,
      lastSyncedAt: stock.lastSyncedAt,
      rawSourceKind: rawSource?.kind ?? null,
      rawSourceUrl: rawSource?.sourceUrl ?? null,
      rawContentType: rawSource?.contentType ?? null,
      rawByteLength: rawSource ? stringValue(rawSource.byteLength) : null,
      rawFirstRetrievedAt: rawSource ? date(rawSource.firstRetrievedAt) : null,
      rawLastRetrievedAt: rawSource ? date(rawSource.lastRetrievedAt) : null,
    },
  });
}

function makeFactEvidence(fact: SecFactEvidenceRecord) {
  const sourceReference = `sec-fact:${fact.externalKey}`;
  const periodStart = dateOnly(fact.periodStart);
  const periodEnd = dateOnly(fact.periodEnd);
  const filedAt = dateOnly(fact.filedAt);
  const normalizedValue = stringValue(fact.normalizedValue);
  const originalValue = stringValue(fact.originalValue);
  const excerpt = [
    `${fact.label} (${fact.canonicalMetric}) was reported as ${originalValue} ${fact.originalUnit}.`,
    `Normalized value: ${normalizedValue} ${fact.normalizedUnit}.`,
    `Reporting period: ${periodStart ? `${periodStart} through ` : ""}${periodEnd} (${fact.periodKind}).`,
    `Filed on ${filedAt} in Form ${fact.formType}, accession ${fact.accessionNumber}.`,
    fact.isDerived
      ? "PortfolioScope marks this value as derived."
      : "The value is reported, not derived.",
  ].join(" ");
  return validatedEvidence({
    id: evidenceId({ sourceKind: "SEC_FACT", sourceReference }),
    sourceKind: "SEC_FACT",
    title: text(
      `${fact.label} — ${fact.periodKind.toLowerCase()} period ending ${periodEnd}`,
      240,
    ),
    sourceReference,
    sourceUrl: fact.sourceUrl,
    accessionNumber: fact.accessionNumber,
    section: text(`${fact.taxonomy}:${fact.concept}`, 240),
    objectKey: text(fact.rawSource.objectKey, 1_000),
    sha256: fact.rawSource.sha256,
    sourceDate: filedAt,
    retrievedAt: date(fact.rawSource.lastRetrievedAt),
    excerpt: text(excerpt, 4_000),
    passageStart: null,
    passageEnd: null,
    secFilingId: fact.filingId,
    secRawSourceId: fact.rawSourceId,
    secFinancialFactId: fact.id,
    metadata: {
      evidenceType: "SELECTED_SEC_FACT",
      agentNames: sourceAgents(fact.canonicalMetric),
      externalKey: fact.externalKey,
      secEntityId: fact.secEntityId,
      canonicalMetric: fact.canonicalMetric,
      taxonomy: fact.taxonomy,
      concept: fact.concept,
      label: text(fact.label, 500),
      description: fact.description ? text(fact.description, 1_000) : null,
      originalValue,
      originalUnit: fact.originalUnit,
      normalizedValue,
      normalizedUnit: fact.normalizedUnit,
      periodStart,
      periodEnd,
      periodType: fact.periodType,
      periodKind: fact.periodKind,
      fiscalYear: fact.fiscalYear,
      fiscalPeriod: fact.fiscalPeriod,
      formType: fact.formType,
      filedAt,
      accessionNumber: fact.accessionNumber,
      frame: fact.frame,
      observedAt: date(fact.observedAt),
      normalizationVersion: fact.normalizationVersion,
      isDerived: fact.isDerived,
      selection: fact.selection,
      filingSourceUrl: fact.filing?.sourceUrl ?? null,
      filingDate: fact.filing ? dateOnly(fact.filing.filingDate) : null,
      filingReportDate: fact.filing ? dateOnly(fact.filing.reportDate) : null,
      primaryDocument: fact.filing?.primaryDocument ?? null,
      primaryDocumentDescription:
        fact.filing?.primaryDocumentDescription ?? null,
      rawSourceKind: fact.rawSource.kind,
      rawSourceUrl: fact.rawSource.sourceUrl,
      rawObjectKey: fact.rawSource.objectKey,
      rawSha256: fact.rawSource.sha256,
      rawContentType: fact.rawSource.contentType,
      rawByteLength: stringValue(fact.rawSource.byteLength),
      rawFirstRetrievedAt: date(fact.rawSource.firstRetrievedAt),
      rawLastRetrievedAt: date(fact.rawSource.lastRetrievedAt),
    },
  });
}

function makePeerEvidence(
  stock: ResearchEvidenceStock,
  peers: readonly ResearchEvidencePeer[],
) {
  const sourceReference = `public-peer-set:${stock.ticker}`;
  const excerpt =
    peers.length === 0
      ? `No supported public peer was found for ${stock.ticker} using exact industry followed by sector matching.`
      : `${stock.ticker} public peers are ${peers
          .map(
            (peer) =>
              `${peer.ticker} (${peer.companyName}; ${peer.relationship.toLowerCase()} match)`,
          )
          .join(
            ", ",
          )}. Peers are selected deterministically from the supported public stock catalog.`;
  return validatedEvidence({
    id: evidenceId({ sourceKind: "PEER_SET", sourceReference }),
    sourceKind: "PEER_SET",
    title: text(`${stock.ticker} public peer set`, 240),
    sourceReference,
    sourceUrl: null,
    accessionNumber: null,
    section: "Deterministic peer selection",
    objectKey: null,
    sha256: null,
    sourceDate: null,
    retrievedAt: null,
    excerpt: text(excerpt, 4_000),
    passageStart: null,
    passageEnd: null,
    secFilingId: null,
    secRawSourceId: null,
    secFinancialFactId: null,
    metadata: {
      evidenceType: "PUBLIC_PEER_SET",
      agentNames: ["COMPETITORS", "SYNTHESIS"],
      mandatoryAgentNames: ["COMPETITORS"],
      ticker: stock.ticker,
      selectionMethod: "EXACT_INDUSTRY_THEN_SECTOR_V1",
      peerCount: peers.length,
      peers: peers.map((peer) => ({ ...peer })),
    },
  });
}

function makeMissingMetricsEvidence(
  stock: ResearchEvidenceStock,
  missingMetrics: readonly string[],
  ambiguousMetrics: readonly string[],
) {
  const sourceReference = `sec-metric-availability:${stock.ticker}`;
  const details = [
    missingMetrics.length > 0
      ? `Missing selected SEC metrics: ${missingMetrics.join(", ")}.`
      : "No expected SEC metric is wholly missing from the selected snapshot.",
    ambiguousMetrics.length > 0
      ? `Withheld because the latest normalized observation is ambiguous: ${ambiguousMetrics.join(", ")}.`
      : "No latest normalized metric observation is marked ambiguous.",
    "Missing or ambiguous values must not be inferred as zero.",
  ].join(" ");
  return validatedEvidence({
    id: evidenceId({ sourceKind: "DETERMINISTIC", sourceReference }),
    sourceKind: "DETERMINISTIC",
    title: text(`${stock.ticker} explicit SEC metric availability`, 240),
    sourceReference,
    sourceUrl: null,
    accessionNumber: null,
    section: "Missing-data policy",
    objectKey: null,
    sha256: null,
    sourceDate: null,
    retrievedAt: null,
    excerpt: text(details, 4_000),
    passageStart: null,
    passageEnd: null,
    secFilingId: null,
    secRawSourceId: null,
    secFinancialFactId: null,
    metadata: {
      evidenceType: "EXPLICIT_MISSING_METRICS",
      agentNames: ["FINANCIALS", "RISK", "SYNTHESIS"],
      mandatoryAgentNames: ["FINANCIALS", "RISK", "SYNTHESIS"],
      expectedMetrics: [...expectedMetricNames].sort(),
      missingMetrics: [...missingMetrics],
      ambiguousMetrics: [...ambiguousMetrics],
      missingValuePolicy: "DO_NOT_INFER_ZERO",
    },
  });
}

type SelectableFact = {
  externalKey: string;
  canonicalMetric: string;
  periodKind: string;
  periodStart: DateValue | null;
  periodEnd: DateValue;
  filedAt: DateValue;
  selection: "SELECTED" | "AMBIGUOUS" | "SUPERSEDED";
};

function boundaries(fact: SelectableFact): PeriodBoundaries {
  return {
    periodStart: dateOnly(fact.periodStart),
    periodEnd: dateOnly(fact.periodEnd) ?? "",
  };
}

function samePeriod(left: SelectableFact, right: SelectableFact) {
  return sameBoundaries(boundaries(left), boundaries(right));
}

/**
 * The prior-year observation comparable to the reference period, using the
 * derived-metric service's comparable window so selection and calculation
 * agree. An ambiguous comparable is excluded so growth stays unavailable.
 */
function priorYearComparable<T extends SelectableFact>(
  group: readonly T[],
  reference: T,
) {
  const target = boundaries(reference);
  const window = group.filter((fact) =>
    isPriorYearComparable(boundaries(fact), target),
  );
  const nearest = [...window].sort(
    (left, right) =>
      priorYearDistance(boundaries(left), target) -
        priorYearDistance(boundaries(right), target) ||
      compareFact(left, right),
  )[0];
  if (!nearest) return null;
  return window
    .filter((fact) => samePeriod(fact, nearest))
    .some((fact) => fact.selection === "AMBIGUOUS")
    ? null
    : nearest.selection === "SELECTED"
      ? nearest
      : null;
}

function selectFacts<T extends SelectableFact>(
  candidates: readonly T[],
  factsPerMetric: number,
  options: { trendQuarters: number; comparables: boolean },
) {
  const selected = new Map<string, T>();
  const ambiguousMetrics = new Set<string>();
  const byMetric = new Map<string, T[]>();
  for (const candidate of candidates) {
    if (!expectedMetricNames.includes(candidate.canonicalMetric)) continue;
    const group = byMetric.get(candidate.canonicalMetric) ?? [];
    group.push(candidate);
    byMetric.set(candidate.canonicalMetric, group);
  }

  for (const metric of [...expectedMetricNames].sort()) {
    const byPeriodKind = new Map<string, T[]>();
    for (const fact of byMetric.get(metric) ?? []) {
      const group = byPeriodKind.get(fact.periodKind) ?? [];
      group.push(fact);
      byPeriodKind.set(fact.periodKind, group);
    }
    const metricLatest: T[] = [];
    const metricExtra: T[] = [];
    for (const [periodKind, group] of byPeriodKind) {
      group.sort(compareFact);
      const latestPeriod = date(group[0]?.periodEnd);
      const latest = group.filter(
        (fact) => date(fact.periodEnd) === latestPeriod,
      );
      if (latest.some((fact) => fact.selection === "AMBIGUOUS")) {
        ambiguousMetrics.add(metric);
        continue;
      }
      const value = latest.find((fact) => fact.selection === "SELECTED");
      if (!value) continue;
      metricLatest.push(value);
      if (options.comparables) {
        const comparable = priorYearComparable(group, value);
        if (comparable) metricExtra.push(comparable);
      }
      if (
        options.trendQuarters > 0 &&
        periodKind === "QUARTERLY" &&
        TREND_METRICS.has(metric)
      ) {
        const quarters = new Set<string>();
        for (const fact of group) {
          if (fact.selection !== "SELECTED") continue;
          const periodEnd = date(fact.periodEnd) ?? "";
          if (quarters.has(periodEnd)) continue;
          if (
            group.some(
              (candidate) =>
                candidate.selection === "AMBIGUOUS" &&
                samePeriod(candidate, fact),
            )
          ) {
            continue;
          }
          quarters.add(periodEnd);
          metricExtra.push(fact);
          if (quarters.size >= options.trendQuarters) break;
        }
      }
    }
    metricLatest.sort(compareFact);
    for (const fact of [...metricLatest.slice(0, factsPerMetric), ...metricExtra]) {
      selected.set(fact.externalKey, fact);
    }
  }

  return {
    selected: [...selected.values()].sort(
      (left, right) =>
        left.canonicalMetric.localeCompare(right.canonicalMetric) ||
        compareFact(left, right),
    ),
    ambiguousMetrics: [...ambiguousMetrics].sort(),
  };
}

function compareFact(left: SelectableFact, right: SelectableFact) {
  return (
    (date(right.periodEnd) ?? "").localeCompare(date(left.periodEnd) ?? "") ||
    (date(right.filedAt) ?? "").localeCompare(date(left.filedAt) ?? "") ||
    left.externalKey.localeCompare(right.externalKey)
  );
}

function shapeStock(record: PublicStockEvidenceRecord): ResearchEvidenceStock {
  return deepFreeze({
    stockId: record.id,
    companyId: record.company?.id ?? null,
    ticker: text(record.ticker.toUpperCase(), 20),
    companyName: text(record.companyName, 500),
    legalName: record.company
      ? text(record.company.secEntity?.legalName ?? record.company.name, 500)
      : null,
    slug: record.company ? text(record.company.slug, 240) : null,
    sector: text(record.sector, 240),
    industry: text(record.industry, 240),
    exchange: text(record.exchange, 120),
    currency: text(record.currency, 20),
    cik: record.company?.secEntity?.cik ?? null,
    sic: record.company?.secEntity?.sic ?? null,
    sicDescription: record.company?.secEntity?.sicDescription
      ? text(record.company.secEntity.sicDescription, 500)
      : null,
    fiscalYearEnd: record.company?.secEntity?.fiscalYearEnd ?? null,
    stateOfIncorporation:
      record.company?.secEntity?.stateOfIncorporation ?? null,
    isSupported: record.company?.isSupported ?? false,
    lastSyncedAt: date(record.company?.lastSyncedAt ?? null),
  });
}

function shapePeers(
  stock: ResearchEvidenceStock,
  records: readonly PublicPeerRecord[],
  maximum: number,
) {
  const unique = new Map<string, ResearchEvidencePeer>();
  for (const record of records) {
    if (record.id === stock.stockId || unique.has(record.id)) continue;
    unique.set(record.id, {
      stockId: record.id,
      companyId: record.company?.id ?? null,
      ticker: text(record.ticker.toUpperCase(), 20),
      companyName: text(record.companyName, 500),
      legalName: record.company
        ? text(record.company.secEntity?.legalName ?? record.company.name, 500)
        : null,
      slug: record.company ? text(record.company.slug, 240) : null,
      sector: text(record.sector, 240),
      industry: text(record.industry, 240),
      exchange: text(record.exchange, 120),
      currency: text(record.currency, 20),
      cik: record.company?.secEntity?.cik ?? null,
      relationship: record.industry === stock.industry ? "INDUSTRY" : "SECTOR",
    });
  }
  return deepFreeze(
    [...unique.values()]
      .sort(
        (left, right) =>
          (left.relationship === right.relationship
            ? 0
            : left.relationship === "INDUSTRY"
              ? -1
              : 1) || left.ticker.localeCompare(right.ticker),
      )
      .slice(0, maximum),
  );
}

function structuredFact(
  fact: SecFactEvidenceRecord,
  evidence: ResearchEvidence,
): StructuredFact {
  return {
    referenceId: evidence.id,
    evidenceId: evidence.id,
    externalKey: fact.externalKey,
    metric: fact.canonicalMetric,
    label: fact.label,
    value: Number(stringValue(fact.normalizedValue)),
    unit: fact.normalizedUnit,
    periodKind: fact.periodKind as StructuredFact["periodKind"],
    periodStart: dateOnly(fact.periodStart),
    periodEnd: dateOnly(fact.periodEnd) ?? "",
    filedAt: dateOnly(fact.filedAt) ?? "",
    accessionNumber: fact.accessionNumber,
    selection: fact.selection,
  };
}

function peerStructuredFact(fact: PeerSecFactRecord): StructuredFact {
  return {
    referenceId: `sec-fact:${fact.externalKey}`,
    evidenceId: null,
    externalKey: fact.externalKey,
    metric: fact.canonicalMetric,
    label: fact.label,
    value: Number(stringValue(fact.normalizedValue)),
    unit: fact.normalizedUnit,
    periodKind: fact.periodKind as StructuredFact["periodKind"],
    periodStart: dateOnly(fact.periodStart),
    periodEnd: dateOnly(fact.periodEnd) ?? "",
    filedAt: dateOnly(fact.filedAt) ?? "",
    accessionNumber: fact.accessionNumber,
    selection: fact.selection,
  };
}

function shapeStructuredPeers(
  peers: readonly ResearchEvidencePeer[],
  peerRecords: readonly PublicPeerRecord[],
  peerFactCandidates: readonly PeerSecFactRecord[],
): StructuredPeer[] {
  const entityByStockId = new Map(
    peerRecords.map((record) => [record.id, record.company?.secEntity?.id ?? null]),
  );
  return peers.map((peer) => {
    const secEntityId = entityByStockId.get(peer.stockId) ?? null;
    const candidates = secEntityId
      ? peerFactCandidates.filter((fact) => fact.secEntityId === secEntityId)
      : [];
    const selection = selectFacts(candidates, DEFAULT_LIMITS.factsPerMetric, {
      trendQuarters: 0,
      comparables: true,
    });
    return {
      ticker: peer.ticker,
      companyName: peer.companyName,
      cik: peer.cik,
      relationship: peer.relationship,
      facts: selection.selected.map(peerStructuredFact),
      ambiguousMetrics: selection.ambiguousMetrics,
    };
  });
}

function peerFactLookbacks(selected: readonly SecFactEvidenceRecord[]) {
  const latest = selected
    .map((fact) => date(fact.periodEnd))
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);
  if (!latest) return null;
  const from = (days: number) => {
    const value = new Date(latest);
    value.setUTCDate(value.getUTCDate() - days);
    return value;
  };
  return {
    annualPeriodEndFrom: from(PEER_ANNUAL_LOOKBACK_DAYS),
    instantPeriodEndFrom: from(PEER_INSTANT_LOOKBACK_DAYS),
  };
}

export type ResearchEvidenceSnapshotInput = {
  record: PublicStockEvidenceRecord;
  factCandidates: readonly SecFactEvidenceRecord[];
  peerRecords: readonly PublicPeerRecord[];
  peerFactCandidates: readonly PeerSecFactRecord[];
  upcomingEarnings: UpcomingEarningsRecord | null;
  limits?: Partial<EvidenceSnapshotLimits>;
};

/**
 * Selects the subject's SEC facts (latest per period kind, prior-year
 * comparables, and trend quarters), derives deterministic metrics, and
 * assembles the immutable snapshot. Pure so fixtures can build it offline.
 */
export function assembleResearchEvidenceSnapshot(
  input: ResearchEvidenceSnapshotInput,
): ResearchEvidenceSnapshot {
  const limits = resolveLimits(input.limits);
  const record = input.record;
  const stock = shapeStock(record);
  const factSelection = selectFacts(input.factCandidates, limits.factsPerMetric, {
    trendQuarters: TREND_QUARTERS,
    comparables: true,
  });
  const selectedMetricNames = new Set(
    factSelection.selected.map((fact) => fact.canonicalMetric),
  );
  const missingMetrics = deepFreeze(
    [...expectedMetricNames]
      .filter((metric) => !selectedMetricNames.has(metric))
      .sort(),
  );
  const ambiguousMetrics = deepFreeze(factSelection.ambiguousMetrics);
  const peers = shapePeers(stock, input.peerRecords, limits.maxPeers);
  const identityRawSource = record.company?.secEntity?.rawSources[0] ?? null;
  const factEvidence = factSelection.selected.map(makeFactEvidence);
  const structuredFacts = factSelection.selected.map((fact, index) =>
    structuredFact(fact, factEvidence[index]),
  );
  const structuredStock = {
    ticker: stock.ticker,
    companyName: stock.companyName,
    cik: stock.cik,
  };
  const derived = buildDerivedMetricEvidence(
    structuredStock,
    structuredFacts,
    ambiguousMetrics,
  );
  const earnings =
    input.upcomingEarnings && input.upcomingEarnings.eventDate !== null
      ? buildUpcomingEarningsEvidence(structuredStock, {
          eventDate: dateOnly(input.upcomingEarnings.eventDate) ?? "",
          marketSession: input.upcomingEarnings.marketSession,
          source: text(input.upcomingEarnings.source, 240),
        })
      : null;
  const evidence = deepFreeze(
    [
      makeCompanyEvidence(stock, identityRawSource),
      // The small policy item precedes the tables so a tight budget never
      // cuts the statement of what is missing.
      makeMissingMetricsEvidence(stock, missingMetrics, ambiguousMetrics),
      ...factEvidence,
      ...derived.evidence.map(validatedEvidence),
      validatedEvidence(
        buildFinancialSummaryEvidence(
          structuredStock,
          structuredFacts,
          derived.metrics,
        ),
      ),
      validatedEvidence(buildTrendEvidence(structuredStock, structuredFacts)),
      makePeerEvidence(stock, peers),
      validatedEvidence(
        buildPeerComparisonEvidence(
          structuredStock,
          { facts: structuredFacts, metrics: derived.metrics },
          shapeStructuredPeers(peers, input.peerRecords, input.peerFactCandidates),
        ),
      ),
      ...(earnings ? [validatedEvidence(earnings)] : []),
    ].slice(0, MAX_SNAPSHOT_EVIDENCE),
  );

  const sourceDataVersion = stableHash({
    schemaVersion: RESEARCH_EVIDENCE_SNAPSHOT_VERSION,
    stock,
    peers,
    missingMetrics,
    ambiguousMetrics,
    evidence,
  });
  const inputDataVersion = stableHash({
    sourceDataVersion,
    retrievalVersion: AI_RETRIEVAL_VERSION,
    evidenceIds: evidence.map((item) => item.id),
  });
  const snapshotWithoutHash = {
    schemaVersion: RESEARCH_EVIDENCE_SNAPSHOT_VERSION,
    retrievalVersion: AI_RETRIEVAL_VERSION,
    sourceDataVersion,
    inputDataVersion,
    stock,
    peers,
    missingMetrics,
    ambiguousMetrics,
    evidence,
  } as const;
  return deepFreeze({
    ...snapshotWithoutHash,
    sourceSnapshotSha256: stableHash(snapshotWithoutHash),
  });
}

export async function prepareResearchEvidenceSnapshot(
  requestedStock: ResearchJobStockIdentity,
  dependencies: ResearchEvidenceDependencies = {},
): Promise<ResearchEvidenceSnapshot> {
  const repository = resolveRepository(dependencies);
  const limits = resolveLimits(dependencies.limits);
  const record = await repository.findPublicStock(requestedStock.stockId);
  if (!record) {
    throw new ResearchEvidenceSnapshotError(
      "RESEARCH_STOCK_NOT_FOUND",
      "The research stock is not available in the public catalog.",
    );
  }
  const secEntityId = record.company?.secEntity?.id ?? null;
  const [factCandidates, peerRecords, upcomingEarnings] = await Promise.all([
    secEntityId && limits.factsPerMetric > 0
      ? repository.listSecFactCandidates({
          secEntityId,
          metrics: expectedMetricNames,
          takePerMetric: Math.max(
            limits.factsPerMetric,
            limits.factCandidatesPerMetric,
          ),
        })
      : Promise.resolve([]),
    repository.listPublicPeers({
      stockId: record.id,
      industry: text(record.industry, 240),
      sector: text(record.sector, 240),
      take: limits.maxPeers,
    }),
    repository.findUpcomingEarnings(record.id),
  ]);
  const lookbacks = peerFactLookbacks(
    selectFacts(factCandidates, limits.factsPerMetric, {
      trendQuarters: 0,
      comparables: false,
    }).selected,
  );
  const peerEntityIds = peerRecords
    .slice(0, limits.maxPeers)
    .map((peer) => peer.company?.secEntity?.id ?? null)
    .filter((id): id is string => id !== null);
  const peerFactCandidates =
    lookbacks && peerEntityIds.length > 0
      ? await repository.listPeerSecFactCandidates({
          secEntityIds: peerEntityIds,
          metrics: expectedMetricNames,
          ...lookbacks,
          take: MAX_PEER_FACT_ROWS,
        })
      : [];
  return assembleResearchEvidenceSnapshot({
    record,
    factCandidates,
    peerRecords,
    peerFactCandidates,
    upcomingEarnings,
    limits: dependencies.limits,
  });
}

function parsePersistedSnapshot(
  value: unknown,
  stock: ResearchJobStockIdentity,
): ResearchEvidenceSnapshot {
  const parsed = persistedSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new ResearchEvidenceSnapshotError(
      "INVALID_PUBLIC_EVIDENCE",
      "The persisted research evidence snapshot is invalid.",
      { cause: parsed.error },
    );
  }
  const snapshot = parsed.data;
  if (
    snapshot.stock.stockId !== stock.stockId ||
    snapshot.stock.ticker !== stock.ticker.toUpperCase()
  ) {
    throw new ResearchEvidenceSnapshotError(
      "INVALID_PUBLIC_EVIDENCE",
      "The persisted research evidence snapshot does not match the job stock.",
    );
  }
  const expectedSourceDataVersion = stableHash({
    schemaVersion: snapshot.schemaVersion,
    stock: snapshot.stock,
    peers: snapshot.peers,
    missingMetrics: snapshot.missingMetrics,
    ambiguousMetrics: snapshot.ambiguousMetrics,
    evidence: snapshot.evidence,
  });
  const expectedInputDataVersion = stableHash({
    sourceDataVersion: expectedSourceDataVersion,
    retrievalVersion: snapshot.retrievalVersion,
    evidenceIds: snapshot.evidence.map((item) => item.id),
  });
  const withoutHash = {
    schemaVersion: snapshot.schemaVersion,
    retrievalVersion: snapshot.retrievalVersion,
    sourceDataVersion: snapshot.sourceDataVersion,
    inputDataVersion: snapshot.inputDataVersion,
    stock: snapshot.stock,
    peers: snapshot.peers,
    missingMetrics: snapshot.missingMetrics,
    ambiguousMetrics: snapshot.ambiguousMetrics,
    evidence: snapshot.evidence,
  };
  if (
    snapshot.sourceDataVersion !== expectedSourceDataVersion ||
    snapshot.inputDataVersion !== expectedInputDataVersion ||
    snapshot.sourceSnapshotSha256 !== stableHash(withoutHash)
  ) {
    throw new ResearchEvidenceSnapshotError(
      "INVALID_PUBLIC_EVIDENCE",
      "The persisted research evidence snapshot failed its integrity check.",
    );
  }
  return deepFreeze(snapshot as ResearchEvidenceSnapshot);
}

export async function buildResearchEvidenceSnapshot(
  jobId: string,
  dependencies: ResearchEvidenceDependencies = {},
): Promise<ResearchEvidenceSnapshot | null> {
  const repository = resolveRepository(dependencies);
  const stock = await repository.findResearchJobStock(jobId);
  if (!stock) return null;
  if (
    stock.sourceSnapshotJson !== null &&
    stock.sourceSnapshotJson !== undefined
  ) {
    return parsePersistedSnapshot(stock.sourceSnapshotJson, stock);
  }
  if (stock.generationMode === "EXTERNAL") return null;
  return prepareResearchEvidenceSnapshot(stock, {
    ...dependencies,
    repository,
  });
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "was",
  "with",
]);

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
}

function queryTerms(query: string) {
  return [
    ...new Set(
      normalizeSearchText(query)
        .split(" ")
        .filter((term) => term.length > 1 && !STOP_WORDS.has(term)),
    ),
  ].slice(0, 64);
}

function occurrences(haystack: string, needle: string) {
  let count = 0;
  let position = 0;
  while ((position = haystack.indexOf(needle, position)) >= 0) {
    count += 1;
    position += needle.length;
  }
  return count;
}

function metadataAtPath(metadata: Record<string, unknown>, path: string) {
  let value: unknown = metadata;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function scalarMatches(actual: unknown, expected: MetadataFilterScalar) {
  if (actual === expected) return true;
  if (typeof actual === "string" && typeof expected === "string") {
    return normalizeSearchText(actual) === normalizeSearchText(expected);
  }
  return false;
}

function metadataMatches(
  evidence: ResearchEvidence,
  filters: Readonly<Record<string, MetadataFilterValue>> | undefined,
) {
  if (!filters) return true;
  return Object.entries(filters).every(([path, expected]) => {
    const actual = metadataAtPath(evidence.metadata, path);
    const expectedValues = Array.isArray(expected) ? expected : [expected];
    if (Array.isArray(actual)) {
      return expectedValues.every((expectedValue) =>
        actual.some((actualValue) => scalarMatches(actualValue, expectedValue)),
      );
    }
    return expectedValues.every((expectedValue) =>
      scalarMatches(actual, expectedValue),
    );
  });
}

function supportsAgent(evidence: ResearchEvidence, agent: ResearchAgentName) {
  const agents = evidence.metadata.agentNames;
  return (
    Array.isArray(agents) && agents.some((candidate) => candidate === agent)
  );
}

function isMandatoryFor(evidence: ResearchEvidence, agent: ResearchAgentName) {
  const agents = evidence.metadata.mandatoryAgentNames;
  return (
    Array.isArray(agents) && agents.some((candidate) => candidate === agent)
  );
}

function scoreEvidence(
  evidence: ResearchEvidence,
  terms: readonly string[],
  phrase: string,
) {
  const title = normalizeSearchText(evidence.title);
  const excerpt = normalizeSearchText(evidence.excerpt);
  const reference = normalizeSearchText(evidence.sourceReference);
  const metadata = normalizeSearchText(JSON.stringify(evidence.metadata));
  let score = 0;
  const matchedTerms: string[] = [];
  for (const term of terms) {
    const termScore =
      occurrences(title, term) * 10 +
      occurrences(excerpt, term) * 4 +
      occurrences(reference, term) * 2 +
      occurrences(metadata, term);
    if (termScore > 0) {
      matchedTerms.push(term);
      score += termScore + 3;
    }
  }
  if (phrase.length > 1) {
    if (title.includes(phrase)) score += 25;
    if (excerpt.includes(phrase)) score += 12;
  }
  if (terms.length > 0 && matchedTerms.length === terms.length) score += 8;
  return { score, matchedTerms };
}

function renderContext(
  evidence: ResearchEvidence,
  budget: number,
): { text: string; truncated: boolean } | null {
  const prefix = `[${evidence.id}] ${evidence.title}\n`;
  const suffix = `\nSource: ${evidence.sourceReference}`;
  if (prefix.length + suffix.length + 1 > budget) return null;
  const available = budget - prefix.length - suffix.length;
  const excerpt = evidence.excerpt.slice(0, available);
  return {
    text: `${prefix}${excerpt}${suffix}`,
    truncated: excerpt.length < evidence.excerpt.length,
  };
}

export function selectEvidence(
  snapshot: ResearchEvidenceSnapshot,
  request: EvidenceSelectionRequest,
): EvidenceSelectionResult {
  const query = request.query.slice(0, MAX_QUERY_CHARACTERS).trim();
  const terms = queryTerms(query);
  const phrase = normalizeSearchText(query);
  const sourceKinds = request.sourceKinds ? new Set(request.sourceKinds) : null;
  const eligible = snapshot.evidence.filter(
    (item) =>
      (!request.agent || supportsAgent(item, request.agent)) &&
      (!sourceKinds || sourceKinds.has(item.sourceKind)) &&
      metadataMatches(item, request.metadata),
  );
  // Structured evidence owned by the agent is included first, in snapshot
  // order, before lexical ranking fills the remaining budget.
  const mandatory = request.agent
    ? eligible
        .filter((item) => isMandatoryFor(item, request.agent!))
        .map((item) => ({ item, ...scoreEvidence(item, terms, phrase) }))
    : [];
  const mandatoryIds = new Set(mandatory.map((entry) => entry.item.id));
  const ranked = eligible
    .filter((item) => !mandatoryIds.has(item.id))
    .map((item) => ({ item, ...scoreEvidence(item, terms, phrase) }))
    .filter((item) => terms.length === 0 || item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.item.id.localeCompare(right.item.id),
    );
  const maxResults = integerLimit(
    request.maxResults,
    DEFAULT_MAX_RESULTS,
    MAX_RESULTS,
  );
  const budget = integerLimit(
    request.contextCharBudget,
    DEFAULT_CONTEXT_CHAR_BUDGET,
    MAX_CONTEXT_CHAR_BUDGET,
  );
  const selected: ResearchEvidence[] = [];
  const matches: EvidenceMatch[] = [];
  const blocks: string[] = [];
  let used = 0;
  let excerptTruncated = false;

  const include = (
    candidate: (typeof ranked)[number],
    options: { wholeOnly: boolean },
  ) => {
    const separator = blocks.length === 0 ? 0 : 2;
    const rendered = renderContext(candidate.item, budget - used - separator);
    if (!rendered) return false;
    // A partially rendered derived value could drop its formula, inputs, or
    // derived marker, so lexical fill includes derived evidence whole or not at all.
    if (options.wholeOnly && rendered.truncated) return false;
    if (separator) used += separator;
    blocks.push(rendered.text);
    used += rendered.text.length;
    excerptTruncated ||= rendered.truncated;
    selected.push(candidate.item);
    matches.push(
      deepFreeze({
        evidenceId: candidate.item.id,
        score: candidate.score,
        matchedTerms: deepFreeze([...candidate.matchedTerms]),
      }),
    );
    return true;
  };

  for (const candidate of mandatory) include(candidate, { wholeOnly: false });
  for (const candidate of ranked) {
    if (selected.length >= maxResults) break;
    include(candidate, {
      wholeOnly: candidate.item.sourceKind === "DERIVED",
    });
  }

  const omittedEvidenceCount = mandatory.length + ranked.length - selected.length;
  const context = blocks.join("\n\n");
  return deepFreeze({
    query,
    agent: request.agent ?? null,
    retrievalVersion: AI_RETRIEVAL_VERSION,
    evidence: selected,
    evidenceIds: selected.map((item) => item.id),
    mandatoryEvidenceIds: selected
      .filter((item) => mandatoryIds.has(item.id))
      .map((item) => item.id),
    matches,
    context,
    contextCharacters: context.length,
    omittedEvidenceCount,
    truncated: excerptTruncated || omittedEvidenceCount > 0,
  });
}

export const retrieveResearchEvidence = selectEvidence;

function specialistQuery(agentName: SpecialistAgentName) {
  switch (agentName) {
    case "FINANCIALS":
      return "revenue income cash flow margin growth derived summary trend assets liabilities equity financial period annual quarterly";
    case "COMPETITORS":
      return "company sector industry exchange peer competitors comparison derived";
    case "RISK":
      return "liabilities debt equity cash leverage liquidity ratio revenue concentration ambiguity missing risk filing derived";
    case "NEWS":
      return "licensed current company news";
    case "POLITICAL_ACTIVITY":
      return "verified political activity lobbying contribution";
  }
}

/** Specialist retrieval: owned structured evidence first, lexical fill after. */
export function selectSpecialistEvidence(
  snapshot: ResearchEvidenceSnapshot,
  agentName: SpecialistAgentName,
) {
  return selectEvidence(snapshot, {
    query: specialistQuery(agentName),
    agent: agentName,
    maxResults: AI_SPECIALIST_MAX_EVIDENCE_ITEMS,
    contextCharBudget: AI_SPECIALIST_CONTEXT_CHAR_BUDGET,
  });
}

export function selectSynthesisEvidence(snapshot: ResearchEvidenceSnapshot) {
  return selectEvidence(snapshot, {
    query:
      "company financial performance derived summary trend peers competitors risk evidence counterpoint",
    agent: "SYNTHESIS",
    maxResults: AI_SYNTHESIS_MAX_EVIDENCE_ITEMS,
    contextCharBudget: AI_SYNTHESIS_CONTEXT_CHAR_BUDGET,
  });
}
