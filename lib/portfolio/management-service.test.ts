import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  alertFindFirst: vi.fn(),
  alertFindMany: vi.fn(),
  alertUpdate: vi.fn(),
  holdingDelete: vi.fn(),
  holdingFindFirst: vi.fn(),
  portfolioCreate: vi.fn(),
  portfolioDelete: vi.fn(),
  portfolioFindFirst: vi.fn(),
  portfolioFindMany: vi.fn(),
  portfolioSnapshotCreateMany: vi.fn(),
  portfolioSnapshotDeleteMany: vi.fn(),
  portfolioUpdate: vi.fn(),
  researchJobFindFirst: vi.fn(),
  researchJobFindMany: vi.fn(),
  transaction: vi.fn(),
  userFindUnique: vi.fn(),
  watchlistItemCreate: vi.fn(),
  watchlistItemDelete: vi.fn(),
  watchlistItemFindFirst: vi.fn(),
  watchlistItemFindMany: vi.fn(),
  watchlistItemUpdate: vi.fn(),
}));

const tx = {
  alert: {
    findFirst: mocks.alertFindFirst,
    update: mocks.alertUpdate,
  },
  holding: {
    delete: mocks.holdingDelete,
    findFirst: mocks.holdingFindFirst,
  },
  portfolio: {
    create: mocks.portfolioCreate,
    delete: mocks.portfolioDelete,
    findFirst: mocks.portfolioFindFirst,
    update: mocks.portfolioUpdate,
  },
  portfolioSnapshot: {
    createMany: mocks.portfolioSnapshotCreateMany,
    deleteMany: mocks.portfolioSnapshotDeleteMany,
  },
  user: { findUnique: mocks.userFindUnique },
  watchlistItem: {
    create: mocks.watchlistItemCreate,
    delete: mocks.watchlistItemDelete,
    findFirst: mocks.watchlistItemFindFirst,
    update: mocks.watchlistItemUpdate,
  },
};

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mocks.transaction,
    alert: {
      findMany: mocks.alertFindMany,
    },
    portfolio: {
      findFirst: mocks.portfolioFindFirst,
      findMany: mocks.portfolioFindMany,
    },
    researchJob: {
      findFirst: mocks.researchJobFindFirst,
      findMany: mocks.researchJobFindMany,
    },
    user: { findUnique: mocks.userFindUnique },
    watchlistItem: {
      findMany: mocks.watchlistItemFindMany,
    },
  },
}));

import {
  AuthorizationErrorCode,
  type AuthorizationError,
} from "@/lib/auth/authorization";
import {
  listUserAlerts,
  updateAlertStatus,
} from "@/lib/portfolio/alerts-service";
import {
  createHolding,
  createPortfolio,
  createWatchlistItem,
  deleteHolding,
  deletePortfolio,
  deleteWatchlistItem,
  getPortfolio,
  listPortfolios,
  updatePortfolio,
  updateWatchlistItem,
} from "@/lib/portfolio/management";
import {
  getOwnedResearchJob,
  listResearchJobs,
} from "@/lib/research/orchestrator";

const actorId = "user-a";

function expectAuthorizationError(
  error: unknown,
  code: keyof typeof AuthorizationErrorCode,
  status: number,
) {
  expect(error).toMatchObject({
    code: AuthorizationErrorCode[code],
    status,
  });
}

