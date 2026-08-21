import { describe, expect, it } from "vitest";

import { getCompanyDescription } from "@/lib/portfolio/company-descriptions";

describe("company descriptions", () => {
  it("provides plain-language curated context for seeded companies", () => {
    expect(
      getCompanyDescription({
        ticker: "AAPL",
        companyName: "Apple Inc.",
        industry: "Consumer Electronics",
      }),
    ).toContain("designs consumer devices");
  });

  it("keeps an honest industry-based fallback for uncatalogued stocks", () => {
    expect(
      getCompanyDescription({
        ticker: "EXAMPLE",
        companyName: "Example Corp.",
        industry: "Industrial Tools",
      }),
    ).toBe("Example Corp. operates in the industrial tools industry.");
  });
});
