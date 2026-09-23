import { describe, expect, it, vi } from "vitest";

import {
  AI_SPECIALIST_CONTEXT_CHAR_BUDGET,
  AI_SPECIALIST_MAX_EVIDENCE_ITEMS,
  AI_SYNTHESIS_CONTEXT_CHAR_BUDGET,
  AI_SYNTHESIS_MAX_EVIDENCE_ITEMS,
} from "@/lib/research/ai/config";
import { buildAaplFixtureSnapshot } from "@/lib/research/ai/fixtures/aapl-evidence-snapshot";
import {
  buildResearchEvidenceSnapshot,
  prepareResearchEvidenceSnapshot,
  ResearchEvidenceSnapshotError,
  selectEvidence,
  selectSpecialistEvidence,
  selectSynthesisEvidence,
  type PublicPeerRecord,
  type PublicStockEvidenceRecord,
  type ResearchEvidenceRepository,
  type SecFactEvidenceRecord,
} from "@/lib/research/ai/retrieval";
import type { SpecialistAgentName } from "@/lib/research/types";

const submissionsHash = "1".repeat(64);
const companyFactsHash = "2".repeat(64);

const publicStock: PublicStockEvidenceRecord = {
  id: "stock-aapl",
  ticker: "AAPL",
  companyName: "Apple Inc.",
  sector: "Technology",
  industry: "Consumer Electronics",
  exchange: "NASDAQ",
  currency: "USD",
  company: {
    id: "company-apple",
    slug: "apple",
    name: "Apple Inc.",
    currency: "USD",
    isActive: true,
    isSupported: true,
    lastSyncedAt: new Date("2026-08-10T12:00:00.000Z"),
    secEntity: {
      id: "sec-apple",
      cik: "0000320193",
      legalName: "Apple Inc.",
      sic: "3571",
      sicDescription: "Electronic Computers",
      fiscalYearEnd: "0927",
      stateOfIncorporation: "CA",
      rawSources: [
        {
          id: "raw-submissions",
          kind: "SUBMISSIONS",
          sourceUrl: "https://data.sec.gov/submissions/CIK0000320193.json",
          objectKey: `sec/0000320193/submissions/${submissionsHash}.json`,
          sha256: submissionsHash,
          contentType: "application/json",
          byteLength: { toString: () => "1024" },
          firstRetrievedAt: new Date("2026-08-10T11:00:00.000Z"),
          lastRetrievedAt: new Date("2026-08-10T12:00:00.000Z"),
        },
      ],
    },
  },
};

const peers: PublicPeerRecord[] = [
  {
    id: "stock-msft",
    ticker: "MSFT",
    companyName: "Microsoft Corporation",
    sector: "Technology",
    industry: "Software",
    exchange: "NASDAQ",
    currency: "USD",
    company: {
      id: "company-msft",
      slug: "microsoft",
      name: "Microsoft Corporation",
      isSupported: true,
      secEntity: {
        id: "sec-msft",
        cik: "0000789019",
        legalName: "Microsoft Corporation",
      },
    },
  },
  {
    id: "stock-dell",
    ticker: "DELL",
    companyName: "Dell Technologies Inc.",
    sector: "Technology",
    industry: "Consumer Electronics",
    exchange: "NYSE",
    currency: "USD",
    company: {
      id: "company-dell",
      slug: "dell",
      name: "Dell Technologies Inc.",
      isSupported: true,
      secEntity: {
        id: "sec-dell",
        cik: "0001571996",
        legalName: "Dell Technologies Inc.",
      },
    },
  },
];

