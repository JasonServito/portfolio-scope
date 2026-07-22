import { describe, expect, it } from "vitest";

import {
  formatCik,
  getSupportedCompany,
  supportedCompanies,
} from "@/lib/sec/company-registry";

describe("supported SEC company registry", () => {
  it("contains the curated 25-company universe with unique tickers and CIKs", () => {
    expect(supportedCompanies).toHaveLength(25);
    expect(new Set(supportedCompanies.map(({ ticker }) => ticker)).size).toBe(
      25,
    );
    expect(new Set(supportedCompanies.map(({ cik }) => cik)).size).toBe(25);
  });

  it("normalizes ticker lookup while keeping CIK separate", () => {
    expect(getSupportedCompany(" aapl ")).toMatchObject({
      ticker: "AAPL",
      cik: "0000320193",
    });
    expect(getSupportedCompany("SHOP")).toBeNull();
  });

  it("formats CIKs to the SEC ten-digit contract and rejects invalid values", () => {
    expect(formatCik(320193)).toBe("0000320193");
    expect(formatCik("0000320193")).toBe("0000320193");
    expect(() => formatCik("32-0193")).toThrow(/CIK/);
    expect(() => formatCik("12345678901")).toThrow(/CIK/);
  });
});
