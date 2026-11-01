import { describe, expect, it } from "vitest";

import {
  boundSpecialistOutputs,
  SPECIALIST_RESEARCH_QUESTIONS,
  specialistPrompt,
  synthesisPrompt,
  synthesisSpecialistView,
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

const notAvailableNews: SpecialistModelOutput = {
  rating: "NEUTRAL",
  confidence: 0,
  availability: "NOT_AVAILABLE",
  summary: "Licensed current-news evidence is not configured.",
  claims: [],
  warnings: [],
  missingData: ["Licensed current-news evidence is not configured."],
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
    expect(prompt.instructions).toContain(
      "Evidence of kind SEC_FILING is a passage from the company's own 10-K or 10-Q",
    );
    expect(prompt.instructions).toContain("including Risk Factors and MD&A passages");
    expect(prompt.input).toContain(evidence.id);
    expect(prompt.input).not.toMatch(/portfolioWeight|activeAlerts|userId/);
  });

  it.each([
    ["FINANCIALS", 6],
    ["COMPETITORS", 5],
    ["RISK", 6],
    ["NEWS", 5],
  ] as const)(
    "poses the %s specialist's bounded research questions and contract",
    (agentName, questionCount) => {
      const prompt = specialistPrompt({
        agentName,
        ticker: "AAPL",
        companyName: "Apple Inc.",
        asOfDate: "2026-01-02",
        evidence: [evidence],
      });
      const input = JSON.parse(prompt.input) as {
        researchQuestions: string[];
      };

      expect(input.researchQuestions).toEqual(
        SPECIALIST_RESEARCH_QUESTIONS[agentName],
      );
      expect(input.researchQuestions).toHaveLength(questionCount);
      expect(prompt.instructions).toContain(
        "Each claim should answer a question rather than restate an evidence excerpt",
      );
      expect(prompt.instructions).toContain(
        "NOT_AVAILABLE requires zero claims and a NEUTRAL rating",
      );
      expect(prompt.instructions).toContain("Label every claim with a kind");
      expect(prompt.instructions).toContain(
        "a runtime check rejects any number absent from the cited excerpts",
      );
    },
  );

  it("routes regulatory, governance, and political exposure to Risk as an evidence-gated question", () => {
    expect(SPECIALIST_RESEARCH_QUESTIONS.RISK.at(-1)).toMatch(
      /Regulatory, governance, and political exposure: answer only if supplied evidence/,
    );
    expect(SPECIALIST_RESEARCH_QUESTIONS.NEWS.at(-1)).toContain("NOT_AVAILABLE");
  });

  it("asks the News specialist for a structured extraction per Form 8-K event and forbids uncited events", () => {
    const questions = SPECIALIST_RESEARCH_QUESTIONS.NEWS.join(" ");
    for (const part of [
      "what was reported",
      "What changed",
      "Why may each event matter",
      "How strong is the evidence",
      "What remains unknown",
    ]) {
      expect(questions).toContain(part);
    }
    const prompt = specialistPrompt({
      agentName: "NEWS",
      ticker: "AAPL",
      companyName: "Apple Inc.",
      asOfDate: "2026-01-02",
      evidence: [evidence],
    });
    expect(prompt.instructions).toContain("Form 8-K current reports");
    expect(prompt.instructions).toContain(
      "Never describe an event that no supplied 8-K reports",
    );
    expect(prompt.instructions).toContain("never use third-party news");
    expect(prompt.instructions).toContain(
      "the cover items of a Form 8-K current report",
    );
    const synthesis = synthesisPrompt({
      ticker: "AAPL",
      companyName: "Apple Inc.",
      asOfDate: "2026-01-02",
      evidence: [evidence],
      specialists: [],
    });
    expect(synthesis.instructions).toContain(
      "never describe an event without such a citation",
    );
  });

  it("forwards a NOT_AVAILABLE specialist to synthesis as a gap, never as a neutral opinion", () => {
    const prompt = synthesisPrompt({
      ticker: "AAPL",
      companyName: "Apple Inc.",
      asOfDate: "2026-01-02",
      evidence: [evidence],
      specialists: [{ agentName: "NEWS", output: notAvailableNews }],
    });
    const input = JSON.parse(prompt.input) as {
      specialists: Array<Record<string, unknown>>;
    };

    expect(input.specialists).toHaveLength(1);
    expect(input.specialists[0]).toEqual({
      agentName: "NEWS",
      availability: "NOT_AVAILABLE",
      summary: notAvailableNews.summary,
      claims: [],
      warnings: [],
      missingData: notAvailableNews.missingData,
    });
    expect(input.specialists[0]).not.toHaveProperty("rating");
    expect(input.specialists[0]).not.toHaveProperty("confidence");
    expect(prompt.instructions).toContain(
      "not the specialists' opinions",
    );
    expect(prompt.instructions).toContain("never treat it as a neutral view");
    expect(prompt.instructions).toContain(
      "Evidence of kind SEC_FILING is a passage from the company's own 10-K or 10-Q",
    );
    expect(prompt.instructions).toContain("whatWouldChange");
    expect(prompt.instructions).toContain("Never personalize an action");
    expect(prompt.instructions).toContain("purchasing, acquiring");
    expect(prompt.instructions).toContain("stock-price target");
    expect(prompt.instructions).toContain("future price or direction");
  });

  it("forwards every validated specialist claim until the payload budget is reached", () => {
    const claim = (confidence: number, statement: string) => ({
      category: "SUPPORTIVE" as const,
      kind: "INTERPRETATION" as const,
      statement,
      confidence,
      evidenceIds: [evidence.id],
      counterEvidenceIds: [],
      assumptions: ["assumption ".repeat(10).trim()],
    });
    const output: SpecialistModelOutput = {
      rating: "NEUTRAL",
      confidence: 0.6,
      availability: "COMPLETE",
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

    // The budget that exactly fits the forwarded view once assumptions are dropped.
    const strippedSize = JSON.stringify(
      specialists.map((specialist) =>
        synthesisSpecialistView({
          ...specialist,
          output: {
            ...specialist.output,
            claims: specialist.output.claims.map((item) => ({
              ...item,
              assumptions: [],
            })),
          },
        }),
      ),
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
    const input = JSON.parse(prompt.input) as {
      omittedSpecialistClaims: number;
      specialists: Array<{ claims: unknown[] }>;
    };
    expect(input.omittedSpecialistClaims).toBe(0);
    expect(input.specialists[0].claims).toHaveLength(3);
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