function fact(
  overrides: Partial<SecFactEvidenceRecord> = {},
): SecFactEvidenceRecord {
  return {
    id: "fact-revenue-2025",
    secEntityId: "sec-apple",
    filingId: "filing-2025-10k",
    rawSourceId: "raw-company-facts",
    externalKey: "revenue-2025-annual",
    canonicalMetric: "REVENUE",
    taxonomy: "us-gaap",
    concept: "RevenueFromContractWithCustomerExcludingAssessedTax",
    label: "Revenue",
    description: "Revenue from contracts with customers.",
    originalValue: { toString: () => "416161000000" },
    originalUnit: "USD",
    normalizedValue: { toString: () => "416161000000" },
    normalizedUnit: "USD",
    periodStart: new Date("2024-09-29T00:00:00.000Z"),
    periodEnd: new Date("2025-09-27T00:00:00.000Z"),
    periodType: "DURATION",
    periodKind: "ANNUAL",
    fiscalYear: 2025,
    fiscalPeriod: "FY",
    formType: "10-K",
    filedAt: new Date("2025-10-31T00:00:00.000Z"),
    accessionNumber: "0000320193-25-000079",
    frame: "CY2025",
    sourceUrl:
      "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/",
    observedAt: new Date("2026-08-10T12:00:00.000Z"),
    normalizationVersion: "sec-xbrl-v1",
    isDerived: false,
    selection: "SELECTED",
    ambiguityReason: null,
    filing: {
      id: "filing-2025-10k",
      sourceUrl:
        "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/",
      filingDate: new Date("2025-10-31T00:00:00.000Z"),
      reportDate: new Date("2025-09-27T00:00:00.000Z"),
      primaryDocument: "aapl-20250927.htm",
      primaryDocumentDescription: "Form 10-K",
    },
    rawSource: {
      id: "raw-company-facts",
      kind: "COMPANY_FACTS",
      sourceUrl:
        "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
      objectKey: `sec/0000320193/company-facts/${companyFactsHash}.json`,
      sha256: companyFactsHash,
      contentType: "application/json",
      byteLength: { toString: () => "4096" },
      firstRetrievedAt: new Date("2026-08-10T11:00:00.000Z"),
      lastRetrievedAt: new Date("2026-08-10T12:00:00.000Z"),
    },
    ...overrides,
  };
}

function repository(
  input: {
    facts?: SecFactEvidenceRecord[];
    peerRecords?: PublicPeerRecord[];
    job?: Awaited<
      ReturnType<ResearchEvidenceRepository["findResearchJobStock"]>
    >;
  } = {},
) {
  const value: ResearchEvidenceRepository = {
    findResearchJobStock: vi.fn().mockResolvedValue(
      input.job === undefined
        ? {
            stockId: publicStock.id,
            ticker: publicStock.ticker,
            companyName: publicStock.companyName,
            generationMode: "DETERMINISTIC",
            sourceSnapshotJson: null,
          }
        : input.job,
    ),
    findPublicStock: vi.fn().mockResolvedValue(publicStock),
    listSecFactCandidates: vi.fn().mockResolvedValue(input.facts ?? [fact()]),
    listPublicPeers: vi.fn().mockResolvedValue(input.peerRecords ?? peers),
    listPeerSecFactCandidates: vi.fn().mockResolvedValue([]),
    findUpcomingEarnings: vi.fn().mockResolvedValue(null),
  };
  return value;
}

