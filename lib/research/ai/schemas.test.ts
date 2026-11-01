import { describe, expect, it } from "vitest";

import {
  getModelOutputSafetyIssue,
  ModelOutputConsistencyError,
  ModelOutputSafetyError,
  stableHash,
  validateGroundedOutput,
  type ResearchEvidence,
  type SpecialistModelOutput,
} from "@/lib/research/ai/schemas";

const evidence: ResearchEvidence = {
  id: "ev_0123456789abcdef",
  sourceKind: "SEC_FILING",
  title: "Example filing",
  sourceReference: "sec://example/filing",
  sourceUrl: "https://www.sec.gov/Archives/example.htm",
  accessionNumber: "0000000000-26-000001",
  section: "Management discussion",
  objectKey: "sec/example/filing.htm",
  sha256: "a".repeat(64),
  sourceDate: "2026-01-31",
  retrievedAt: "2026-02-02T12:00:00.000Z",
  excerpt: "Management projected company revenue of $500 billion for FY2028.",
  passageStart: 0,
  passageEnd: 67,
  secFilingId: "filing-example",
  secRawSourceId: "raw-example",
  secFinancialFactId: null,
  metadata: {},
};

function output(
  summary: string,
  overrides: Partial<SpecialistModelOutput> = {},
): SpecialistModelOutput {
  return {
    rating: "NEUTRAL",
    confidence: 0.7,
    availability: "COMPLETE",
    summary,
    claims: [
      {
        category: "SUPPORTIVE",
        kind: "FACT",
        statement:
          "Management projects company revenue could reach $500 billion in FY2028.",
        confidence: 0.7,
        evidenceIds: [evidence.id],
        counterEvidenceIds: [],
        assumptions: [],
      },
    ],
    warnings: [],
    missingData: [],
    ...overrides,
  };
}

const supportedSummary =
  "Management projects company revenue could reach $500 billion in FY2028.";

function claimWith(
  overrides: Partial<SpecialistModelOutput["claims"][number]>,
) {
  return { ...output(supportedSummary).claims[0], ...overrides };
}

describe("stableHash", () => {
  it("is stable when JSON object keys are reordered at any depth", () => {
    const first = {
      evidence: [{ metadata: { period: "FY2025", metric: "REVENUE" } }],
      stock: { ticker: "AAPL", exchange: "NASDAQ" },
    };
    const reordered = {
      stock: { exchange: "NASDAQ", ticker: "AAPL" },
      evidence: [{ metadata: { metric: "REVENUE", period: "FY2025" } }],
    };

    expect(stableHash(first)).toBe(stableHash(reordered));
  });

  it("continues to treat array order as material", () => {
    expect(stableHash({ evidenceIds: ["a", "b"] })).not.toBe(
      stableHash({ evidenceIds: ["b", "a"] }),
    );
  });
});

describe("model output safety", () => {
  it.each([
    "Buy the shares while the valuation is attractive.",
    "AAPL is a buy.",
    "You should purchase shares now.",
    "You should\npurchase shares.",
    "You could buy shares.",
    "Place a limit order to acquire shares.",
    "Consider purchasing shares.",
    "It may be wise to purchase shares.",
    "Buying shares appears attractive.",
    "Investors should acquire shares.",
    "Dispose of the shares.",
    "Exit the position.",
    "Add to this holding.",
    "Trim the exposure.",
    "Avoid the stock.",
    "Allocate 10% of your portfolio to this stock.",
    "The target price is $250 per share.",
    "Fair value is $250 per share.",
    "The stock price could reach $250 next year.",
    "AAPL will reach 250 dollars next year.",
    "The price will rise next quarter.",
    "AAPL price will rise.",
  ])("rejects prohibited investment guidance: %s", (summary) => {
    expect(() => validateGroundedOutput(output(summary), [evidence])).toThrow(
      ModelOutputSafetyError,
    );
  });

  it.each([
    "Management projects company revenue could reach $500 billion in FY2028.",
    "Management projects EPS could reach $10 per share.",
    "Free cash flow per share could reach $12 next year.",
    "The stock price rose from $100 to $125 last year.",
    "AAPL reached 250 dollars in the prior fiscal year.",
    "The source reported insider buying and selling during 2025.",
    "The filing states the company may sell non-core assets.",
    "The board will hold its annual meeting in May.",
    "AAPL will reach $500 billion in revenue in FY2028.",
    "Outstanding shares will increase after the announced issuance.",
  ])(
    "allows financial projections and historical source facts: %s",
    (summary) => {
      expect(validateGroundedOutput(output(summary), [evidence])).toMatchObject(
        { rating: "NEUTRAL" },
      );
    },
  );

  it("walks cyclic output objects without bypassing unsafe string leaves", () => {
    const cyclic: { summary: string; self?: unknown } = {
      summary: "You should\npurchase shares.",
    };
    cyclic.self = cyclic;

    expect(getModelOutputSafetyIssue(cyclic)).toMatch(/investment action/i);
  });
});

