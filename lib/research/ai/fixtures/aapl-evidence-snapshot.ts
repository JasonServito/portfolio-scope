import {
  assembleResearchEvidenceSnapshot,
  type PeerSecFactRecord,
  type PublicPeerRecord,
  type PublicStockEvidenceRecord,
  type ResearchEvidenceSnapshot,
  type SecFactEvidenceRecord,
  type UpcomingEarningsRecord,
} from "@/lib/research/ai/retrieval";
import { normalizeCompanyFacts } from "@/lib/sec/normalization";
import { secCompanyFactsSchema } from "@/lib/sec/schemas";
import aaplCompanyFacts from "@/tests/fixtures/sec/aapl-companyfacts-history.json";
import msftCompanyFacts from "@/tests/fixtures/sec/msft-companyfacts-history.json";
import nvdaCompanyFacts from "@/tests/fixtures/sec/nvda-companyfacts-history.json";

/**
 * A deterministic AAPL research evidence snapshot assembled offline from the
 * checked-in, clipped SEC Company Facts fixtures (public EDGAR data captured
 * 2026-09-22). No database, network, or provider is involved.
 */

const OBSERVED_AT = new Date("2026-09-22T00:00:00.000Z");
const RETRIEVED_AT = new Date("2026-09-21T12:00:00.000Z");
const COMPANY_FACTS_HASH = "2".repeat(64);
const SUBMISSIONS_HASH = "1".repeat(64);

export const AAPL_FIXTURE_STOCK: PublicStockEvidenceRecord = {
  id: "stock-aapl-fixture",
  ticker: "AAPL",
  companyName: "Apple Inc.",
  sector: "Technology",
  industry: "Consumer Electronics",
  exchange: "NASDAQ",
  currency: "USD",
  company: {
    id: "company-aapl-fixture",
    slug: "apple",
    name: "Apple Inc.",
    currency: "USD",
    isActive: true,
    isSupported: true,
    lastSyncedAt: RETRIEVED_AT,
    secEntity: {
      id: "sec-aapl-fixture",
      cik: "0000320193",
      legalName: "Apple Inc.",
      sic: "3571",
      sicDescription: "Electronic Computers",
      fiscalYearEnd: "0927",
      stateOfIncorporation: "CA",
      rawSources: [
        {
          id: "raw-aapl-submissions-fixture",
          kind: "SUBMISSIONS",
          sourceUrl: "https://data.sec.gov/submissions/CIK0000320193.json",
          objectKey: `sec/0000320193/submissions/${SUBMISSIONS_HASH}.json`,
          sha256: SUBMISSIONS_HASH,
          contentType: "application/json",
          byteLength: "1024",
          firstRetrievedAt: RETRIEVED_AT,
          lastRetrievedAt: RETRIEVED_AT,
        },
      ],
    },
  },
};

export const AAPL_FIXTURE_PEERS: PublicPeerRecord[] = [
  {
    id: "stock-msft-fixture",
    ticker: "MSFT",
    companyName: "Microsoft Corporation",
    sector: "Technology",
    industry: "Software Infrastructure",
    exchange: "NASDAQ",
    currency: "USD",
    company: {
      id: "company-msft-fixture",
      slug: "microsoft",
      name: "Microsoft Corporation",
      isSupported: true,
      secEntity: {
        id: "sec-msft-fixture",
        cik: "0000789019",
        legalName: "Microsoft Corporation",
      },
    },
  },
  {
    id: "stock-nvda-fixture",
    ticker: "NVDA",
    companyName: "NVIDIA Corporation",
    sector: "Technology",
    industry: "Semiconductors",
    exchange: "NASDAQ",
    currency: "USD",
    company: {
      id: "company-nvda-fixture",
      slug: "nvidia",
      name: "NVIDIA Corporation",
      isSupported: true,
      secEntity: {
        id: "sec-nvda-fixture",
        cik: "0001045810",
        legalName: "NVIDIA Corporation",
      },
    },
  },
  {
    id: "stock-orcl-fixture",
    ticker: "ORCL",
    companyName: "Oracle Corporation",
    sector: "Technology",
    industry: "Software Infrastructure",
    exchange: "NYSE",
    currency: "USD",
    company: {
      id: "company-orcl-fixture",
      slug: "oracle",
      name: "Oracle Corporation",
      isSupported: true,
      secEntity: {
        id: "sec-orcl-fixture",
        cik: "0001341439",
        legalName: "Oracle Corporation",
      },
    },
  },
];

export const AAPL_FIXTURE_UPCOMING_EARNINGS: UpcomingEarningsRecord = {
  eventDate: new Date("2026-10-29T00:00:00.000Z"),
  marketSession: "AFTER_MARKET",
  source: "EarningsAPI.com /v1/earnings",
  fetchedAt: RETRIEVED_AT,
};