describe("research evidence preparation", () => {
  it("builds a bounded immutable public snapshot with complete SEC provenance", async () => {
    const ambiguousNetIncome = fact({
      id: "fact-net-income-ambiguous",
      externalKey: "net-income-ambiguous",
      canonicalMetric: "NET_INCOME",
      concept: "NetIncomeLoss",
      label: "Net income",
      selection: "AMBIGUOUS",
      ambiguityReason: "Conflicting latest observations.",
    });
    const source = repository({ facts: [ambiguousNetIncome, fact()] });

    const snapshot = await prepareResearchEvidenceSnapshot(
      {
        stockId: publicStock.id,
        ticker: publicStock.ticker,
        companyName: publicStock.companyName,
      },
      { repository: source },
    );

    expect(snapshot.stock).toMatchObject({
      ticker: "AAPL",
      cik: "0000320193",
      industry: "Consumer Electronics",
    });
    expect(snapshot.peers.map((peer) => peer.ticker)).toEqual(["DELL", "MSFT"]);
    expect(snapshot.ambiguousMetrics).toContain("NET_INCOME");
    expect(snapshot.missingMetrics).toContain("NET_INCOME");
    const revenue = snapshot.evidence.find(
      (item) => item.metadata.canonicalMetric === "REVENUE",
    );
    expect(revenue).toMatchObject({
      sourceKind: "SEC_FACT",
      accessionNumber: "0000320193-25-000079",
      objectKey: `sec/0000320193/company-facts/${companyFactsHash}.json`,
      sha256: companyFactsHash,
      secFilingId: "filing-2025-10k",
      secRawSourceId: "raw-company-facts",
      secFinancialFactId: "fact-revenue-2025",
    });
    expect(revenue?.metadata).toMatchObject({
      originalValue: "416161000000",
      normalizedValue: "416161000000",
      rawObjectKey: `sec/0000320193/company-facts/${companyFactsHash}.json`,
      rawSha256: companyFactsHash,
      normalizationVersion: "sec-xbrl-v1",
      selection: "SELECTED",
    });
    expect(
      snapshot.evidence.filter((item) => item.sourceKind === "SEC_FACT"),
    ).toHaveLength(1);
    expect(
      snapshot.evidence.map((item) => item.metadata.evidenceType),
    ).toEqual([
      "PUBLIC_COMPANY_IDENTITY",
      "EXPLICIT_MISSING_METRICS",
      "SELECTED_SEC_FACT",
      "FINANCIAL_SUMMARY_TABLE",
      "FINANCIAL_TREND_EXCERPT",
      "PUBLIC_PEER_SET",
      "PEER_COMPARISON_TABLE",
    ]);
    expect(snapshot.sourceDataVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.inputDataVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.sourceSnapshotSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.evidence)).toBe(true);
    expect(Object.isFrozen(snapshot.evidence[0].metadata)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(
      /userId|portfolio|holding|alert|targetPrice/i,
    );
    expect(source.findResearchJobStock).not.toHaveBeenCalled();
    expect(source.listSecFactCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ takePerMetric: 24 }),
    );
    expect(snapshot.evidence.every((item) => item.id.startsWith("ev_"))).toBe(
      true,
    );
  });

  it("produces stable evidence IDs and hashes regardless of repository ordering", async () => {
    const quarterly = fact({
      id: "fact-revenue-quarter",
      externalKey: "revenue-2026-quarter",
      periodStart: new Date("2025-12-28T00:00:00.000Z"),
      periodEnd: new Date("2026-03-28T00:00:00.000Z"),
      periodKind: "QUARTERLY",
      fiscalPeriod: "Q2",
      formType: "10-Q",
      filedAt: new Date("2026-05-01T00:00:00.000Z"),
      accessionNumber: "0000320193-26-000042",
    });
    const left = await prepareResearchEvidenceSnapshot(
      { stockId: "stock-aapl", ticker: "AAPL", companyName: "Apple Inc." },
      {
        repository: repository({
          facts: [fact(), quarterly],
          peerRecords: peers,
        }),
      },
    );
    const right = await prepareResearchEvidenceSnapshot(
      { stockId: "stock-aapl", ticker: "stale", companyName: "Stale name" },
      {
        repository: repository({
          facts: [quarterly, fact()],
          peerRecords: [...peers].reverse(),
        }),
      },
    );

    expect(right.evidence.map((item) => item.id)).toEqual(
      left.evidence.map((item) => item.id),
    );
    expect(right.sourceDataVersion).toBe(left.sourceDataVersion);
    expect(right.inputDataVersion).toBe(left.inputDataVersion);
    expect(right.sourceSnapshotSha256).toBe(left.sourceSnapshotSha256);
  });

  it("uses a persisted job snapshot and refuses live drift for an external job", async () => {
    const prepared = await prepareResearchEvidenceSnapshot(
      { stockId: "stock-aapl", ticker: "AAPL", companyName: "Apple Inc." },
      { repository: repository() },
    );
    const persisted = JSON.parse(JSON.stringify(prepared));
    const persistedRepository = repository({
      job: {
        stockId: "stock-aapl",
        ticker: "AAPL",
        companyName: "Apple Inc.",
        generationMode: "EXTERNAL",
        sourceSnapshotJson: persisted,
      },
    });

    const restored = await buildResearchEvidenceSnapshot("job-1", {
      repository: persistedRepository,
    });

    expect(restored).toEqual(prepared);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(persistedRepository.findPublicStock).not.toHaveBeenCalled();

    const absentRepository = repository({
      job: {
        stockId: "stock-aapl",
        ticker: "AAPL",
        companyName: "Apple Inc.",
        generationMode: "EXTERNAL",
        sourceSnapshotJson: null,
      },
    });
    await expect(
      buildResearchEvidenceSnapshot("job-2", {
        repository: absentRepository,
      }),
    ).resolves.toBeNull();
    expect(absentRepository.findPublicStock).not.toHaveBeenCalled();
  });

  it("rejects a tampered persisted snapshot", async () => {
    const prepared = await prepareResearchEvidenceSnapshot(
      { stockId: "stock-aapl", ticker: "AAPL", companyName: "Apple Inc." },
      { repository: repository() },
    );
    const tampered = JSON.parse(JSON.stringify(prepared));
    tampered.evidence[0].excerpt = "Tampered public identity.";

    await expect(
      buildResearchEvidenceSnapshot("job-tampered", {
        repository: repository({
          job: {
            stockId: "stock-aapl",
            ticker: "AAPL",
            companyName: "Apple Inc.",
            generationMode: "EXTERNAL",
            sourceSnapshotJson: tampered,
          },
        }),
      }),
    ).rejects.toBeInstanceOf(ResearchEvidenceSnapshotError);
  });
});