describe("model output consistency gate", () => {
  const derivedEvidence: ResearchEvidence = {
    ...evidence,
    id: "ev_1111111111111111",
    sourceKind: "DERIVED",
    title: "Derived margin",
    sourceReference: "derived-metric:example:OPERATING_MARGIN",
    excerpt: "Operating margin, annual period ending 2028-12-31: 31.5 percent.",
  };

  it("rejects a number absent from the cited supporting excerpts", () => {
    const wrongValue = output(supportedSummary, {
      claims: [
        claimWith({
          statement: "Management projects revenue could reach $600 billion in FY2028.",
        }),
      ],
    });
    const wrongUnit = output(supportedSummary, {
      claims: [
        claimWith({
          statement: "Management projects revenue could reach $500 million in FY2028.",
        }),
      ],
    });
    // The number appears only in counter-evidence, not in supporting evidence.
    const counterOnly = output(supportedSummary, {
      claims: [
        claimWith({
          kind: "DERIVED",
          statement: "Operating margin was 31.5 percent in FY2028.",
          evidenceIds: [evidence.id],
          counterEvidenceIds: [derivedEvidence.id],
        }),
      ],
    });

    for (const candidate of [wrongValue, wrongUnit, counterOnly]) {
      expect(() =>
        validateGroundedOutput(candidate, [evidence, derivedEvidence]),
      ).toThrow(ModelOutputConsistencyError);
    }
    expect(() =>
      validateGroundedOutput(
        output(supportedSummary, {
          claims: [
            claimWith({
              kind: "DERIVED",
              statement: "Derived operating margin was 31.5 percent in FY2028.",
              evidenceIds: [derivedEvidence.id],
            }),
          ],
        }),
        [evidence, derivedEvidence],
      ),
    ).not.toThrow();
  });

  it("rejects a rating that contradicts the claim categories", () => {
    const risk = claimWith({ category: "RISK" });
    const supportive = claimWith({
      statement: "Management projects revenue could reach $500 billion in FY2028 on new products.",
    });

    expect(() =>
      validateGroundedOutput(
        output(supportedSummary, { rating: "BULLISH", claims: [risk] }),
        [evidence],
      ),
    ).toThrow(/BULLISH rating does not agree/);
    expect(() =>
      validateGroundedOutput(
        output(supportedSummary, { rating: "BEARISH", claims: [supportive] }),
        [evidence],
      ),
    ).toThrow(ModelOutputConsistencyError);
    expect(() =>
      validateGroundedOutput(
        output(supportedSummary, { rating: "MIXED", claims: [supportive] }),
        [evidence],
      ),
    ).toThrow(ModelOutputConsistencyError);
    expect(() =>
      validateGroundedOutput(
        output(supportedSummary, {
          rating: "MIXED",
          claims: [supportive, risk],
        }),
        [evidence],
      ),
    ).not.toThrow();
    expect(() =>
      validateGroundedOutput(
        output(supportedSummary, { rating: "BULLISH", claims: [supportive] }),
        [evidence],
      ),
    ).not.toThrow();
  });

  it("keeps availability and claims in agreement", () => {
    expect(() =>
      validateGroundedOutput(
        output(supportedSummary, { availability: "NOT_AVAILABLE" }),
        [evidence],
      ),
    ).toThrow(/NOT_AVAILABLE specialist must not return claims/);
    expect(() =>
      validateGroundedOutput(
        output(supportedSummary, { availability: "COMPLETE", claims: [] }),
        [evidence],
      ),
    ).toThrow(/must report NOT_AVAILABLE/);
    expect(() =>
      validateGroundedOutput(
        output("No licensed evidence is supplied.", {
          availability: "NOT_AVAILABLE",
          claims: [],
        }),
        [evidence],
      ),
    ).not.toThrow();
  });

  it("requires a DERIVED claim to cite a derived evidence item", () => {
    expect(() =>
      validateGroundedOutput(
        output(supportedSummary, { claims: [claimWith({ kind: "DERIVED" })] }),
        [evidence, derivedEvidence],
      ),
    ).toThrow(/labeled DERIVED does not cite a derived evidence item/);
  });
});
