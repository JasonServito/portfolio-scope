import { describe, expect, it } from "vitest";

import { createResearchReport } from "./orchestrator";
import { synthesizeResearch } from "./synthesis-agent";

describe("research output shaping", () => {
  it("uses a deterministic placeholder when no research signals exist", () => {
    expect(synthesizeResearch([])).toBe(
      "Research synthesis placeholder. No live LLM calls are configured.",
    );
  });

  it("combines signal summaries without creating recommendations", () => {
    const synthesis = synthesizeResearch([
      {
        source: "Seeded news",
        summary: "Revenue growth remained resilient.",
        confidence: "high",
      },
      {
        source: "Seeded risk",
        summary: "Valuation sensitivity is elevated.",
        confidence: "medium",
      },
    ]);

    expect(synthesis).toBe(
      "Revenue growth remained resilient. Valuation sensitivity is elevated.",
    );
    expect(synthesis.toLowerCase()).not.toMatch(/\b(buy|sell|hold)\b/);
  });

  it("normalizes report tickers and avoids live external calls", async () => {
    await expect(createResearchReport("nvda")).resolves.toEqual({
      ticker: "NVDA",
      signals: [],
      synthesis: "Research synthesis placeholder. No live LLM calls are configured.",
    });
  });
});
