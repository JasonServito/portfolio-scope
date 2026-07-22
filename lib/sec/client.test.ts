import { describe, expect, it, vi } from "vitest";

import submissionsFixture from "@/tests/fixtures/sec/aapl-submissions.json";
import {
  SecClientErrorCode,
  SecEdgarClient,
  buildSecCompanyFactsUrl,
  buildSecFilingIndexUrl,
  buildSecSubmissionsUrl,
} from "@/lib/sec/client";

function createClient(
  fetchImplementation: typeof fetch,
  sleep = vi.fn(),
  options: { maxRetries?: number; timeoutMs?: number } = {},
) {
  return new SecEdgarClient({
    userAgent: "PortfolioScope/1.0",
    contactEmail: "engineering@example.com",
    fetch: fetchImplementation,
    requestsPerSecond: 10,
    maxRetries: options.maxRetries ?? 1,
    timeoutMs: options.timeoutMs ?? 1_000,
    now: () => 0,
    sleep,
  });
}

describe("SEC EDGAR HTTP client", () => {
  it("uses official endpoints, an identifying user agent, and runtime validation", async () => {
    const fetchImplementation = vi.fn(async () =>
      Response.json(submissionsFixture),
    ) as unknown as typeof fetch;
    const client = createClient(fetchImplementation);

    await expect(client.getSubmissions("320193")).resolves.toMatchObject({
      name: "Apple Inc.",
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://data.sec.gov/submissions/CIK0000320193.json",
      expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": "PortfolioScope/1.0 engineering@example.com",
        }),
      }),
    );
  });

  it("accepts missing concept presentation metadata through the shared client", async () => {
    const companyFactsWithNullableMetadata = {
      cik: 320193,
      entityName: "Apple Inc.",
      facts: {
        "us-gaap": {
          EffectiveIncomeTaxRateReconciliationFdiiAmount: {
            label: null,
            description: null,
            units: {
              USD: [
                {
                  start: "2024-09-29",
                  end: "2025-09-27",
                  val: 1,
                  accn: "0000320193-25-000079",
                  fy: 2025,
                  fp: "FY",
                  form: "10-K",
                  filed: "2025-10-31",
                },
              ],
            },
          },
          EmptyPresentationLabel: {
            label: "",
            description: "",
            units: {
              USD: [
                {
                  start: "2024-09-29",
                  end: "2025-09-27",
                  val: 1,
                  accn: "0000320193-25-000079",
                  fy: 2025,
                  fp: "FY",
                  form: "10-K",
                  filed: "2025-10-31",
                },
              ],
            },
          },
        },
      },
    };
    const fetchImplementation = vi.fn(async () =>
      Response.json(companyFactsWithNullableMetadata),
    ) as unknown as typeof fetch;
    const client = createClient(fetchImplementation);

    await expect(client.getCompanyFacts("320193")).resolves.toMatchObject({
      entityName: "Apple Inc.",
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/json",
          "User-Agent": "PortfolioScope/1.0 engineering@example.com",
        }),
      }),
    );
  });

  it("retries a 429 with bounded delay and then succeeds", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "1" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json(submissionsFixture),
      ) as unknown as typeof fetch;
    const sleep = vi.fn(async () => undefined);
    const client = createClient(fetchImplementation, sleep);

    await expect(client.getSubmissions("320193")).resolves.toBeDefined();
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("classifies schema-validation failures without retrying them", async () => {
    const fetchImplementation = vi.fn(async () =>
      Response.json({ cik: "320193" }),
    ) as unknown as typeof fetch;
    const client = createClient(fetchImplementation);

    await expect(client.getSubmissions("320193")).rejects.toMatchObject({
      code: SecClientErrorCode.SCHEMA_VALIDATION_FAILED,
      retryable: false,
      details: expect.objectContaining({
        failureCategory: "schema-validation",
        httpStatus: 200,
        attemptNumber: 1,
      }),
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("classifies malformed JSON separately from schema validation", async () => {
    const fetchImplementation = vi.fn(async () =>
      new Response("{not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    const client = createClient(fetchImplementation);

    await expect(client.getCompanyFacts("320193")).rejects.toMatchObject({
      code: SecClientErrorCode.INVALID_JSON,
      retryable: false,
      details: expect.objectContaining({
        failureCategory: "invalid-json",
        httpStatus: 200,
      }),
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("classifies a 403 provider rejection without retrying it", async () => {
    const fetchImplementation = vi.fn(async () =>
      new Response("forbidden", { status: 403 }),
    ) as unknown as typeof fetch;
    const sleep = vi.fn();
    const client = createClient(fetchImplementation, sleep);

    await expect(client.getCompanyFacts("320193")).rejects.toMatchObject({
      code: SecClientErrorCode.REQUEST_REJECTED,
      retryable: false,
      details: expect.objectContaining({
        failureCategory: "provider-rejection",
        httpStatus: 403,
        attemptNumber: 1,
      }),
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("classifies an exhausted 429 after bounded retries", async () => {
    const fetchImplementation = vi.fn(async () =>
      new Response("rate limited", { status: 429 }),
    ) as unknown as typeof fetch;
    const sleep = vi.fn(async () => undefined);
    const client = createClient(fetchImplementation, sleep);

    await expect(client.getCompanyFacts("320193")).rejects.toMatchObject({
      code: SecClientErrorCode.PROVIDER_RATE_LIMITED,
      retryable: true,
      details: expect.objectContaining({
        failureCategory: "provider-rate-limit",
        httpStatus: 429,
        attemptNumber: 2,
      }),
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("classifies an exhausted 5xx after bounded retries", async () => {
    const fetchImplementation = vi.fn(async () =>
      new Response("unavailable", { status: 503 }),
    ) as unknown as typeof fetch;
    const sleep = vi.fn(async () => undefined);
    const client = createClient(fetchImplementation, sleep);

    await expect(client.getCompanyFacts("320193")).rejects.toMatchObject({
      code: SecClientErrorCode.PROVIDER_UNAVAILABLE,
      retryable: true,
      details: expect.objectContaining({
        failureCategory: "provider-unavailable",
        httpStatus: 503,
        attemptNumber: 2,
      }),
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("classifies aborted requests as timeouts", async () => {
    const fetchImplementation = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    ) as unknown as typeof fetch;
    const client = createClient(fetchImplementation, vi.fn(), {
      maxRetries: 0,
      timeoutMs: 5,
    });

    await expect(client.getCompanyFacts("320193")).rejects.toMatchObject({
      code: SecClientErrorCode.REQUEST_TIMEOUT,
      retryable: true,
      details: expect.objectContaining({ failureCategory: "timeout" }),
    });
  });

  it("classifies network failures separately from timeouts", async () => {
    const fetchImplementation = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const client = createClient(fetchImplementation, vi.fn(), {
      maxRetries: 0,
    });

    await expect(client.getCompanyFacts("320193")).rejects.toMatchObject({
      code: SecClientErrorCode.NETWORK_ERROR,
      retryable: true,
      details: expect.objectContaining({ failureCategory: "network" }),
    });
  });

  it("rejects a valid response for a different CIK", async () => {
    const mismatchedSubmissions = {
      ...submissionsFixture,
      cik: "789019",
    };
    const client = createClient(
      vi.fn(async () =>
        Response.json(mismatchedSubmissions),
      ) as unknown as typeof fetch,
    );

    await expect(client.getSubmissions("320193")).rejects.toMatchObject({
      code: SecClientErrorCode.INVALID_RESPONSE,
      retryable: false,
    });
  });

  it("builds stable source and filing URLs and rejects forged path segments", () => {
    expect(buildSecSubmissionsUrl("320193")).toContain("CIK0000320193");
    expect(buildSecCompanyFactsUrl("320193")).toContain("CIK0000320193");
    expect(buildSecFilingIndexUrl("320193", "0000320193-25-000079")).toBe(
      "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/0000320193-25-000079-index.html",
    );
    expect(() => buildSecFilingIndexUrl("320193", "../../secrets")).toThrow(
      /accession/,
    );
  });

  it("retrieves a bounded filing document through the identifying client", async () => {
    const fetchImplementation = vi.fn(async () =>
      new Response("<html>filing</html>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    ) as unknown as typeof fetch;
    const client = createClient(fetchImplementation);

    const document = await client.getFilingDocument(
      "320193",
      "0000320193-25-000079",
      "aapl-20250927.htm",
    );

    expect(document.contentType).toBe("text/html");
    expect(new TextDecoder().decode(document.body)).toContain("filing");
    expect(fetchImplementation).toHaveBeenCalledWith(
      expect.stringContaining("aapl-20250927.htm"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": "PortfolioScope/1.0 engineering@example.com",
        }),
      }),
    );
  });
});