describe("owner-scoped portfolio services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback(tx));
    mocks.userFindUnique.mockResolvedValue({ id: actorId, isDemo: false });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("updates a portfolio only after resolving the persisted actor and owner", async () => {
    mocks.portfolioFindFirst.mockResolvedValue({
      id: "portfolio-a",
      userId: actorId,
      user: { isDemo: false },
    });
    mocks.portfolioUpdate.mockResolvedValue({ id: "portfolio-a" });

    await expect(
      updatePortfolio(actorId, "portfolio-a", { name: "Long term" }),
    ).resolves.toEqual({ id: "portfolio-a" });

    expect(mocks.userFindUnique).toHaveBeenCalledWith({
      where: { id: actorId },
      select: { id: true, isDemo: true },
    });
    expect(mocks.portfolioFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "portfolio-a", userId: actorId },
      }),
    );
    expect(mocks.portfolioUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Long term" }),
        where: { id: "portfolio-a" },
      }),
    );
  });

  it.each([
    {
      expectedWhere: (id: string) => ({ id, userId: actorId }),
      invoke: (id: string) =>
        updateWatchlistItem(actorId, id, { notes: "Updated" }),
      label: "watchlist item update",
      mutation: mocks.watchlistItemUpdate,
      ownerQuery: mocks.watchlistItemFindFirst,
    },
    {
      expectedWhere: (id: string) => ({ id, userId: actorId }),
      invoke: (id: string) => deletePortfolio(actorId, id),
      label: "portfolio",
      mutation: mocks.portfolioDelete,
      ownerQuery: mocks.portfolioFindFirst,
    },
    {
      expectedWhere: (id: string) => ({
        id,
        portfolio: { userId: actorId },
      }),
      invoke: (id: string) => deleteHolding(actorId, id),
      label: "holding",
      mutation: mocks.holdingDelete,
      ownerQuery: mocks.holdingFindFirst,
    },
    {
      expectedWhere: (id: string) => ({ id, userId: actorId }),
      invoke: (id: string) => deleteWatchlistItem(actorId, id),
      label: "watchlist item",
      mutation: mocks.watchlistItemDelete,
      ownerQuery: mocks.watchlistItemFindFirst,
    },
    {
      expectedWhere: (id: string) => ({ id, userId: actorId }),
      invoke: (id: string) =>
        updateAlertStatus(actorId, id, { status: "RESOLVED" }),
      label: "alert",
      mutation: mocks.alertUpdate,
      ownerQuery: mocks.alertFindFirst,
    },
  ])(
    "uses one controlled 404 for foreign and missing $label mutations",
    async ({ expectedWhere, invoke, mutation, ownerQuery }) => {
      ownerQuery.mockResolvedValue(null);

      for (const resourceId of ["foreign-id", "missing-id"]) {
        await invoke(resourceId).then(
          () => expect.unreachable("Expected an ownership failure."),
          (error: AuthorizationError) => {
            expectAuthorizationError(error, "RESOURCE_NOT_FOUND", 404);
            expect(error.message).toBe("The requested resource was not found.");
          },
        );
      }

      expect(mutation).not.toHaveBeenCalled();
      expect(ownerQuery).toHaveBeenCalledTimes(2);
      expect(ownerQuery).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining(expectedWhere("foreign-id")),
        }),
      );
      expect(ownerQuery).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining(expectedWhere("missing-id")),
        }),
      );
    },
  );

  it("updates watchlist details only after resolving the persisted owner", async () => {
    mocks.watchlistItemFindFirst.mockResolvedValue({
      id: "watch-a",
      userId: actorId,
      user: { isDemo: false },
    });
    mocks.watchlistItemUpdate.mockResolvedValue({ id: "watch-a" });

    await expect(
      updateWatchlistItem(actorId, "watch-a", {
        notes: "",
        targetPrice: "",
      }),
    ).resolves.toEqual({ id: "watch-a" });

    expect(mocks.watchlistItemFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "watch-a", userId: actorId } }),
    );
    expect(mocks.watchlistItemUpdate).toHaveBeenCalledWith({
      where: { id: "watch-a" },
      data: { notes: null, targetPrice: null },
    });
  });

  it.each([
    {
      input: {
        baseCurrency: "USD",
        name: "Forged portfolio",
        userId: "user-b",
      },
      invoke: (input: unknown) => createPortfolio(actorId, input),
      label: "portfolio",
    },
    {
      input: {
        averageCost: 100,
        portfolioId: "portfolio-a",
        shares: 2,
        ticker: "AAPL",
        userId: "user-b",
      },
      invoke: (input: unknown) => createHolding(actorId, input),
      label: "holding",
    },
    {
      input: { ticker: "COST", userId: "user-b" },
      invoke: (input: unknown) => createWatchlistItem(actorId, input),
      label: "watchlist item",
    },
  ])(
    "rejects a client-supplied userId when creating a $label",
    async ({ input, invoke }) => {
      await expect(invoke(input)).rejects.toMatchObject({
        message: expect.stringContaining("userId"),
        status: 400,
      });
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );

  it.each(["development", "test", "production"])(
    "rejects a persisted demo actor in NODE_ENV=%s",
    async (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      mocks.userFindUnique.mockResolvedValue({
        id: "demo-user",
        isDemo: true,
      });

      await createPortfolio("demo-user", {
        baseCurrency: "USD",
        name: "Blocked demo write",
      }).then(
        () => expect.unreachable("Expected the demo guard to reject."),
        (error: AuthorizationError) => {
          expectAuthorizationError(error, "DEMO_READ_ONLY", 403);
          expect(error.message).toBe("The public demo is read-only.");
        },
      );
      expect(mocks.portfolioCreate).not.toHaveBeenCalled();
    },
  );

  it("scopes portfolio lists and reads to the authenticated actor", async () => {
    mocks.portfolioFindMany.mockResolvedValue([{ id: "portfolio-a" }]);
    mocks.portfolioFindFirst.mockResolvedValue({ id: "portfolio-a" });

    await expect(listPortfolios(actorId)).resolves.toEqual([
      { id: "portfolio-a" },
    ]);
    await expect(getPortfolio(actorId, "portfolio-a")).resolves.toEqual({
      id: "portfolio-a",
    });

    expect(mocks.portfolioFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: actorId } }),
    );
    expect(mocks.portfolioFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "portfolio-a", userId: actorId },
      }),
    );
  });

  it.each(["foreign-portfolio", "missing-portfolio"])(
    "does not distinguish %s at the portfolio read boundary",
    async (portfolioId) => {
      mocks.portfolioFindFirst.mockResolvedValue(null);

      await expect(getPortfolio(actorId, portfolioId)).resolves.toBeNull();
      expect(mocks.portfolioFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: portfolioId, userId: actorId },
        }),
      );
    },
  );
});

