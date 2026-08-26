import { describe, expect, it } from "vitest";

import {
  getModelOutputSafetyIssue,
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

function output(summary: string): SpecialistModelOutput {
  return {
    rating: "MIXED",
    confidence: 0.7,
    summary,
    claims: [
      {
        category: "SUPPORTIVE",
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
  };
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
        { rating: "MIXED" },
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