function normalized(fixture: unknown, cik: string) {
  return normalizeCompanyFacts(secCompanyFactsSchema.parse(fixture), {
    cik,
    observedAt: OBSERVED_AT,
  });
}

export function aaplFixtureFactCandidates(): SecFactEvidenceRecord[] {
  return normalized(aaplCompanyFacts, "320193")
    .filter((fact) => fact.selection !== "SUPERSEDED")
    .map((fact) => ({
      id: `fact-${fact.externalKey.slice(0, 16)}`,
      secEntityId: "sec-aapl-fixture",
      filingId: null,
      rawSourceId: "raw-aapl-company-facts-fixture",
      externalKey: fact.externalKey,
      canonicalMetric: fact.canonicalMetric,
      taxonomy: fact.taxonomy,
      concept: fact.concept,
      label: fact.label,
      description: fact.description,
      originalValue: fact.originalValue,
      originalUnit: fact.originalUnit,
      normalizedValue: fact.normalizedValue,
      normalizedUnit: fact.normalizedUnit,
      periodStart: fact.periodStart,
      periodEnd: fact.periodEnd,
      periodType: fact.periodType,
      periodKind: fact.periodKind,
      fiscalYear: fact.fiscalYear,
      fiscalPeriod: fact.fiscalPeriod,
      formType: fact.formType,
      filedAt: fact.filedAt,
      accessionNumber: fact.accessionNumber,
      frame: fact.frame,
      sourceUrl: fact.sourceUrl,
      observedAt: fact.observedAt,
      normalizationVersion: fact.normalizationVersion,
      isDerived: false,
      selection: fact.selection,
      ambiguityReason: fact.ambiguityReason,
      filing: null,
      rawSource: {
        id: "raw-aapl-company-facts-fixture",
        kind: "COMPANY_FACTS",
        sourceUrl:
          "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
        objectKey: `sec/0000320193/company-facts/${COMPANY_FACTS_HASH}.json`,
        sha256: COMPANY_FACTS_HASH,
        contentType: "application/json",
        byteLength: "147683",
        firstRetrievedAt: RETRIEVED_AT,
        lastRetrievedAt: RETRIEVED_AT,
      },
    }));
}

export function aaplFixturePeerFactCandidates(): PeerSecFactRecord[] {
  return [
    ...normalized(msftCompanyFacts, "789019").map((fact) => ({
      fact,
      secEntityId: "sec-msft-fixture",
    })),
    ...normalized(nvdaCompanyFacts, "1045810").map((fact) => ({
      fact,
      secEntityId: "sec-nvda-fixture",
    })),
  ]
    .filter(
      ({ fact }) =>
        fact.selection !== "SUPERSEDED" &&
        (fact.periodKind === "ANNUAL" || fact.periodKind === "INSTANT"),
    )
    .map(({ fact, secEntityId }) => ({
      secEntityId,
      externalKey: fact.externalKey,
      canonicalMetric: fact.canonicalMetric,
      label: fact.label,
      normalizedValue: fact.normalizedValue,
      normalizedUnit: fact.normalizedUnit,
      periodStart: fact.periodStart,
      periodEnd: fact.periodEnd,
      periodKind: fact.periodKind,
      filedAt: fact.filedAt,
      accessionNumber: fact.accessionNumber,
      selection: fact.selection,
    }));
}

export function buildAaplFixtureSnapshot(
  overrides: Partial<{
    upcomingEarnings: UpcomingEarningsRecord | null;
    peerRecords: PublicPeerRecord[];
    peerFactCandidates: PeerSecFactRecord[];
  }> = {},
): ResearchEvidenceSnapshot {
  return assembleResearchEvidenceSnapshot({
    record: AAPL_FIXTURE_STOCK,
    factCandidates: aaplFixtureFactCandidates(),
    peerRecords: overrides.peerRecords ?? AAPL_FIXTURE_PEERS,
    peerFactCandidates:
      overrides.peerFactCandidates ?? aaplFixturePeerFactCandidates(),
    upcomingEarnings:
      overrides.upcomingEarnings === undefined
        ? AAPL_FIXTURE_UPCOMING_EARNINGS
        : overrides.upcomingEarnings,
  });
}

export function findFixtureEvidence(
  snapshot: ResearchEvidenceSnapshot,
  metadata: Record<string, string>,
) {
  const found = snapshot.evidence.find((item) =>
    Object.entries(metadata).every(
      ([key, value]) => item.metadata[key] === value,
    ),
  );
  if (!found) {
    throw new Error(`Fixture evidence not found: ${JSON.stringify(metadata)}`);
  }
  return found;
}
