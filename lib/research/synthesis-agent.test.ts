import { describe, expect, it } from "vitest";

import { synthesizeResearch } from "./synthesis-agent";
import type { AgentResult } from "./types";

function result(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    agentName: "NEWS",
    status: "COMPLETED",
    rating: "NEUTRAL",
    confidence: 0.8,
    summary: "Seeded operating context is stable.",
    findings: [
      { label: "Context", detail: "Revenue growth remained resilient." },
    ],
    sources: [
      {
        title: "Seeded source",
        reference: "seed://test",
        detail: "Test input",
      },
    ],
    warnings: [],
    ...overrides,
  };
}

describe("research synthesis", () => {
  it("returns an explicit missing-data report without specialist results", () => {
    expect(synthesizeResearch("Example Corp", [])).toMatchObject({
      confidence: 0,
      missingData: ["The report has no completed topic results."],
    });
  });

  it("combines specialist evidence without creating recommendations", () => {
    const report = synthesizeResearch("Example Corp", [
      result({ rating: "BULLISH" }),
      result({
        agentName: "RISK",
        rating: "MIXED",
        confidence: 0.6,
        warnings: ["Valuation sensitivity is elevated."],
      }),
    ]);

    expect(report.bullCase).toEqual(["Revenue growth remained resilient."]);
    expect(report.risks).toEqual(["Valuation sensitivity is elevated."]);
    expect(report.confidence).toBe(0.7);
    expect(JSON.stringify(report).toLowerCase()).not.toMatch(
      /\b(buy|sell|hold)\b/,
    );
  });
});