describe("private alerts and research services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback(tx));
    mocks.userFindUnique.mockResolvedValue({ id: actorId, isDemo: false });
  });

  it("lists and updates alerts within the authenticated owner scope", async () => {
    mocks.alertFindMany.mockResolvedValue([{ id: "alert-a" }]);
    mocks.alertFindFirst.mockResolvedValue({
      id: "alert-a",
      userId: actorId,
      user: { isDemo: false },
    });
    mocks.alertUpdate.mockResolvedValue({
      id: "alert-a",
      status: "RESOLVED",
    });

    await expect(listUserAlerts(actorId)).resolves.toEqual([{ id: "alert-a" }]);
    await expect(
      updateAlertStatus(actorId, "alert-a", { status: "RESOLVED" }),
    ).resolves.toEqual({ id: "alert-a", status: "RESOLVED" });

    expect(mocks.alertFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: actorId }),
      }),
    );
    expect(mocks.alertFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "alert-a", userId: actorId }),
      }),
    );
  });

  it("keeps existing alerts available when target reconciliation fails", async () => {
    mocks.watchlistItemFindMany.mockRejectedValue(
      new Error("cached price read failed"),
    );
    mocks.alertFindMany.mockResolvedValue([{ id: "alert-a" }]);

    await expect(listUserAlerts(actorId)).resolves.toEqual([{ id: "alert-a" }]);
    expect(mocks.alertFindMany).toHaveBeenCalled();
  });

  it("returns an owned research job together with its private report", async () => {
    mocks.researchJobFindFirst.mockResolvedValue({
      agentRuns: [],
      completedAt: new Date("2026-07-15T02:00:00.000Z"),
      createdAt: new Date("2026-07-15T01:00:00.000Z"),
      id: "job-a",
      report: {
        bearCaseJson: ["Execution risk"],
        bullCaseJson: ["Durable demand"],
        confidence: { toNumber: () => 0.8 },
        expiresAt: new Date("2026-08-14T02:00:00.000Z"),
        generatedAt: new Date("2026-07-15T02:00:00.000Z"),
        missingDataJson: [],
        overview: "Private owner report.",
        risksJson: ["Concentration"],
      },
      status: "COMPLETED",
      stock: { companyName: "Apple Inc.", ticker: "AAPL" },
    });

    await expect(getOwnedResearchJob(actorId, "job-a")).resolves.toMatchObject({
      id: "job-a",
      research: {
        jobId: "job-a",
        report: { overview: "Private owner report." },
      },
      status: "COMPLETED",
      ticker: "AAPL",
    });
    expect(mocks.researchJobFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-a", userId: actorId },
        include: expect.objectContaining({
          stock: true,
          agentRuns: true,
          report: expect.any(Object),
        }),
      }),
    );
  });

  it("keeps private research history scoped to the authenticated owner", async () => {
    mocks.researchJobFindMany.mockResolvedValue([{ id: "job-a" }]);

    await expect(listResearchJobs(actorId)).resolves.toEqual([{ id: "job-a" }]);
    expect(mocks.researchJobFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: actorId } }),
    );
  });

  it.each(["foreign-job", "missing-job"])(
    "does not distinguish %s at the private research boundary",
    async (jobId) => {
      mocks.researchJobFindFirst.mockResolvedValue(null);

      await expect(getOwnedResearchJob(actorId, jobId)).resolves.toBeNull();
      expect(mocks.researchJobFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: jobId, userId: actorId } }),
      );
    },
  );
});
