import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  countFailedJobs: vi.fn(),
  countSupportedCompanies: vi.fn(),
  findLatestWorker: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: mocks.queryRaw,
    backgroundJob: {
      count: mocks.countFailedJobs,
      findFirst: mocks.findLatestWorker,
    },
    company: { count: mocks.countSupportedCompanies },
  },
}));

vi.mock("@/lib/cache/redis", () => ({
  getRedis: vi.fn(() => null),
  isRedisConfigured: vi.fn(() => false),
}));

vi.mock("@/lib/research/ai/budget", () => ({
  getGlobalAiUsageSummary: vi.fn(async () => null),
}));

vi.mock("@/lib/storage/object-storage", () => {
  class R2ConfigurationError extends Error {}
  return {
    R2ConfigurationError,
    R2ObjectStorage: class {
      constructor() {
        throw new R2ConfigurationError();
      }
    },
  };
});

import { getOperationalDiagnostics } from "@/lib/operations/diagnostics";

describe("operational diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw
      .mockResolvedValueOnce([
        {
          database: "portfolio_scope",
          schema: "public",
          hasReasoningTokens: true,
          databaseOid: "16384",
          serverAddress: "192.0.2.10",
          serverPort: 5432,
          serverVersionNumber: "170005",
          systemIdentifier: "7612345678901234567",
        },
      ])
      .mockResolvedValueOnce([{ bytes: BigInt(1024) }]);
    mocks.countFailedJobs.mockResolvedValue(0);
    mocks.countSupportedCompanies.mockResolvedValue(3);
    mocks.findLatestWorker.mockResolvedValue(null);
  });

  it("reports only read-only runtime database identity metadata", async () => {
    const diagnostics = await getOperationalDiagnostics();

    expect(diagnostics.databaseIdentity).toEqual({
      database: "portfolio_scope",
      schema: "public",
      hasReasoningTokens: true,
      databaseOid: "16384",
      serverAddress: "192.0.2.10",
      serverPort: 5432,
      serverVersionNumber: "170005",
      systemIdentifier: "7612345678901234567",
    });

    const identitySql = String.raw({ raw: mocks.queryRaw.mock.calls[0][0] })
      .replaceAll(/\s+/g, " ")
      .trim();
    expect(identitySql).toContain("SELECT current_database()");
    expect(identitySql).toContain("current_schema()");
    expect(identitySql).toContain("information_schema.columns");
    expect(identitySql).toContain("pg_control_system()");
    expect(identitySql).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i,
    );
  });
});
