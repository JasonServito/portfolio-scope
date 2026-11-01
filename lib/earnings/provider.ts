import {
  type UpcomingEarningsEvent,
  validateEarningsResponse,
} from "@/lib/earnings/provider-contract";

const EARNINGS_API_URL = "https://api.earningsapi.com/v1/earnings";
const DEFAULT_TIMEOUT_MS = 10_000;

export type { UpcomingEarningsEvent } from "@/lib/earnings/provider-contract";

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

    const validated = validateEarningsResponse(payload, symbol, marketDate);
    if (!validated.success) {
      throw new EarningsProviderError("INVALID_RESPONSE");
    }
    return validated.event;
  }
}
