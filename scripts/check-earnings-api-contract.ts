import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getMarketDate, toDateOnly } from "../lib/earnings/dates";
import { validateEarningsResponse } from "../lib/earnings/provider-contract";

const EARNINGS_API_URL = "https://api.earningsapi.com/v1/earnings";
const CATALOG_PATH = resolve("data/supported-companies.json");
const EXPECTED_CATALOG_SHA256 =
  "dea98ed2fc551e714c280ef336ce9842a20fcb618be406721252fc319e8325cb";
export const GATE5_APPROVAL_VALUE = "APPROVE_M26_GATE5_EXACTLY_25_REQUESTS";
export const MAX_PROVIDER_REQUESTS = 25;
const REQUEST_TIMEOUT_MS = 10_000;

type Gate5Environment = Record<string, string | undefined>;
type SafeOutput = (line: string) => void;

type SymbolOutcome = {
  marketSession?: "AFTER_MARKET" | "BEFORE_MARKET" | null;
  outcome:
    | "CONTRACT_FAILURE"
    | "REDIRECT_FAILURE"
    | "TRANSIENT_FAILURE"
    | "VALID_EMPTY"
    | "VALID_NO_UPCOMING"
    | "VALID_UPCOMING";
  rowCount?: number;
  selectedDate?: string;
  status?: number;
  ticker: string;
};

export type Gate5Summary = {
  attemptedRequestCount: number;
  catalogCount: number;
  contractFailureCount: number;
  redirectFailureCount: number;
  retryCount: 0;
  transientFailureCount: number;
  validEmptyOrNoUpcomingCount: number;
  validNonemptyCount: number;
};

function catalogFingerprint(symbols: readonly string[]) {
  return createHash("sha256").update(symbols.join(",")).digest("hex");
}

export function validateGate5Catalog(catalog: unknown): string[] {
  if (!Array.isArray(catalog) || catalog.length !== MAX_PROVIDER_REQUESTS) {
    throw new Error("Gate 5 catalog must contain exactly 25 entries.");
  }

  const symbols = catalog.map((entry) => {
    if (!entry || typeof entry !== "object" || !("ticker" in entry)) {
      throw new Error("Gate 5 catalog contains an invalid entry.");
    }
    const ticker = (entry as { ticker?: unknown }).ticker;
    if (
      typeof ticker !== "string" ||
      ticker !== ticker.trim().toUpperCase() ||
      !/^[A-Z]{1,5}$/.test(ticker)
    ) {
      throw new Error("Gate 5 catalog contains an invalid ticker.");
    }
    return ticker;
  });

  if (new Set(symbols).size !== symbols.length) {
    throw new Error("Gate 5 catalog contains a duplicate ticker.");
  }
  if (catalogFingerprint(symbols) !== EXPECTED_CATALOG_SHA256) {
    throw new Error("Gate 5 catalog does not match the approved symbol set.");
  }
  return symbols;
}

export function validateGate5Environment(environment: Gate5Environment) {
  if (environment.M26_GATE5_LIVE_CHECK_APPROVAL !== GATE5_APPROVAL_VALUE) {
    throw new Error("Gate 5 one-run approval is missing or invalid.");
  }
  if (environment.VERCEL_ENV !== "production") {
    throw new Error("Gate 5 requires the Production Vercel environment.");
  }
  if (environment.EARNINGS_SYNC_ENABLED !== "false") {
    throw new Error("Gate 5 requires EARNINGS_SYNC_ENABLED=false.");
  }
  const apiKey = environment.EARNINGS_API_KEY?.trim();
  if (!apiKey) throw new Error("Gate 5 requires the server-only provider key.");
  return apiKey;
}

function isTransientStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

