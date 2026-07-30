import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("posthog-js", () => ({
  default: { capture: mocks.capture },
}));

import { captureAnalyticsEvent } from "@/lib/analytics/client";

describe("privacy-safe analytics client", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("stays disabled unless the key and reviewed ingestion host are present", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");

    expect(captureAnalyticsEvent("portfolio_created", {})).toBe(false);
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("sends only a runtime-validated event", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://us.i.posthog.com");

    expect(
      captureAnalyticsEvent("stock_page_viewed", { ticker: "AAPL" }),
    ).toBe(true);
    expect(mocks.capture).toHaveBeenCalledWith("stock_page_viewed", {
      ticker: "AAPL",
    });
    expect(
      captureAnalyticsEvent("stock_page_viewed", {
        ticker: "private@example.test",
      }),
    ).toBe(false);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
  });
});
