import { describe, expect, it } from "vitest";

import {
  getSentryTracesSampleRate,
  scrubSentryEvent,
  scrubSentrySpan,
} from "@/lib/observability/sentry-config";

describe("Sentry privacy configuration", () => {
  it("removes request bodies, cookies, secret headers, and user PII", () => {
    const event = scrubSentryEvent({
      user: {
        id: "user-1",
        email: "private@example.test",
        ip_address: "127.0.0.1",
      },
      request: {
        cookies: { session: "secret" },
        data: { portfolioValue: 123 },
        headers: {
          authorization: "Bearer secret",
          cookie: "session=secret",
          "x-vercel-protection-bypass": "preview-bypass-secret",
          "user-agent": "test",
        },
      },
    });

    expect(event.user).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.data).toBeUndefined();
    expect(event.request?.headers).toEqual({ "user-agent": "test" });
  });

  it("accepts only bounded performance sample rates", () => {
    expect(
      getSentryTracesSampleRate({ SENTRY_TRACES_SAMPLE_RATE: "0.1" }),
    ).toBe(0.1);
    expect(getSentryTracesSampleRate({ SENTRY_TRACES_SAMPLE_RATE: "2" })).toBe(
      0,
    );
    expect(getSentryTracesSampleRate({})).toBe(0);
  });

  it("retains only an already privacy-safe user identifier", () => {
    expect(
      scrubSentryEvent({
        user: { id: "user_0123456789abcdef", email: "ignored@example.test" },
      }).user,
    ).toEqual({ id: "user_0123456789abcdef" });
  });

  it("redacts query-string credentials from requests and outbound spans", () => {
    const event = scrubSentryEvent({
      breadcrumbs: [
        {
          category: "http",
          data: { http: { query: "symbol=AAPL&apikey=server-secret" } },
        },
      ],
      request: {
        url: "https://api.earningsapi.com/v1/earnings?symbol=AAPL&apikey=server-secret",
      },
    });
    const span = scrubSentrySpan({
      data: {
        "http.url":
          "https://api.earningsapi.com/v1/earnings?apikey=server-secret&symbol=AAPL",
        apiKey: "server-secret",
      },
      description:
        "GET https://api.earningsapi.com/v1/earnings?symbol=AAPL&apikey=server-secret",
      span_id: "0123456789abcdef",
      start_timestamp: 1,
      trace_id: "0123456789abcdef0123456789abcdef",
    });

    expect(event.request?.url).toContain("apikey=[REDACTED]");
    expect(JSON.stringify(event.breadcrumbs)).not.toContain("server-secret");
    expect(JSON.stringify(span)).not.toContain("server-secret");
  });

  it("redacts the Vercel protection bypass from spans and breadcrumbs", () => {
    const event = scrubSentryEvent({
      breadcrumbs: [
        {
          category: "http",
          data: {
            request: {
              headers: {
                "x-vercel-protection-bypass": "preview-bypass-secret",
              },
            },
          },
        },
      ],
    });
    const span = scrubSentrySpan({
      data: {
        "http.request.header.x_vercel_protection_bypass":
          "preview-bypass-secret",
      },
    });

    expect(JSON.stringify(event)).not.toContain("preview-bypass-secret");
    expect(JSON.stringify(span)).not.toContain("preview-bypass-secret");
  });
});
