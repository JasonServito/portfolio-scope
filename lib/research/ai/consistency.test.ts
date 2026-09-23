import { describe, expect, it } from "vitest";

import {
  availabilityAgreesWithClaims,
  claimMix,
  getOutputConsistencyIssue,
  numericTokens,
  ratingAgreesWithClaims,
  ratingForClaims,
  unsupportedNumericTokens,
} from "@/lib/research/ai/consistency";
import type { ResearchEvidence } from "@/lib/research/ai/schemas";

function evidence(
  id: string,
  excerpt: string,
  sourceKind: ResearchEvidence["sourceKind"] = "SEC_FACT",
): ResearchEvidence {
  return {
    id,
    sourceKind,
    title: "Evidence",
    sourceReference: `test://${id}`,
    sourceUrl: null,
    accessionNumber: null,
    section: null,
    objectKey: null,
    sha256: null,
    sourceDate: null,
    retrievedAt: null,
    excerpt,
    passageStart: null,
    passageEnd: null,
    secFilingId: null,
    secRawSourceId: null,
    secFinancialFactId: null,
    metadata: {},
  };
}

const claim = (
  overrides: Partial<{
    category: "SUPPORTIVE" | "COUNTERPOINT" | "RISK";
    kind: "FACT" | "DERIVED" | "INTERPRETATION";
    statement: string;
    evidenceIds: string[];
  }> = {},
) => ({
  category: "SUPPORTIVE" as const,
  kind: "FACT" as const,
  statement: "Revenue was 391,035,000,000 USD for the period ending 2025-09-27.",
  confidence: 0.8,
  evidenceIds: ["ev_a"],
  counterEvidenceIds: [],
  assumptions: [],
  ...overrides,
});

describe("numeric tokens", () => {
  it("normalizes currency symbols, separators, and unit suffixes", () => {
    expect(numericTokens("$1,500 million and 6.4 percent, or 6.4%")).toEqual(
      new Set(["1500million", "6.4%"]),
    );
    expect(numericTokens("-31,796,000,000 USD at 2026-06-27")).toEqual(
      new Set(["-31796000000", "2026-06-27", "2026"]),
    );
    expect(numericTokens("$5B versus 2bn and 3 tn")).toEqual(
      new Set(["5billion", "2billion", "3trillion"]),
    );
  });

  it("does not read a following word as a unit suffix", () => {
    expect(numericTokens("at 2026-06-27 balance sheet")).toEqual(
      new Set(["2026-06-27", "2026"]),
    );
    expect(numericTokens("2 of the 8 available quarters, 3 major markets")).toEqual(
      new Set(["2", "8", "3"]),
    );
    expect(numericTokens("for 10 k items")).toEqual(new Set(["10thousand"]));
  });

  it("compares dates as whole dates plus their year in either spelling", () => {
    expect(numericTokens("the period ending September 27, 2025")).toEqual(
      new Set(["2025-09-27", "2025"]),
    );
    expect(numericTokens("fiscal 2025 and FY2024 revenue")).toEqual(
      new Set(["2025", "2024"]),
    );
    expect(numericTokens("2024-09-29 through 2025-09-27 (ANNUAL)")).toEqual(
      new Set(["2024-09-29", "2024", "2025-09-27", "2025"]),
    );
  });

  it("ignores form types and quarter labels and reads negative words as a sign", () => {
    expect(numericTokens("the 10-K and 10-Q filings for Q3 and Q4")).toEqual(
      new Set(),
    );
    expect(numericTokens("net cash of negative 31,796,000,000 USD")).toEqual(
      new Set(["-31796000000"]),
    );
    expect(numericTokens("net cash of −31,796,000,000 USD")).toEqual(
      new Set(["-31796000000"]),
    );
  });
});

describe("numeric agreement with cited excerpts", () => {
  const supporting = evidence(
    "ev_a",
    "Revenue (REVENUE) was reported as 391035000000 USD. Normalized value: 391,035,000,000 USD. Reporting period: 2024-09-29 through 2025-09-27 (ANNUAL).",
  );
  const other = evidence("ev_b", "Net income was 93,736,000,000 USD.");

  it("accepts numbers present in any cited supporting excerpt", () => {
    const byId = new Map([
      [supporting.id, supporting],
      [other.id, other],
    ]);
    expect(unsupportedNumericTokens(claim(), byId)).toEqual([]);
    expect(
      unsupportedNumericTokens(
        claim({
          statement:
            "Revenue was 391,035,000,000 USD for fiscal 2025, the year ended September 27, 2025, per the 10-K.",
        }),
        byId,
      ),
    ).toEqual([]);
    expect(
      unsupportedNumericTokens(
        claim({
          statement: "Revenue of 391,035,000,000 USD compares with net income of 93,736,000,000 USD.",
          evidenceIds: ["ev_a", "ev_b"],
        }),
        byId,
      ),
    ).toEqual([]);
  });

  it("reports numbers or units absent from the cited supporting excerpts", () => {
    const byId = new Map([[supporting.id, supporting]]);
    expect(
      unsupportedNumericTokens(
        claim({ statement: "Revenue was 391 billion USD." }),
        byId,
      ),
    ).toEqual(["391billion"]);
    expect(
      unsupportedNumericTokens(
        claim({ statement: "Revenue grew 30 percent." }),
        byId,
      ),
    ).toEqual(["30%"]);
    expect(
      unsupportedNumericTokens(claim({ evidenceIds: ["ev_missing"] }), byId),
    ).toHaveLength(3);
  });
});

