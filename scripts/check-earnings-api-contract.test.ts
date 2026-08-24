import { describe, expect, it, vi } from "vitest";

import supportedCompanies from "../data/supported-companies.json";
import {
  GATE5_APPROVAL_VALUE,
  MAX_PROVIDER_REQUESTS,
  runGate5ContractCheck,
  validateGate5Catalog,
} from "./check-earnings-api-contract";

const approvedEnvironment = {
  EARNINGS_API_KEY: "test-secret-key",
  EARNINGS_SYNC_ENABLED: "false",
  M26_GATE5_LIVE_CHECK_APPROVAL: GATE5_APPROVAL_VALUE,
  VERCEL_ENV: "production",
};
const now = new Date("2026-08-24T16:00:00.000Z");

function row(symbol: string, overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-08-28",
    symbol,
    name: `${symbol} Company`,
    time: "time-after-hours",
    epsEstimate: 1.8,
    eps: null,
    revenue: null,
    revenueEstimate: 1_000_000,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function tickerFromRequest(input: string | URL | Request) {
  return new URL(String(input)).searchParams.get("symbol")!;
}

function mockFetch(
  implementation: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response> = async (input) =>
    jsonResponse([row(tickerFromRequest(input))]),
) {
  return vi.fn(implementation) as unknown as typeof fetch;
}

async function runWith(fetchImpl: typeof fetch, output: string[] = []) {
  return runGate5ContractCheck({
    catalog: supportedCompanies,
    environment: approvedEnvironment,
    fetchImpl,
    now,
    output: (line) => output.push(line),
  });
}

describe("Gate 5 preflight", () => {
  it("accepts only the exact canonical 25-symbol catalog", () => {
    expect(validateGate5Catalog(supportedCompanies)).toEqual(
      supportedCompanies.map(({ ticker }) => ticker),
    );
    expect(supportedCompanies).toHaveLength(MAX_PROVIDER_REQUESTS);
    expect(new Set(supportedCompanies.map(({ ticker }) => ticker)).size).toBe(
      MAX_PROVIDER_REQUESTS,
    );

    expect(() => validateGate5Catalog(supportedCompanies.slice(0, 24))).toThrow(
      "exactly 25",
    );
    expect(() =>
      validateGate5Catalog([
        ...supportedCompanies.slice(0, 24),
        { ...supportedCompanies[24], ticker: "AAPL" },
      ]),
    ).toThrow("duplicate");
    expect(() =>
      validateGate5Catalog([
        ...supportedCompanies.slice(0, 24),
        { ...supportedCompanies[24], ticker: "IBM" },
      ]),
    ).toThrow("approved symbol set");
  });

  it.each([
    {
      label: "missing approval",
      environment: {
        ...approvedEnvironment,
        M26_GATE5_LIVE_CHECK_APPROVAL: undefined,
      },
      expected: "approval",
    },
    {
      label: "non-Production target",
      environment: { ...approvedEnvironment, VERCEL_ENV: "preview" },
      expected: "Production",
    },
    {
      label: "enabled sync",
      environment: { ...approvedEnvironment, EARNINGS_SYNC_ENABLED: "true" },
      expected: "EARNINGS_SYNC_ENABLED=false",
    },
    {
      label: "missing key",
      environment: { ...approvedEnvironment, EARNINGS_API_KEY: "" },
      expected: "server-only provider key",
    },
  ])("aborts before network activity for $label", async ({ environment, expected }) => {
    const fetchImpl = mockFetch();
    await expect(
      runGate5ContractCheck({
        catalog: supportedCompanies,
        environment,
        fetchImpl,
      }),
    ).rejects.toThrow(expected);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("validates the catalog before any environment or network access", async () => {
    const fetchImpl = mockFetch();
    await expect(
      runGate5ContractCheck({
        catalog: supportedCompanies.slice(0, 24),
        environment: {},
        fetchImpl,
      }),
    ).rejects.toThrow("exactly 25");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Gate 5 hard request bound", () => {
  it("runs sequentially with one manual-redirect fetch per unique symbol", async () => {
    let inFlight = 0;
    let maximumInFlight = 0;
    const fetchImpl = mockFetch(async (input, init) => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      expect(init?.redirect).toBe("manual");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return jsonResponse([row(tickerFromRequest(input))]);
    });

    const summary = await runWith(fetchImpl);
    const attemptedSymbols = vi.mocked(fetchImpl).mock.calls.map(([input]) =>
      tickerFromRequest(input),
    );

    expect(maximumInFlight).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_PROVIDER_REQUESTS);
    expect(attemptedSymbols).toEqual(
      supportedCompanies.map(({ ticker }) => ticker),
    );
    expect(new Set(attemptedSymbols).size).toBe(MAX_PROVIDER_REQUESTS);
    expect(summary).toMatchObject({
      attemptedRequestCount: MAX_PROVIDER_REQUESTS,
      retryCount: 0,
    });
  });

  it.each([
    ["timeout", async () => Promise.reject(new DOMException("timeout", "TimeoutError"))],
    ["network failure", async () => Promise.reject(new Error("offline"))],
    ["HTTP 408", async () => new Response(null, { status: 408 })],
    ["HTTP 429", async () => new Response(null, { status: 429 })],
    ["HTTP 503", async () => new Response(null, { status: 503 })],
  ])("does not retry after %s", async (_label, firstResult) => {
    let calls = 0;
    const fetchImpl = mockFetch(async (input) => {
      calls += 1;
      if (calls === 1) return firstResult();
      return jsonResponse([row(tickerFromRequest(input))]);
    });

    const summary = await runWith(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_PROVIDER_REQUESTS);
    expect(summary).toMatchObject({
      attemptedRequestCount: MAX_PROVIDER_REQUESTS,
      retryCount: 0,
      transientFailureCount: 1,
    });
  });

  it("classifies a redirect without following it", async () => {
    const fetchImpl = mockFetch(async () =>
      new Response(null, {
        headers: { Location: "https://example.invalid/fallback" },
        status: 302,
      }),
    );

    const summary = await runWith(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_PROVIDER_REQUESTS);
    expect(summary).toMatchObject({
      redirectFailureCount: MAX_PROVIDER_REQUESTS,
      retryCount: 0,
    });
    for (const [, init] of vi.mocked(fetchImpl).mock.calls) {
      expect(init?.redirect).toBe("manual");
    }
  });
});

describe("Gate 5 response validation and redaction", () => {
  it("accepts empty arrays and valid arrays without an upcoming event", async () => {
    let calls = 0;
    const fetchImpl = mockFetch(async (input) => {
      calls += 1;
      const ticker = tickerFromRequest(input);
      if (calls === 1) return jsonResponse([]);
      if (calls === 2) {
        return jsonResponse([row(ticker, { date: "2026-08-20", eps: 1.9 })]);
      }
      return jsonResponse([row(ticker)]);
    });

    const summary = await runWith(fetchImpl);
    expect(summary).toMatchObject({
      contractFailureCount: 0,
      validEmptyOrNoUpcomingCount: 2,
      validNonemptyCount: 24,
    });
  });

  it.each([
    ["invalid schema", () => ({ results: [] })],
    ["wrong symbol", () => [row("WRONG")]],
    ["invalid date", (ticker: string) => [row(ticker, { date: "2026-02-30" })]],
  ])("fails a symbol with %s", async (_label, invalidPayload) => {
    let calls = 0;
    const fetchImpl = mockFetch(async (input) => {
      calls += 1;
      const ticker = tickerFromRequest(input);
      return jsonResponse(calls === 1 ? invalidPayload(ticker) : [row(ticker)]);
    });

    const summary = await runWith(fetchImpl);
    expect(summary.contractFailureCount).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_PROVIDER_REQUESTS);
  });

  it("never includes the key or thrown provider details in captured output", async () => {
    const secret = approvedEnvironment.EARNINGS_API_KEY;
    const output: string[] = [];
    let calls = 0;
    const fetchImpl = mockFetch(async (input) => {
      calls += 1;
      if (calls === 1) throw new Error(`network detail contained ${secret}`);
      return jsonResponse([row(tickerFromRequest(input))]);
    });

    const summary = await runWith(fetchImpl, output);
    const captured = output.join("\n");
    expect(summary.transientFailureCount).toBe(1);
    expect(captured).not.toContain(secret);
    expect(captured).not.toContain("apikey=");
    expect(captured).not.toContain("network detail");
  });
});
