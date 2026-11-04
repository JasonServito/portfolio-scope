import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { CURATED_RESEARCH_EVIDENCE } from "@/lib/research/ai/fixtures/curated-evaluation";
import { getLatestResearch } from "@/lib/research/orchestrator";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: { researchJob: { findFirst: mocks.findFirst } },
}));

const EM_DASH = String.fromCharCode(0x2014);

const factEvidence = CURATED_RESEARCH_EVIDENCE.find(
  (item) => item.sourceKind === "SEC_FACT" && item.title.includes(EM_DASH),
);

function completedJob(evidence: (typeof CURATED_RESEARCH_EVIDENCE)[number]) {
  const asOf = new Date("2026-09-23T00:00:00.000Z");
  return {
    id: "job_display_titles",
    status: "COMPLETED",
    generationMode: "DETERMINISTIC",
    sourceDataVersion: "fixture",
    sourceSnapshotJson: { evidence: [evidence] },
    stock: { ticker: "AAPL", companyName: "Apple Inc." },
    agentRuns: [
      {
        agentName: "FINANCIALS",
        status: "COMPLETED",
        rating: "NEUTRAL",
        confidence: null,
        availability: null,
        summary: "Financial results are summarized from SEC facts.",
        findingsJson: [],
        sourcesJson: [
          {
            title: evidence.title,
            reference: "sec-fact:not-in-registry",
            detail: evidence.excerpt,
          },
        ],
        warningsJson: [],
        claimsJson: [],
        missingDataJson: [],
        provider: null,
        model: null,
        promptVersion: null,
        outputSchemaVersion: null,
        agentVersion: null,
      },
    ],
    report: {
      rating: "NEUTRAL",
      overview: "Research context, not financial advice.",
      bullCaseJson: [],
      bearCaseJson: [],
      risksJson: [],
      missingDataJson: [],
      disagreementsJson: [],
      whatWouldChangeJson: [],
      verificationCompleted: false,
      confidence: new Prisma.Decimal(0.7),
      evidenceCoverageJson: null,
      reportVersion: "fixture",
      generatedAt: asOf,
      expiresAt: asOf,
      provider: null,
      model: null,
      promptVersion: null,
      outputSchemaVersion: null,
      retrievalVersion: null,
      calculationVersion: null,
      inputDataVersion: null,
      sourceSnapshotSha256: null,
      inputTokens: null,
      outputTokens: null,
      estimatedCostUsd: null,
      claims: [
        {
          id: "claim_display_titles",
          claimKey: "financials-revenue",
          category: "FINANCIALS",
          kind: "FACT",
          verificationStatus: "SUPPORTED",
          verificationEvidenceIdsJson: [],
          statement: "Revenue is reported in the cited SEC fact.",
          confidence: new Prisma.Decimal(0.8),
          assumptionsJson: [],
          sourceDate: null,
          asOfDate: asOf,
          evidence: [
            {
              referenceKey: evidence.id,
              role: "SUPPORTING",
              sourceKind: evidence.sourceKind,
              title: evidence.title,
              sourceReference: evidence.sourceReference,
              sourceUrl: evidence.sourceUrl,
              accessionNumber: evidence.accessionNumber,
              section: evidence.section,
              sourceDate: null,
              retrievedAt: null,
              excerpt: evidence.excerpt,
            },
          ],
        },
      ],
    },
  };
}

describe("research display shaping", () => {
  it("shows evidence titles without em dashes while the stored title keeps them", async () => {
    if (!factEvidence)
      throw new Error("Fixture has no em dash evidence title.");
    mocks.findFirst.mockResolvedValue(completedJob(factEvidence));

    const research = await getLatestResearch("AAPL");
    const titles = [
      ...(research?.evidenceRegistry ?? []).map((item) => item.title),
      ...(research?.claims ?? []).flatMap((claim) =>
        claim.evidence.map((item) => item.title),
      ),
      ...(research?.agents ?? []).flatMap((agent) =>
        agent.sources.map((source) => source.title),
      ),
    ];

    expect(titles).toHaveLength(3);
    expect(new Set(titles)).toEqual(
      new Set([factEvidence.title.replace(` ${EM_DASH} `, ", ")]),
    );
    expect(titles[0]).toBe("Assets, instant period ending 2026-06-27");
    expect(factEvidence.title).toContain(EM_DASH);
  });
});