describe("rating, availability, and kind agreement", () => {
  const supportive = claim();
  const counterpoint = claim({ category: "COUNTERPOINT" });
  const risk = claim({ category: "RISK" });

  it("counts the claim mix", () => {
    expect(claimMix([supportive, counterpoint, risk, risk])).toEqual({
      supportive: 1,
      counterpoint: 1,
      risk: 2,
    });
  });

  it.each([
    ["BULLISH", [supportive], true],
    ["BULLISH", [risk], false],
    ["BULLISH", [], false],
    ["BEARISH", [counterpoint], true],
    ["BEARISH", [risk], true],
    ["BEARISH", [supportive], false],
    ["MIXED", [supportive, risk], true],
    ["MIXED", [supportive], false],
    ["MIXED", [counterpoint, risk], false],
    ["NEUTRAL", [], true],
    ["NEUTRAL", [supportive, counterpoint], true],
  ] as const)("%s with %j agrees: %s", (rating, claims, expected) => {
    expect(ratingAgreesWithClaims(rating, claims)).toBe(expected);
  });

  it("assigns the fallback rating from the mix without inventing a lean", () => {
    expect(ratingForClaims([])).toBe("NEUTRAL");
    expect(ratingForClaims([supportive])).toBe("NEUTRAL");
    expect(ratingForClaims([risk, counterpoint])).toBe("NEUTRAL");
    expect(ratingForClaims([supportive, risk])).toBe("MIXED");
  });

  it("ties NOT_AVAILABLE to the absence of claims", () => {
    expect(availabilityAgreesWithClaims("NOT_AVAILABLE", [])).toBe(true);
    expect(availabilityAgreesWithClaims("NOT_AVAILABLE", [supportive])).toBe(
      false,
    );
    expect(availabilityAgreesWithClaims("COMPLETE", [])).toBe(false);
    expect(availabilityAgreesWithClaims("PARTIAL", [supportive])).toBe(true);
  });

  it("returns the first consistency issue or null", () => {
    const supporting = evidence(
      "ev_a",
      "Revenue was 391,035,000,000 USD for the period ending 2025-09-27.",
    );
    const derived = evidence(
      "ev_d",
      "Operating margin, annual period 2024-09-29 to 2025-09-27: 32.0 percent.",
      "DERIVED",
    );
    const base = {
      rating: "NEUTRAL" as const,
      confidence: 0.5,
      summary: "Summary.",
      warnings: [],
      missingData: [],
    };

    expect(
      getOutputConsistencyIssue(
        { ...base, availability: "COMPLETE", claims: [supportive] },
        [supporting],
      ),
    ).toBeNull();
    expect(
      getOutputConsistencyIssue(
        { ...base, claims: [claim({ statement: "Revenue was 400 billion USD." })] },
        [supporting],
      ),
    ).toMatch(/does not appear with the same unit/);
    expect(
      getOutputConsistencyIssue(
        {
          ...base,
          claims: [
            claim({
              kind: "DERIVED",
              statement: "Operating margin was 32.0 percent.",
              evidenceIds: ["ev_d"],
            }),
          ],
        },
        [supporting, derived],
      ),
    ).toBeNull();
    expect(
      getOutputConsistencyIssue(
        {
          ...base,
          claims: [
            claim({
              kind: "DERIVED",
              statement: "Revenue was 391,035,000,000 USD.",
              evidenceIds: ["ev_a"],
            }),
          ],
        },
        [supporting, derived],
      ),
    ).toMatch(/labeled DERIVED does not cite a derived evidence item/);
    expect(
      getOutputConsistencyIssue(
        { ...base, rating: "BULLISH", claims: [risk] },
        [supporting],
      ),
    ).toBe("The BULLISH rating does not agree with the claim categories.");
    expect(
      getOutputConsistencyIssue(
        { ...base, availability: "NOT_AVAILABLE", claims: [supportive] },
        [supporting],
      ),
    ).toMatch(/must not return claims/);
    expect(
      getOutputConsistencyIssue(
        { ...base, availability: "PARTIAL", claims: [] },
        [supporting],
      ),
    ).toMatch(/must report NOT_AVAILABLE/);
  });
});
