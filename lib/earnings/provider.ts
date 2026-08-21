import { z } from "zod";

import { parseDateOnly } from "@/lib/earnings/dates";

const EARNINGS_API_URL = "https://api.earningsapi.com/v1/earnings";
const DEFAULT_TIMEOUT_MS = 10_000;

const earningsRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  symbol: z.string().trim().min(1).max(16),
  name: z.string().nullable(),
  time: z.string().nullable(),
  epsEstimate: z.number().finite().nullable(),
  eps: z.number().finite().nullable(),
  revenue: z.number().finite().nullable(),
  revenueEstimate: z.number().finite().nullable(),
});

const earningsResponseSchema = z.array(earningsRowSchema).max(100);

export type UpcomingEarningsEvent = {
  eventDate: Date;
  marketSession: "AFTER_MARKET" | "BEFORE_MARKET" | null;
};

export interface UpcomingEarningsProvider {
  getUpcomingEvent(
    ticker: string,
    marketDate: string,
  ): Promise<UpcomingEarningsEvent | null>;
}

export class EarningsProviderError extends Error {
  readonly name = "EarningsProviderError";

  constructor(
    public readonly code:
      | "HTTP_ERROR"
      | "INVALID_RESPONSE"
      | "INVALID_TICKER"
      | "REQUEST_FAILED",
  ) {
    super(`Earnings provider request failed (${code}).`);
  }
}

function normalizeMarketSession(value: string | null) {
  if (value === "time-pre-market") return "BEFORE_MARKET" as const;
  if (value === "time-after-hours") return "AFTER_MARKET" as const;
  return null;
}

export class EarningsApiClient implements UpcomingEarningsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async getUpcomingEvent(ticker: string, marketDate: string) {
    const symbol = ticker.trim().toUpperCase();
    if (!/^[A-Z]{1,5}$/.test(symbol)) {
      throw new EarningsProviderError("INVALID_TICKER");
    }

    const url = new URL(EARNINGS_API_URL);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("apikey", this.apiKey);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new EarningsProviderError("REQUEST_FAILED");
    }

    if (!response.ok) {
      throw new EarningsProviderError("HTTP_ERROR");
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new EarningsProviderError("INVALID_RESPONSE");
    }

    const parsed = earningsResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new EarningsProviderError("INVALID_RESPONSE");
    }
    if (parsed.data.some((row) => row.symbol.trim().toUpperCase() !== symbol)) {
      throw new EarningsProviderError("INVALID_RESPONSE");
    }

    const candidates = parsed.data
      .map((row) => ({ row, eventDate: parseDateOnly(row.date) }))
      .filter(
        (
          item,
        ): item is {
          row: z.infer<typeof earningsRowSchema>;
          eventDate: Date;
        } => item.eventDate !== null,
      );

    if (candidates.length !== parsed.data.length) {
      throw new EarningsProviderError("INVALID_RESPONSE");
    }

    const upcoming = candidates
      .filter(
        ({ row }) =>
          row.date >= marketDate && row.eps === null && row.revenue === null,
      )
      .sort(({ row: left }, { row: right }) =>
        left.date.localeCompare(right.date),
      )[0];

    return upcoming
      ? {
          eventDate: upcoming.eventDate,
          marketSession: normalizeMarketSession(upcoming.row.time),
        }
      : null;
  }
}