describe("lexical evidence selection", () => {
  it("applies agent, source, and metadata filters with deterministic ranking", async () => {
    const snapshot = await prepareResearchEvidenceSnapshot(
      { stockId: "stock-aapl", ticker: "AAPL", companyName: "Apple Inc." },
      { repository: repository() },
    );
    const request = {
      query: "annual revenue normalized value",
      agent: "FINANCIALS" as const,
      sourceKinds: ["SEC_FACT" as const],
      metadata: { canonicalMetric: "revenue", periodKind: "annual" },
      contextCharBudget: 260,
    };

    const first = selectEvidence(snapshot, request);
    const second = selectEvidence(snapshot, request);

    expect(second).toEqual(first);
    expect(first.evidence).toHaveLength(1);
    expect(first.evidence[0].metadata.canonicalMetric).toBe("REVENUE");
    expect(first.matches[0].score).toBeGreaterThan(0);
    expect(first.matches[0].matchedTerms).toContain("revenue");
    expect(first.context).toContain(first.evidence[0].id);
    expect(first.contextCharacters).toBe(first.context.length);
    expect(first.contextCharacters).toBeLessThanOrEqual(260);
    expect(first.truncated).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);

    expect(
      selectEvidence(snapshot, {
        query: "revenue",
        agent: "COMPETITORS",
        sourceKinds: ["SEC_FACT"],
      }).evidence,
    ).toEqual([]);
  });

  it("retrieves the public peer set for the competitor agent without private data", async () => {
    const snapshot = await prepareResearchEvidenceSnapshot(
      { stockId: "stock-aapl", ticker: "AAPL", companyName: "Apple Inc." },
      { repository: repository() },
    );
    const result = selectEvidence(snapshot, {
      query: "Dell Microsoft supported public peers",
      agent: "COMPETITORS",
      sourceKinds: ["PEER_SET"],
      contextCharBudget: 2_000,
    });

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ sourceKind: "PEER_SET" });
    expect(result.context).toContain("DELL");
    expect(result.context).toContain("MSFT");
    expect(JSON.stringify(result)).not.toMatch(/portfolio|holding|alert/i);
  });
});

