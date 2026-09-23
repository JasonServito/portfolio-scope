import { describe, expect, it } from "vitest";

import {
  boundSpecialistOutputs,
  specialistPrompt,
  synthesisPrompt,
} from "./prompts";
import type { ResearchEvidence, SpecialistModelOutput } from "./schemas";

const evidence: ResearchEvidence = {
  id: "ev_0123456789abcdef",
  sourceKind: "SEC_FACT",
  title: "Revenue",
  sourceReference: "sec://fact/revenue",
  sourceUrl: "https://www.sec.gov/example",
  accessionNumber: "0000000000-26-000001",
  section: "Revenue · FY2025",
  objectKey: "sec/0000000000/company-facts/hash.json",
  sha256: "a".repeat(64),
  sourceDate: "2025-12-31",
  retrievedAt: "2026-01-02T00:00:00.000Z",
  excerpt: "Revenue was reported as USD 100 for FY2025.",
  passageStart: 0,
  passageEnd: 45,
  secFilingId: "filing-a",
  secRawSourceId: "raw-a",
  secFinancialFactId: "fact-a",
  metadata: {},
};

describe("AI research prompts", () => {
  it("contains only bounded public evidence and explicit safety rules", () => {
    const prompt = specialistPrompt({
      agentName: "RISK",
      ticker: "AAPL",
      companyName: "Apple Inc.",
      asOfDate: "2026-01-02",
      evidence: [evidence],
    });

    expect(prompt.instructions).toContain("Use only the supplied evidence");
    expect(prompt.instructions).toContain("Never personalize an action");
    expect(prompt.instructions).toContain("purchasing, acquiring");
    expect(prompt.instructions).toContain("stock-price target");
    expect(prompt.instructions).toContain("future price or direction");
    expect(prompt.input).toContain(evidence.id);
    expect(prompt.input).not.toMatch(/portfolioWeight|activeAlerts|userId/);
  });

  it("applies the explicit action and stock-price prohibitions to synthesis", () => {
    const prompt = synthesisPrompt({
      ticker: "AAPL",
      companyName: "Apple Inc.",
      asOfDate: "2026-01-02",
      evidence: [evidence],
      specialists: [],
    });

    expect(prompt.instructions).toContain("Never personalize an action");
    expect(prompt.instructions).toContain("purchasing, acquiring");
    expect(prompt.instructions).toContain("stock-price target");
    expect(prompt.instructions).toContain("future price or direction");
  });

  it("forwards every validated specialist claim until the payload budget is reached", () => {
    const claim = (confidence: number, statement: string) => ({
      category: "SUPPORTIVE" as const,
      statement,
      confidence,
      evidenceIds: [evidence.id],
      counterEvidenceIds: [],
      assumptions: ["assumption ".repeat(10).trim()],
    });
    const output: SpecialistModelOutput = {
      rating: "NEUTRAL",
      confidence: 0.6,
      summary: "Summary.",
      claims: [
        claim(0.9, "High confidence claim."),
        claim(0.4, "Lowest confidence claim."),
        claim(0.7, "Middle confidence claim."),
      ],
      warnings: [],
      missingData: [],
    };
    const specialists = [{ agentName: "FINANCIALS" as const, output }];

    const unbounded = boundSpecialistOutputs(specialists, 10_000);
    expect(unbounded.omittedClaims).toBe(0);
    expect(unbounded.specialists[0].output.claims).toHaveLength(3);
    expect(unbounded.specialists[0].output.claims[0].assumptions).toHaveLength(1);

    // The budget that exactly fits the claims once assumptions are dropped.
    const strippedSize = JSON.stringify(
      specialists.map((specialist) => ({
        ...specialist,
        output: {
          ...specialist.output,
          claims: specialist.output.claims.map((item) => ({
            ...item,
            assumptions: [],
          })),
        },
      })),
    ).length;
    const withoutAssumptions = boundSpecialistOutputs(specialists, strippedSize);
    expect(withoutAssumptions.omittedClaims).toBe(0);
    expect(withoutAssumptions.specialists[0].output.claims).toHaveLength(3);
    expect(
      withoutAssumptions.specialists[0].output.claims.every(
        (item) => item.assumptions.length === 0,
      ),
    ).toBe(true);

    const trimmed = boundSpecialistOutputs(specialists, strippedSize - 1);
    expect(trimmed.omittedClaims).toBe(1);
    expect(
      trimmed.specialists[0].output.claims.map((item) => item.statement),
    ).toEqual(["High confidence claim.", "Middle confidence claim."]);

    const prompt = synthesisPrompt({
      ticker: "AAPL",
      companyName: "Apple Inc.",
      asOfDate: "2026-01-02",
      evidence: [evidence],
      specialists,
    });
    expect(JSON.parse(prompt.input).omittedSpecialistClaims).toBe(0);
    expect(JSON.parse(prompt.input).specialists[0].output.claims).toHaveLength(3);
  });

  it("uses the retrieval-bounded context instead of copying full excerpts", () => {
    const boundedContext = `[${evidence.id}] Revenue\nBounded excerpt.`;
    const prompt = specialistPrompt({
      agentName: "FINANCIALS",
      ticker: "AAPL",
      companyName: "Apple Inc.",
      asOfDate: "2026-01-02",
      evidence: [evidence],
      evidenceContext: boundedContext,
    });

    expect(prompt.input).toContain(boundedContext.replace("\n", "\\n"));
    expect(prompt.input).not.toContain(evidence.excerpt);
  });
});
