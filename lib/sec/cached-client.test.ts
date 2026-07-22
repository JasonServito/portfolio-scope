import { describe, expect, it, vi } from "vitest";

import submissionsFixture from "@/tests/fixtures/sec/aapl-submissions.json";
import { CachedSecEdgarClient } from "@/lib/sec/cached-client";

describe("cached SEC client", () => {
  it("reuses a runtime-validated source cache entry", async () => {
    const source = {
      getSubmissions: vi.fn(),
      getCompanyFacts: vi.fn(),
    };
    const cache = {
      getJson: vi.fn().mockResolvedValue(submissionsFixture),
      setJson: vi.fn(),
    };
    const client = new CachedSecEdgarClient(source, cache);

    await expect(client.getSubmissions("320193")).resolves.toMatchObject({
      name: "Apple Inc.",
    });
    expect(source.getSubmissions).not.toHaveBeenCalled();
  });

  it("falls back to the source and replaces an invalid cache value", async () => {
    const source = {
      getSubmissions: vi.fn().mockResolvedValue(submissionsFixture),
      getCompanyFacts: vi.fn(),
    };
    const cache = {
      getJson: vi.fn().mockResolvedValue({ cik: "320193" }),
      setJson: vi.fn().mockResolvedValue(true),
    };
    const client = new CachedSecEdgarClient(source, cache);

    await client.getSubmissions("320193");
    expect(source.getSubmissions).toHaveBeenCalledWith("320193");
    expect(cache.setJson).toHaveBeenCalledWith(
      "sec-source",
      "submissions:0000320193",
      submissionsFixture,
      21_600,
    );
  });
});