describe("M29 structured-first retrieval", () => {
  const aapl = buildAaplFixtureSnapshot();
  const mandatoryFor = (agent: SpecialistAgentName | "SYNTHESIS") =>
    aapl.evidence.filter(
      (item) =>
        Array.isArray(item.metadata.mandatoryAgentNames) &&
        (item.metadata.mandatoryAgentNames as string[]).includes(agent),
    );

  it.each(["FINANCIALS", "COMPETITORS", "RISK"] as const)(
    "includes every structured item owned by %s in full before lexical fill",
    (agent) => {
      const selection = selectSpecialistEvidence(aapl, agent);
      const mandatory = mandatoryFor(agent);

      expect(mandatory.length).toBeGreaterThan(0);
      expect(selection.mandatoryEvidenceIds).toEqual(
        mandatory.map((item) => item.id),
      );
      expect(selection.evidenceIds.slice(0, mandatory.length)).toEqual(
        mandatory.map((item) => item.id),
      );
      for (const item of mandatory) {
        expect(selection.context).toContain(
          `[${item.id}] ${item.title}\n${item.excerpt}\nSource: ${item.sourceReference}`,
        );
      }
      expect(selection.contextCharacters).toBeLessThanOrEqual(
        AI_SPECIALIST_CONTEXT_CHAR_BUDGET,
      );
      expect(selection.evidence.length).toBeGreaterThan(mandatory.length);
      expect(selection.evidence.length).toBeLessThanOrEqual(
        AI_SPECIALIST_MAX_EVIDENCE_ITEMS,
      );
      for (const item of selection.evidence) {
        if (item.sourceKind !== "DERIVED") continue;
        expect(selection.context).toContain(item.excerpt);
      }
    },
  );

  it("gives financials the summary table, trend excerpt, derived metrics, and the earnings event", () => {
    const types = selectSpecialistEvidence(aapl, "FINANCIALS").evidence.map(
      (item) => item.metadata.evidenceType,
    );
    expect(types).toEqual(
      expect.arrayContaining([
        "FINANCIAL_SUMMARY_TABLE",
        "FINANCIAL_TREND_EXCERPT",
        "DERIVED_METRIC",
        "UPCOMING_EARNINGS_EVENT",
        "EXPLICIT_MISSING_METRICS",
        "SELECTED_SEC_FACT",
      ]),
    );
    const competitors = selectSpecialistEvidence(aapl, "COMPETITORS").evidence;
    expect(competitors.map((item) => item.metadata.evidenceType)).toEqual(
      expect.arrayContaining(["PEER_COMPARISON_TABLE", "PUBLIC_PEER_SET"]),
    );
    expect(competitors.some((item) => item.sourceKind === "SEC_FACT")).toBe(
      false,
    );
  });

  it("forwards the structured tables and the peer comparison to synthesis within budget", () => {
    const selection = selectSynthesisEvidence(aapl);
    const mandatory = mandatoryFor("SYNTHESIS");
    expect(selection.mandatoryEvidenceIds).toEqual(
      mandatory.map((item) => item.id),
    );
    expect(mandatory.map((item) => item.metadata.evidenceType)).toEqual(
      expect.arrayContaining([
        "FINANCIAL_SUMMARY_TABLE",
        "FINANCIAL_TREND_EXCERPT",
        "PEER_COMPARISON_TABLE",
        "UPCOMING_EARNINGS_EVENT",
      ]),
    );
    expect(selection.contextCharacters).toBeLessThanOrEqual(
      AI_SYNTHESIS_CONTEXT_CHAR_BUDGET,
    );
    expect(selection.evidence.length).toBeLessThanOrEqual(
      AI_SYNTHESIS_MAX_EVIDENCE_ITEMS,
    );
  });

  it("uses the remaining budget for lexical fill and never renders a partial derived item", () => {
    const summary = aapl.evidence.find(
      (item) => item.metadata.evidenceType === "FINANCIAL_SUMMARY_TABLE",
    )!;
    const tight = selectEvidence(aapl, {
      query: "revenue growth margin",
      agent: "FINANCIALS",
      contextCharBudget: 5_400,
      maxResults: 40,
    });
    expect(tight.evidenceIds).toContain(summary.id);
    for (const item of tight.evidence) {
      if (item.sourceKind !== "DERIVED") continue;
      if (tight.mandatoryEvidenceIds.includes(item.id)) continue;
      expect(tight.context).toContain(item.excerpt);
    }
    expect(tight.contextCharacters).toBeLessThanOrEqual(5_400);
    expect(tight.truncated).toBe(true);

    const noAgent = selectEvidence(aapl, {
      query: "revenue growth",
      contextCharBudget: 2_000,
    });
    expect(noAgent.mandatoryEvidenceIds).toEqual([]);
    expect(noAgent.evidence.length).toBeGreaterThan(0);
  });

  it("marks a clipped mandatory excerpt instead of truncating it silently", () => {
    const clipped = selectEvidence(aapl, {
      query: "",
      agent: "FINANCIALS",
      contextCharBudget: 6_900,
      maxResults: 40,
    });
    const complete = selectEvidence(aapl, {
      query: "",
      agent: "FINANCIALS",
      contextCharBudget: 32_000,
      maxResults: 40,
    });

    expect(clipped.truncated).toBe(true);
    expect(clipped.contextCharacters).toBeLessThanOrEqual(6_900);
    expect(clipped.context).toContain(
      "[excerpt truncated to fit the context budget]",
    );
    expect(clipped.mandatoryEvidenceIds).toEqual(complete.mandatoryEvidenceIds);
    expect(complete.context).not.toContain("[excerpt truncated");
  });

  it("keeps mandatory items ahead of higher-scoring lexical matches", () => {
    const selection = selectEvidence(aapl, {
      query: "Revenue growth (year over year) annual",
      agent: "RISK",
      contextCharBudget: 8_000,
      maxResults: 12,
    });
    const firstMandatoryCount = selection.mandatoryEvidenceIds.length;
    expect(firstMandatoryCount).toBeGreaterThan(0);
    expect(selection.evidenceIds.slice(0, firstMandatoryCount)).toEqual(
      selection.mandatoryEvidenceIds,
    );
    const scores = selection.matches.map((match) => match.score);
    const fillScores = scores.slice(firstMandatoryCount);
    expect([...fillScores].sort((a, b) => b - a)).toEqual(fillScores);
  });
});
