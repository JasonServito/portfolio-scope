import { describe, expect, it, vi } from "vitest";

import { getMarketDate, parseDateOnly, toDateOnly } from "@/lib/earnings/dates";
import {
  EarningsApiClient,
  EarningsProviderError,
} from "@/lib/earnings/provider";

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    date: "2026-08-28",
    symbol: "AAPL",
    name: "Apple Inc.",
    time: "time-after-hours",
    epsEstimate: 1.8,
    eps: null,
    revenue: null,
    revenueEstimate: 100_000_000_000,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("earnings date-only helpers", () => {
  it("uses the New York calendar boundary and validates real calendar dates", () => {
    expect(getMarketDate(new Date("2026-08-22T03:59:59.000Z"))).toBe(
      "2026-08-21",
    );
    expect(getMarketDate(new Date("2026-08-22T04:00:00.000Z"))).toBe(
      "2026-08-22",
    );
    expect(parseDateOnly("2026-02-29")).toBeNull();
    expect(toDateOnly(parseDateOnly("2028-02-29")!)).toBe("2028-02-29");
  });
});

describe("EarningsAPI provider contract", () => {
  it("selects the nearest unreported event without trusting response order", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse([
          row({ date: "2026-09-30", time: null }),
          row({ date: "2026-08-20", eps: 1.9 }),
          row({ date: "2026-08-21", time: "time-pre-market" }),
        ]),
      );
    const client = new EarningsApiClient("secret-key", fetchImpl);

    await expect(
      client.getUpcomingEvent("aapl", "2026-08-21"),
    ).resolves.toEqual({
      eventDate: new Date("2026-08-21T00:00:00.000Z"),
      marketSession: "BEFORE_MARKET",
    });
    const requestedUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(requestedUrl.pathname).toBe("/v1/earnings");
    expect(requestedUrl.searchParams.get("symbol")).toBe("AAPL");
    expect(requestedUrl.searchParams.get("apikey")).toBe("secret-key");
  });

  it("caches an explicit unknown when no valid future unreported row exists", async () => {
    const client = new EarningsApiClient(
      "secret-key",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse([row({ date: "2026-08-20", eps: 1.9 })]),
        ),
    );

    await expect(
      client.getUpcomingEvent("AAPL", "2026-08-21"),
    ).resolves.toBeNull();
  });

  it("normalizes undocumented timing to unknown without inventing a session", async () => {
    const client = new EarningsApiClient(
      "secret-key",
      vi.fn().mockResolvedValue(jsonResponse([row({ time: "unspecified" })])),
    );

    await expect(
      client.getUpcomingEvent("AAPL", "2026-08-21"),
    ).resolves.toMatchObject({ marketSession: null });
  });

  it.each([
    { label: "wrong symbol", body: [row({ symbol: "MSFT" })] },
    { label: "invalid date", body: [row({ date: "2026-02-30" })] },
    { label: "invalid shape", body: { results: [] } },
  ])("rejects a $label response", async ({ body }) => {
    const client = new EarningsApiClient(
      "secret-key",
      vi.fn().mockResolvedValue(jsonResponse(body)),
    );

    await expect(
      client.getUpcomingEvent("AAPL", "2026-08-21"),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("keeps credentials and provider bodies out of controlled errors", async () => {
    const client = new EarningsApiClient(
      "secret-key",
      vi
        .fn()
        .mockResolvedValue(
          new Response("secret provider body", { status: 429 }),
        ),
    );

    const error = await client
      .getUpcomingEvent("AAPL", "2026-08-21")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EarningsProviderError);
    expect(String(error)).not.toContain("secret-key");
    expect(String(error)).not.toContain("secret provider body");
  });
});
