import { describe, expect, it } from "vitest";

import { stableHash } from "@/lib/research/ai/schemas";

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