async function checkSymbol(input: {
  apiKey: string;
  fetchImpl: typeof fetch;
  marketDate: string;
  ticker: string;
}): Promise<SymbolOutcome> {
  const url = new URL(EARNINGS_API_URL);
  url.searchParams.set("symbol", input.ticker);
  url.searchParams.set("apikey", input.apiKey);

  let response: Response;
  try {
    response = await input.fetchImpl(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { outcome: "TRANSIENT_FAILURE", ticker: input.ticker };
  }

  if (response.status >= 300 && response.status < 400) {
    return {
      outcome: "REDIRECT_FAILURE",
      status: response.status,
      ticker: input.ticker,
    };
  }
  if (!response.ok) {
    return {
      outcome: isTransientStatus(response.status)
        ? "TRANSIENT_FAILURE"
        : "CONTRACT_FAILURE",
      status: response.status,
      ticker: input.ticker,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      outcome: "CONTRACT_FAILURE",
      status: response.status,
      ticker: input.ticker,
    };
  }

  const validated = validateEarningsResponse(
    payload,
    input.ticker,
    input.marketDate,
  );
  if (!validated.success) {
    return {
      outcome: "CONTRACT_FAILURE",
      status: response.status,
      ticker: input.ticker,
    };
  }
  if (validated.rowCount === 0) {
    return {
      outcome: "VALID_EMPTY",
      rowCount: 0,
      status: response.status,
      ticker: input.ticker,
    };
  }
  if (!validated.event) {
    return {
      outcome: "VALID_NO_UPCOMING",
      rowCount: validated.rowCount,
      status: response.status,
      ticker: input.ticker,
    };
  }
  return {
    marketSession: validated.event.marketSession,
    outcome: "VALID_UPCOMING",
    rowCount: validated.rowCount,
    selectedDate: toDateOnly(validated.event.eventDate),
    status: response.status,
    ticker: input.ticker,
  };
}

export async function runGate5ContractCheck(input: {
  catalog: unknown;
  environment: Gate5Environment;
  fetchImpl?: typeof fetch;
  now?: Date;
  output?: SafeOutput;
}): Promise<Gate5Summary> {
  const symbols = validateGate5Catalog(input.catalog);
  const apiKey = validateGate5Environment(input.environment);
  const fetchImpl = input.fetchImpl ?? fetch;
  const output = input.output ?? ((line) => process.stdout.write(`${line}\n`));
  const marketDate = getMarketDate(input.now ?? new Date());
  const outcomes: SymbolOutcome[] = [];
  let attemptedRequestCount = 0;

  output(
    JSON.stringify({
      catalogCount: symbols.length,
      marketDate,
      startedAt: new Date().toISOString(),
      type: "gate5-start",
    }),
  );

  for (const ticker of symbols) {
    if (attemptedRequestCount >= MAX_PROVIDER_REQUESTS) {
      throw new Error("Gate 5 hard request bound would be exceeded.");
    }
    attemptedRequestCount += 1;
    const outcome = await checkSymbol({
      apiKey,
      fetchImpl,
      marketDate,
      ticker,
    });
    outcomes.push(outcome);
    output(JSON.stringify({ ...outcome, type: "gate5-symbol" }));
  }

  const summary: Gate5Summary = {
    attemptedRequestCount,
    catalogCount: symbols.length,
    contractFailureCount: outcomes.filter(
      ({ outcome }) => outcome === "CONTRACT_FAILURE",
    ).length,
    redirectFailureCount: outcomes.filter(
      ({ outcome }) => outcome === "REDIRECT_FAILURE",
    ).length,
    retryCount: 0,
    transientFailureCount: outcomes.filter(
      ({ outcome }) => outcome === "TRANSIENT_FAILURE",
    ).length,
    validEmptyOrNoUpcomingCount: outcomes.filter(
      ({ outcome }) =>
        outcome === "VALID_EMPTY" || outcome === "VALID_NO_UPCOMING",
    ).length,
    validNonemptyCount: outcomes.filter(
      ({ rowCount }) => rowCount !== undefined && rowCount > 0,
    ).length,
  };
  output(JSON.stringify({ ...summary, type: "gate5-summary" }));
  return summary;
}

export async function runGate5Command() {
  try {
    const catalog = JSON.parse(await readFile(CATALOG_PATH, "utf8")) as unknown;
    const summary = await runGate5ContractCheck({
      catalog,
      environment: process.env,
    });
    if (
      summary.attemptedRequestCount !== MAX_PROVIDER_REQUESTS ||
      summary.contractFailureCount > 0 ||
      summary.redirectFailureCount > 0 ||
      summary.transientFailureCount > 0
    ) {
      return 1;
    }
    return 0;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown controlled failure.";
    process.stderr.write(`Gate 5 contract check aborted: ${message}\n`);
    return 1;
  }
}
