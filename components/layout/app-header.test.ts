import { describe, expect, it } from "vitest";

import { getSearchDestination } from "./app-header";

describe("header search destinations", () => {
  it("normalizes ticker searches", () => {
    expect(getSearchDestination(" AAPL ")).toBe("/stocks/aapl");
    expect(getSearchDestination("nvda")).toBe("/stocks/nvda");
  });

  it("routes app section searches", () => {
    expect(getSearchDestination("Holdings")).toBe("/holdings");
    expect(getSearchDestination("alerts")).toBe("/alerts");
    expect(getSearchDestination("portfolio")).toBe("/dashboard");
  });

  it("rejects empty or malformed searches", () => {
    expect(getSearchDestination("   ")).toBeNull();
    expect(getSearchDestination("AAPL<script>")).toBeNull();
    expect(getSearchDestination("TOO-LONG")).toBeNull();
  });
});
