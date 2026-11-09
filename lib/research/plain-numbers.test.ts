import { describe, expect, it } from "vitest";

import { plainNumbers } from "@/lib/research/plain-numbers";

describe("plain report numbers", () => {
  it("shortens large dollar amounts to one decimal of their scale", () => {
    expect(
      plainNumbers(
        "Apple's latest annual revenue was 416,161,000,000 USD for 2024-09-29 to 2025-09-27.",
      ),
    ).toBe("Apple's latest annual revenue was $416.2 billion for 2024-09-29 to 2025-09-27.");
    expect(plainNumbers("Free cash flow was 51,552,000,000 USD.")).toBe(
      "Free cash flow was $51.6 billion.",
    );
    expect(plainNumbers("Cash minus debt was -31,796,000,000 USD.")).toBe(
      "Cash minus debt was -$31.8 billion.",
    );
    expect(plainNumbers("Backlog reached 2,400,000,000,000 USD.")).toBe(
      "Backlog reached $2.4 trillion.",
    );
    expect(plainNumbers("A fee of 12,500,000 USD was paid.")).toBe(
      "A fee of $12.5 million was paid.",
    );
  });

  it("keeps per-share and small amounts exact", () => {
    expect(
      plainNumbers("Diluted EPS was 7.46 USD per share annually and 2.02 USD per share quarterly."),
    ).toBe("Diluted EPS was $7.46 per share annually and $2.02 per share quarterly.");
    expect(plainNumbers("The dividend was 0.26 USD.")).toBe(
      "The dividend was $0.26.",
    );
  });

  it("writes percent as a symbol but leaves percentage points alone", () => {
    expect(
      plainNumbers("Operating margin was 32.6 percent, up 0.6 percentage points."),
    ).toBe("Operating margin was 32.6%, up 0.6 percentage points.");
    expect(plainNumbers("Shares declined -2.6 percent.")).toBe(
      "Shares declined -2.6%.",
    );
  });

  it("leaves text without raw figures unchanged", () => {
    const text = "Revenue increased while margin compressed in fiscal 2025.";
    expect(plainNumbers(text)).toBe(text);
  });
});
