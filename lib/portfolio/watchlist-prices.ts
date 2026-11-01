export const WATCHLIST_PRICE_STALE_AFTER_MS = 72 * 60 * 60 * 1_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

type NumericValue = number | { toNumber: () => number };

export type StoredPriceObservation = {
  id: string;
  close: NumericValue;
  timestamp: Date;
};

export type WatchlistPrice =
  | {
      amount: number;
      currency: string;
      observedAt: string;
      source: "PortfolioScope demo fixture";
      state: "CACHED" | "STALE";
    }
  | {
      amount: null;
      currency: string;
      observedAt: null;
      source: "PortfolioScope demo fixture";
      state: "MISSING";
    };

export type TargetCrossing = {
  direction: "DOWN" | "UP";
  relativeDistanceBeyondTarget: number;
};

function positiveNumber(value: NumericValue) {
  const amount = typeof value === "number" ? value : value.toNumber();
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function presentWatchlistPrice(
  observations: readonly StoredPriceObservation[],
  currency: string,
  now = new Date(),
): WatchlistPrice {
  const latest = [...observations].sort(
    (left, right) => right.timestamp.getTime() - left.timestamp.getTime(),
  )[0];
  const amount = latest ? positiveNumber(latest.close) : null;
  const observedAt = latest?.timestamp.getTime();
  const nowTime = now.getTime();

  if (
    amount === null ||
    observedAt === undefined ||
    !Number.isFinite(observedAt) ||
    observedAt > nowTime + MAX_FUTURE_CLOCK_SKEW_MS
  ) {
    return {
      amount: null,
      currency,
      observedAt: null,
      source: "PortfolioScope demo fixture",
      state: "MISSING",
    };
  }

  return {
    amount,
    currency,
    observedAt: latest.timestamp.toISOString(),
    source: "PortfolioScope demo fixture",
    state:
      nowTime - observedAt > WATCHLIST_PRICE_STALE_AFTER_MS
        ? "STALE"
        : "CACHED",
  };
}

export function evaluateTargetCrossing(input: {
  currentPrice: NumericValue;
  previousPrice: NumericValue;
  targetPrice: NumericValue;
}): TargetCrossing | null {
  const currentPrice = positiveNumber(input.currentPrice);
  const previousPrice = positiveNumber(input.previousPrice);
  const targetPrice = positiveNumber(input.targetPrice);

  if (currentPrice === null || previousPrice === null || targetPrice === null) {
    return null;
  }

  const direction =
    previousPrice < targetPrice && currentPrice >= targetPrice
      ? "UP"
      : previousPrice > targetPrice && currentPrice <= targetPrice
        ? "DOWN"
        : null;

  if (!direction) return null;

  return {
    direction,
    relativeDistanceBeyondTarget:
      Math.abs(currentPrice - targetPrice) / targetPrice,
  };
}
