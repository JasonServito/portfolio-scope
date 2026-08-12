import { describe, expect, it } from "vitest";

import { specialistPrompt } from "./prompts";
import type { ResearchEvidence } from "./schemas";

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
    expect(prompt.instructions).toContain("never personalize");
    expect(prompt.input).toContain(evidence.id);
    expect(prompt.input).not.toMatch(/portfolioWeight|activeAlerts|userId/);
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
