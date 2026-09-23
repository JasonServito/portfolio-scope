import { describe, expect, it, vi } from "vitest";

import {
  AI_SPECIALIST_CONTEXT_CHAR_BUDGETS,
  AI_SPECIALIST_MAX_EVIDENCE_ITEMS,
  AI_SYNTHESIS_CONTEXT_CHAR_BUDGET,
  AI_SYNTHESIS_MAX_EVIDENCE_ITEMS,
} from "@/lib/research/ai/config";
import {
  AAPL_FIXTURE_CURRENT_REPORTS,
  aaplFixtureCurrentReports,
  aaplFixtureFilingPassages,
  buildAaplFixtureSnapshot,
} from "@/lib/research/ai/fixtures/aapl-evidence-snapshot";
import {
  buildResearchEvidenceSnapshot,
  hasCurrentReportEvidence,
  prepareResearchEvidenceSnapshot,
  ResearchEvidenceSnapshotError,
  selectEvidence,
  selectSpecialistEvidence,
  selectSynthesisEvidence,
  type CurrentReportRecord,
  type FilingPassageRecord,
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
    filingPassages?: FilingPassageRecord[];
    currentReports?: CurrentReportRecord[];
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
    listFilingPassages: vi.fn().mockResolvedValue(input.filingPassages ?? []),
    listCurrentReports: vi.fn().mockResolvedValue(input.currentReports ?? []),
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
      "SEC_CURRENT_REPORT_COVERAGE",
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
        AI_SPECIALIST_CONTEXT_CHAR_BUDGETS[agent],
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

  it("gives financials the summary table, trend excerpt, derived metrics, the earnings event, and an MD&A passage", () => {
    const financials = selectSpecialistEvidence(aapl, "FINANCIALS").evidence;
    expect(financials.map((item) => item.metadata.evidenceType)).toEqual(
      expect.arrayContaining([
        "FINANCIAL_SUMMARY_TABLE",
        "FINANCIAL_TREND_EXCERPT",
        "DERIVED_METRIC",
        "UPCOMING_EARNINGS_EVENT",
        "EXPLICIT_MISSING_METRICS",
        "SEC_FILING_PASSAGE",
      ]),
    );
    expect(
      financials
        .filter((item) => item.sourceKind === "SEC_FILING")
        .map((item) => item.metadata.sectionKind),
    ).toEqual(["MDA"]);
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

describe("M31 filing passage evidence", () => {
  const aapl = buildAaplFixtureSnapshot();
  const passages = aapl.evidence.filter(
    (item) => item.sourceKind === "SEC_FILING",
  );
  const passagesFor = (agent: SpecialistAgentName | "SYNTHESIS") =>
    selectSpecialistEvidence(aapl, agent as SpecialistAgentName).evidence.filter(
      (item) => item.sourceKind === "SEC_FILING",
    );

  it("emits bounded, hash-verifiable passages of the latest 10-K and 10-Q with filing provenance", () => {
    expect(aapl.schemaVersion).toBe("m32-public-evidence-snapshot-v4");
    expect(passages.length).toBeGreaterThan(0);
    const perSection = new Map<string, number[]>();
    for (const item of passages) {
      expect(item).toMatchObject({
        sourceKind: "SEC_FILING",
        secFinancialFactId: null,
      });
      expect(item.sourceUrl).toMatch(
        /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/320193\/\d{18}\/aapl-\d{8}\.htm$/,
      );
      expect(item.accessionNumber).toMatch(/^\d{10}-\d{2}-\d{6}$/);
      expect(item.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(item.objectKey).toMatch(/^sec\/0000320193\/filings\/[a-f0-9]{64}\.htm$/);
      expect(item.passageStart).not.toBeNull();
      expect(item.passageEnd!).toBeGreaterThan(item.passageStart!);
      expect(item.secFilingId).toMatch(/^filing-aapl-10[kq]-fixture$/);
      expect(item.secRawSourceId).toMatch(/^raw-aapl-10[kq]-document-fixture$/);
      expect(item.section).toMatch(/^Item \d+A?\. /);
      expect(item.sourceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.excerpt.length).toBeLessThanOrEqual(1_600);
      expect(item.metadata).toMatchObject({
        evidenceType: "SEC_FILING_PASSAGE",
        parserVersion: "sec-filing-sections-v1",
      });
      const key = `${item.metadata.formType}:${item.metadata.sectionKind}`;
      perSection.set(key, [
        ...(perSection.get(key) ?? []),
        item.metadata.chunkOrdinal as number,
      ]);
    }
    expect([...perSection.keys()].sort()).toEqual([
      "10-K:BUSINESS",
      "10-K:MDA",
      "10-K:RISK_FACTORS",
      "10-Q:MDA",
    ]);
    for (const ordinals of perSection.values()) {
      expect(ordinals.length).toBeLessThanOrEqual(6);
      expect(ordinals).toContain(0);
    }
    expect(aapl.evidence.length).toBeLessThanOrEqual(200);
  });

  it("routes sections to agents: Risk Factors to Risk, Business to Competitors, MD&A to Financials and Risk", () => {
    const agentsFor = (sectionKind: string) =>
      new Set(
        passages
          .filter((item) => item.metadata.sectionKind === sectionKind)
          .flatMap((item) => item.metadata.agentNames as string[]),
      );
    expect(agentsFor("RISK_FACTORS")).toEqual(new Set(["RISK", "SYNTHESIS"]));
    expect(agentsFor("BUSINESS")).toEqual(
      new Set(["COMPETITORS", "FINANCIALS", "SYNTHESIS"]),
    );
    expect(agentsFor("MDA")).toEqual(
      new Set(["FINANCIALS", "RISK", "SYNTHESIS"]),
    );

    for (const agent of ["FINANCIALS", "COMPETITORS", "RISK"] as const) {
      expect(passagesFor(agent).length).toBeGreaterThan(0);
    }
    expect(
      passagesFor("RISK").every((item) =>
        ["RISK_FACTORS", "MDA"].includes(String(item.metadata.sectionKind)),
      ),
    ).toBe(true);
    expect(
      passagesFor("COMPETITORS").every(
        (item) => item.metadata.sectionKind === "BUSINESS",
      ),
    ).toBe(true);
    expect(
      selectEvidence(aapl, {
        query: "competition products markets",
        agent: "RISK",
        sourceKinds: ["SEC_FILING"],
        metadata: { sectionKind: "BUSINESS" },
      }).evidence,
    ).toEqual([]);
  });

  it("keeps the M29 structured evidence first and renders a passage whole or not at all", () => {
    for (const agent of ["FINANCIALS", "COMPETITORS", "RISK"] as const) {
      const selection = selectSpecialistEvidence(aapl, agent);
      const mandatory = aapl.evidence.filter(
        (item) =>
          Array.isArray(item.metadata.mandatoryAgentNames) &&
          (item.metadata.mandatoryAgentNames as string[]).includes(agent),
      );
      expect(selection.evidenceIds.slice(0, mandatory.length)).toEqual(
        mandatory.map((item) => item.id),
      );
      for (const item of selection.evidence) {
        if (item.sourceKind !== "SEC_FILING") continue;
        expect(selection.context).toContain(item.excerpt);
      }
      expect(selection.contextCharacters).toBeLessThanOrEqual(
        AI_SPECIALIST_CONTEXT_CHAR_BUDGETS[agent],
      );
    }
    const tight = selectEvidence(aapl, {
      query: "regulatory legal risk",
      agent: "RISK",
      sourceKinds: ["SEC_FILING"],
      contextCharBudget: 500,
    });
    expect(tight.evidence).toEqual([]);
    expect(tight.omittedEvidenceCount).toBeGreaterThan(0);
    expect(tight.context).not.toContain("[excerpt truncated");
  });

  it("includes evidence the specialists cited, passages first, right after the synthesis mandatory items", () => {
    const riskPassage = passagesFor("RISK")[0];
    const summary = aapl.evidence.find(
      (item) => item.metadata.evidenceType === "FINANCIAL_SUMMARY_TABLE",
    )!;
    const currentRatio = aapl.evidence.find(
      (item) =>
        item.metadata.evidenceType === "DERIVED_METRIC" &&
        item.metadata.metricId === "CURRENT_RATIO",
    )!;
    const claim = (evidenceIds: string[], confidence: number) => ({
      category: "RISK" as const,
      kind: "FACT" as const,
      statement: "A claim.",
      confidence,
      evidenceIds,
      counterEvidenceIds: [],
      assumptions: [],
    });
    const selection = selectSynthesisEvidence(aapl, {
      specialistClaims: [
        claim([currentRatio.id, summary.id], 0.9),
        claim([riskPassage.id], 0.6),
      ],
    });
    const mandatoryCount = selection.mandatoryEvidenceIds.length;
    expect(mandatoryCount).toBeGreaterThan(0);
    expect(selection.mandatoryEvidenceIds).toContain(summary.id);
    expect(selection.evidenceIds[mandatoryCount]).toBe(riskPassage.id);
    expect(selection.evidenceIds).toContain(currentRatio.id);
    expect(selection.context).toContain(riskPassage.excerpt);
    expect(selection.contextCharacters).toBeLessThanOrEqual(
      AI_SYNTHESIS_CONTEXT_CHAR_BUDGET,
    );

    const withoutClaims = selectSynthesisEvidence(aapl);
    expect(withoutClaims.evidenceIds).not.toContain(riskPassage.id);
  });

  it("is deterministic regardless of passage ordering and skips unknown sections", () => {
    const records = aaplFixtureFilingPassages();
    const reordered = buildAaplFixtureSnapshot({
      filingPassages: [...records].reverse(),
    });
    expect(reordered.evidence.map((item) => item.id)).toEqual(
      aapl.evidence.map((item) => item.id),
    );
    expect(reordered.sourceSnapshotSha256).toBe(aapl.sourceSnapshotSha256);

    const unknown = buildAaplFixtureSnapshot({
      filingPassages: records.map((record) => ({
        ...record,
        sectionKind: "EXHIBITS",
      })),
    });
    expect(
      unknown.evidence.some((item) => item.sourceKind === "SEC_FILING"),
    ).toBe(false);
  });

  it("caps a long section to its opening passage plus the best matches for the owning agents' questions", () => {
    const base = aaplFixtureFilingPassages().find(
      (record) => record.sectionKind === "RISK_FACTORS",
    )!;
    const filler =
      "The Company describes general matters in this paragraph of the filing without any specific topic. ".repeat(
        4,
      );
    const regulatory =
      "Regulatory and legal matters: antitrust litigation, government regulation, and political trade tariff disputes may affect the Company. ".repeat(
        3,
      );
    const many = Array.from({ length: 12 }, (_, ordinal) => ({
      ...base,
      id: `${base.filingId}-synthetic-${ordinal}`,
      ordinal,
      passageStart: ordinal * 1_000,
      passageEnd: ordinal * 1_000 + 500,
      text: ordinal === 9 ? regulatory : `${filler}${ordinal}`,
      sha256: ordinal.toString(16).padStart(64, "0"),
    }));
    const snapshot = buildAaplFixtureSnapshot({ filingPassages: many });
    const ordinals = snapshot.evidence
      .filter((item) => item.sourceKind === "SEC_FILING")
      .map((item) => item.metadata.chunkOrdinal as number);

    expect(ordinals).toHaveLength(6);
    expect(ordinals[0]).toBe(0);
    expect(ordinals).toContain(9);
  });

  it("reads passages through the repository and threads them into the prepared snapshot", async () => {
    const source = repository({ filingPassages: aaplFixtureFilingPassages() });
    const snapshot = await prepareResearchEvidenceSnapshot(
      { stockId: publicStock.id, ticker: "AAPL", companyName: "Apple Inc." },
      { repository: source },
    );

    expect(source.listFilingPassages).toHaveBeenCalledWith({
      secEntityId: "sec-apple",
    });
    const passageEvidence = snapshot.evidence.filter(
      (item) => item.sourceKind === "SEC_FILING",
    );
    expect(passageEvidence.length).toBeGreaterThan(0);
    expect(passageEvidence.map((item) => item.id)).toEqual(
      passages.map((item) => item.id),
    );
    expect(JSON.stringify(snapshot)).not.toMatch(/userId|targetPrice|costBasis/i);
  });
});

describe("M32 current-report event evidence", () => {
  const reports = aaplFixtureCurrentReports();
  const withReports = buildAaplFixtureSnapshot({ currentReports: reports });
  const without = buildAaplFixtureSnapshot();
  const events = withReports.evidence.filter(
    (item) => item.metadata.evidenceType === "SEC_CURRENT_REPORT",
  );
  const coverage = withReports.evidence.find(
    (item) => item.metadata.evidenceType === "SEC_CURRENT_REPORT_COVERAGE",
  )!;
  const pressPassages = withReports.evidence.filter(
    (item) => item.metadata.sectionKind === "PRESS_RELEASE",
  );

  it("emits one dated SEC_FILING item per current report, newest first, citing the filing index page", () => {
    expect(withReports.schemaVersion).toBe("m32-public-evidence-snapshot-v4");
    expect(hasCurrentReportEvidence(withReports)).toBe(true);
    expect(events.map((item) => item.metadata.accessionNumber)).toEqual([
      AAPL_FIXTURE_CURRENT_REPORTS.results.accessionNumber,
      AAPL_FIXTURE_CURRENT_REPORTS.resultsWithoutExhibit.accessionNumber,
      AAPL_FIXTURE_CURRENT_REPORTS.shareholderVote.accessionNumber,
    ]);
    const results = events[0];
    expect(results).toMatchObject({
      sourceKind: "SEC_FILING",
      accessionNumber: "0000320193-26-000019",
      section: "Items 2.02, 9.01",
      sourceDate: "2026-07-30",
      secFilingId: "filing-aapl-8k-results-fixture",
      passageStart: null,
      passageEnd: null,
      sha256: null,
    });
    expect(results.sourceUrl).toBe(
      "https://www.sec.gov/Archives/edgar/data/320193/000032019326000019/0000320193-26-000019-index.html",
    );
    expect(results.excerpt).toContain("Form 8-K filed 2026-07-30. Items:");
    expect(events[2].excerpt).toContain(
      "Form 8-K filed 2026-02-26 for events dated 2026-02-24.",
    );
    expect(results.excerpt).toContain(
      "2.02 (Results of Operations and Financial Condition)",
    );
    expect(results.excerpt).toMatch(/Exhibit 99\.1 press release: \d+ passages supplied/);
    expect(results.metadata).toMatchObject({
      formType: "8-K",
      itemCodes: ["2.02", "9.01"],
      exhibitState: "EXTRACTED",
      agentNames: ["NEWS", "SYNTHESIS"],
      mandatoryAgentNames: ["NEWS"],
    });
    expect(events[1].metadata).toMatchObject({
      exhibitState: "NOT_EXTRACTED",
      exhibitErrorCode: "SEC_FILING_EXHIBIT_NOT_FOUND",
      exhibitPassagesSupplied: 0,
    });
    expect(events[1].excerpt).toContain(
      "not available (the filing index lists no press-release exhibit)",
    );
    expect(events[1].excerpt).not.toContain("SEC_FILING_EXHIBIT_NOT_FOUND");
    expect(events[2].metadata).toMatchObject({
      itemCodes: ["5.07"],
      exhibitState: "NOT_EXPECTED",
    });
    expect(events[2].excerpt).toContain("No press-release exhibit is expected");
    expect(JSON.stringify(withReports)).not.toMatch(/userId|targetPrice|costBasis/i);
  });

  it("chunks the press release into hash-verifiable passages routed to News and synthesis", () => {
    expect(pressPassages.length).toBeGreaterThan(0);
    expect(pressPassages.length).toBeLessThanOrEqual(6);
    for (const passage of pressPassages) {
      expect(passage).toMatchObject({
        sourceKind: "SEC_FILING",
        accessionNumber: "0000320193-26-000019",
        section: "Exhibit 99.1 Press Release",
        sourceDate: "2026-07-30",
        secFilingId: "filing-aapl-8k-results-fixture",
        secRawSourceId: "raw-aapl-8k-exhibit-fixture",
      });
      expect(passage.sourceUrl).toMatch(
        /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/320193\/000032019326000019\/a8-kex991q3202606272026\.htm$/,
      );
      expect(passage.metadata).toMatchObject({
        evidenceType: "SEC_FILING_PASSAGE",
        formType: "8-K",
        itemCodes: ["2.02", "9.01"],
        agentNames: ["NEWS", "SYNTHESIS"],
      });
      expect(passage.title).toContain("8-K Exhibit 99.1 Press Release (filed 2026-07-30)");
    }
    expect(pressPassages.some((item) => item.metadata.chunkOrdinal === 0)).toBe(true);
    expect(events[0].metadata.exhibitPassagesSupplied).toBe(pressPassages.length);
    // The exhibit's passages come only from a listed results filing.
    expect(
      withReports.evidence.filter(
        (item) => item.secFilingId === "filing-aapl-8k-results-pending-fixture",
      ),
    ).toHaveLength(1);
  });

  it("states the window coverage explicitly, including when no current report is stored", () => {
    expect(coverage).toMatchObject({
      sourceKind: "DETERMINISTIC",
      section: "Recent events policy",
      metadata: {
        agentNames: ["NEWS"],
        mandatoryAgentNames: ["NEWS"],
        reportCount: 3,
        listedCount: 3,
        resultsFilings: 2,
        resultsFilingsExtracted: 1,
        newestFilingDate: "2026-07-30",
      },
    });
    expect(coverage.excerpt).toContain("3 Form 8-K current reports");
    expect(coverage.excerpt).toContain("nothing after the newest filing date is known");

    expect(hasCurrentReportEvidence(without)).toBe(false);
    const none = without.evidence.find(
      (item) => item.metadata.evidenceType === "SEC_CURRENT_REPORT_COVERAGE",
    )!;
    expect(none.excerpt).toContain("No Form 8-K current report");
    expect(none.metadata.reportCount).toBe(0);
    expect(
      without.evidence.filter((item) => item.metadata.formType === "8-K"),
    ).toEqual([]);
  });

  it("keeps the M29 and M31 evidence in place ahead of the current-report items", () => {
    const types = withReports.evidence.map((item) => item.metadata.evidenceType);
    const firstEvent = types.indexOf("SEC_CURRENT_REPORT_COVERAGE");
    expect(firstEvent).toBeGreaterThan(types.indexOf("PEER_COMPARISON_TABLE"));
    expect(firstEvent).toBeGreaterThan(types.indexOf("UPCOMING_EARNINGS_EVENT"));
    expect(firstEvent).toBeLessThan(types.indexOf("SEC_FILING_PASSAGE"));
    const periodic = (snapshot: typeof withReports) =>
      snapshot.evidence.filter(
        (item) =>
          item.metadata.evidenceType !== "SEC_CURRENT_REPORT" &&
          item.metadata.evidenceType !== "SEC_CURRENT_REPORT_COVERAGE" &&
          item.metadata.sectionKind !== "PRESS_RELEASE",
      );
    expect(periodic(withReports).map((item) => item.id)).toEqual(
      periodic(without).map((item) => item.id),
    );
    expect(withReports.evidence.length).toBeLessThanOrEqual(200);
  });

  it("gives News every listed report first, then press-release passages, and nothing from the periodic filings", () => {
    const selection = selectSpecialistEvidence(withReports, "NEWS");
    const types = selection.evidence.map((item) => item.metadata.evidenceType);
    expect(selection.mandatoryEvidenceIds).toEqual(
      expect.arrayContaining([coverage.id, ...events.map((item) => item.id)]),
    );
    expect(types.slice(0, 1 + events.length)).toEqual(
      expect.arrayContaining(["SEC_CURRENT_REPORT_COVERAGE", "SEC_CURRENT_REPORT"]),
    );
    expect(
      selection.evidence.some(
        (item) => item.metadata.sectionKind === "PRESS_RELEASE",
      ),
    ).toBe(true);
    expect(
      selection.evidence.every(
        (item) =>
          item.metadata.evidenceType !== "SEC_FILING_PASSAGE" ||
          item.metadata.sectionKind === "PRESS_RELEASE",
      ),
    ).toBe(true);
    expect(selection.contextCharacters).toBeLessThanOrEqual(
      AI_SPECIALIST_CONTEXT_CHAR_BUDGETS.NEWS,
    );
    for (const agent of ["FINANCIALS", "COMPETITORS", "RISK"] as const) {
      const other = selectSpecialistEvidence(withReports, agent);
      expect(
        other.evidence.some(
          (item) =>
            item.metadata.evidenceType === "SEC_CURRENT_REPORT" ||
            item.metadata.sectionKind === "PRESS_RELEASE",
        ),
      ).toBe(false);
    }
  });

  it("is deterministic regardless of report ordering, lists at most four reports, and always keeps the newest results filing", () => {
    const reversed = buildAaplFixtureSnapshot({
      currentReports: [...reports].reverse(),
    });
    expect(reversed.sourceSnapshotSha256).toBe(withReports.sourceSnapshotSha256);

    // Seven later 8-Ks about other items would push the results filing (and
    // its press release) out of the four newest.
    const many = Array.from({ length: 7 }, (_, index) => ({
      ...reports[2],
      id: `filing-many-${index}`,
      accessionNumber: `0000320193-26-0001${String(index).padStart(2, "0")}`,
      filingDate: new Date(Date.UTC(2026, 7, 1 + index)),
      reportDate: new Date(Date.UTC(2026, 7, 1 + index)),
    }));
    const crowded = buildAaplFixtureSnapshot({ currentReports: [...many, reports[0]] });
    const listed = crowded.evidence.filter(
      (item) => item.metadata.evidenceType === "SEC_CURRENT_REPORT",
    );
    expect(listed).toHaveLength(4);
    expect(listed.map((item) => item.metadata.accessionNumber)).toEqual([
      many[6].accessionNumber,
      many[5].accessionNumber,
      many[4].accessionNumber,
      reports[0].accessionNumber,
    ]);
    expect(
      crowded.evidence.filter((item) => item.metadata.sectionKind === "PRESS_RELEASE")
        .length,
    ).toBeGreaterThan(0);
    expect(
      crowded.evidence.find(
        (item) => item.metadata.evidenceType === "SEC_CURRENT_REPORT_COVERAGE",
      )!.excerpt,
    ).toContain("The 4 most recent are listed");
  });

  it("reads current reports through the repository for the twelve-month window and threads them into the prepared snapshot", async () => {
    const source = repository({ currentReports: reports });
    const now = () => new Date("2026-09-22T12:00:00.000Z");
    const prepared = await prepareResearchEvidenceSnapshot(
      { stockId: publicStock.id, ticker: "AAPL", companyName: "Apple Inc." },
      { repository: source, now },
    );

    expect(source.listCurrentReports).toHaveBeenCalledWith({
      secEntityId: "sec-apple",
      filedOnOrAfter: new Date("2025-09-22T00:00:00.000Z"),
    });
    expect(
      prepared.evidence.filter(
        (item) => item.metadata.evidenceType === "SEC_CURRENT_REPORT",
      ),
    ).toHaveLength(3);
  });
});
