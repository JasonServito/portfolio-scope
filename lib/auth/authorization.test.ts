import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  alertFindFirst: vi.fn(),
  getCurrentUser: vi.fn(),
  holdingFindFirst: vi.fn(),
  portfolioFindFirst: vi.fn(),
  redirect: vi.fn(),
  researchJobFindFirst: vi.fn(),
  researchReportFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  watchlistItemFindFirst: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/db", () => ({
  db: {
    alert: { findFirst: mocks.alertFindFirst },
    holding: { findFirst: mocks.holdingFindFirst },
    portfolio: { findFirst: mocks.portfolioFindFirst },
    researchJob: { findFirst: mocks.researchJobFindFirst },
    researchReport: { findFirst: mocks.researchReportFindFirst },
    user: { findUnique: mocks.userFindUnique },
    watchlistItem: { findFirst: mocks.watchlistItemFindFirst },
  },
}));

import {
  assertMutableUser,
  AuthorizationError,
  AuthorizationErrorCode,
  requireApiAdmin,
  requireApiUser,
  requireMutableUser,
  requireOwnedAlert,
  requireOwnedHolding,
  requireOwnedPortfolio,
  requireOwnedResearchJob,
  requireOwnedResearchReport,
  requireOwnedWatchlistItem,
} from "@/lib/auth/authorization";

const standardUser = {
  id: "user-1",
  role: "USER" as const,
  name: "Portfolio User",
  email: "user@example.com",
  image: null,
};

const adminUser = {
  ...standardUser,
  id: "admin-1",
  role: "ADMIN" as const,
};

type OwnerRequirement = (
  userId: string,
  resourceId: string,
) => Promise<unknown>;

function expectedError(code: AuthorizationErrorCode) {
  return new AuthorizationError(code);
}

describe("API authorization requirements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a controlled 401 without redirecting anonymous API callers", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    await expect(requireApiUser()).rejects.toEqual(
      expectedError(AuthorizationErrorCode.AUTHENTICATION_REQUIRED),
    );
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("returns the authenticated API user", async () => {
    mocks.getCurrentUser.mockResolvedValue(standardUser);

    await expect(requireApiUser()).resolves.toEqual(standardUser);
  });

  it("preserves the anonymous 401 at the admin boundary", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    await expect(requireApiAdmin()).rejects.toMatchObject({
      code: AuthorizationErrorCode.AUTHENTICATION_REQUIRED,
      status: 401,
    });
  });

  it("returns a controlled 403 for a standard user at the admin boundary", async () => {
    mocks.getCurrentUser.mockResolvedValue(standardUser);

    await expect(requireApiAdmin()).rejects.toEqual(
      expectedError(AuthorizationErrorCode.ADMIN_REQUIRED),
    );
  });

  it("accepts an authenticated administrator", async () => {
    mocks.getCurrentUser.mockResolvedValue(adminUser);

    await expect(requireApiAdmin()).resolves.toEqual(adminUser);
  });
});

describe("demo mutation guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a persisted non-demo user", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "user-1", isDemo: false });

    await expect(requireMutableUser("user-1")).resolves.toEqual({
      id: "user-1",
      isDemo: false,
    });
    expect(mocks.userFindUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { id: true, isDemo: true },
    });
  });

  it("returns a controlled 403 for a persisted demo user", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "demo-user", isDemo: true });

    await expect(requireMutableUser("demo-user")).rejects.toMatchObject({
      code: AuthorizationErrorCode.DEMO_READ_ONLY,
      message: "The public demo is read-only.",
      status: 403,
    });
  });

  it("treats a stale user identity as unauthenticated", async () => {
    mocks.userFindUnique.mockResolvedValue(null);

    await expect(requireMutableUser("deleted-user")).rejects.toMatchObject({
      code: AuthorizationErrorCode.AUTHENTICATION_REQUIRED,
      status: 401,
    });
  });

  it("guards an owner marker already loaded in a transaction", () => {
    expect(assertMutableUser({ isDemo: false, userId: "user-1" })).toEqual({
      isDemo: false,
      userId: "user-1",
    });
    expect(() => assertMutableUser({ isDemo: true })).toThrowError(
      expectedError(AuthorizationErrorCode.DEMO_READ_ONLY),
    );
  });

  it("uses a supplied transaction client instead of the default database", async () => {
    const transactionFindUnique = vi
      .fn()
      .mockResolvedValue({ id: "user-2", isDemo: false });
    const transactionClient = {
      user: { findUnique: transactionFindUnique },
    } as unknown as Prisma.TransactionClient;

    await expect(
      requireMutableUser("user-2", transactionClient),
    ).resolves.toEqual({ id: "user-2", isDemo: false });
    expect(transactionFindUnique).toHaveBeenCalledOnce();
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });
});

describe("owner-scoped resource requirements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes portfolios directly to the authenticated owner", async () => {
    const portfolio = {
      id: "portfolio-1",
      userId: "user-1",
      user: { isDemo: false },
    };
    mocks.portfolioFindFirst.mockResolvedValue(portfolio);

    await expect(
      requireOwnedPortfolio("user-1", "portfolio-1"),
    ).resolves.toEqual(portfolio);
    expect(mocks.portfolioFindFirst).toHaveBeenCalledWith({
      where: { id: "portfolio-1", userId: "user-1" },
      select: {
        id: true,
        userId: true,
        user: { select: { isDemo: true } },
      },
    });
  });

  it("scopes holdings through their portfolio owner", async () => {
    const holding = {
      id: "holding-1",
      portfolioId: "portfolio-1",
      stockId: "stock-1",
      portfolio: { user: { isDemo: false } },
    };
    mocks.holdingFindFirst.mockResolvedValue(holding);

    await expect(requireOwnedHolding("user-1", "holding-1")).resolves.toEqual(
      holding,
    );
    expect(mocks.holdingFindFirst).toHaveBeenCalledWith({
      where: { id: "holding-1", portfolio: { userId: "user-1" } },
      select: {
        id: true,
        portfolioId: true,
        stockId: true,
        portfolio: {
          select: { user: { select: { isDemo: true } } },
        },
      },
    });
  });

  it("scopes flat watchlist items directly to their owner", async () => {
    const item = {
      id: "watchlist-1",
      userId: "user-1",
      user: { isDemo: false },
    };
    mocks.watchlistItemFindFirst.mockResolvedValue(item);

    await expect(
      requireOwnedWatchlistItem("user-1", "watchlist-1"),
    ).resolves.toEqual(item);
    expect(mocks.watchlistItemFindFirst).toHaveBeenCalledWith({
      where: { id: "watchlist-1", userId: "user-1" },
      select: {
        id: true,
        userId: true,
        user: { select: { isDemo: true } },
      },
    });
  });

  it("scopes alerts directly to their owner", async () => {
    const alert = {
      id: "alert-1",
      userId: "user-1",
      user: { isDemo: false },
    };
    mocks.alertFindFirst.mockResolvedValue(alert);

    await expect(requireOwnedAlert("user-1", "alert-1")).resolves.toEqual(
      alert,
    );
    expect(mocks.alertFindFirst).toHaveBeenCalledWith({
      where: {
        id: "alert-1",
        userId: "user-1",
        OR: [{ portfolioId: null }, { portfolio: { userId: "user-1" } }],
      },
      select: {
        id: true,
        userId: true,
        user: { select: { isDemo: true } },
      },
    });
  });

  it("scopes research jobs directly to their owner", async () => {
    const job = {
      id: "job-1",
      userId: "user-1",
      stockId: "stock-1",
      status: "COMPLETED",
      user: { isDemo: false },
    };
    mocks.researchJobFindFirst.mockResolvedValue(job);

    await expect(requireOwnedResearchJob("user-1", "job-1")).resolves.toEqual(
      job,
    );
    expect(mocks.researchJobFindFirst).toHaveBeenCalledWith({
      where: { id: "job-1", userId: "user-1" },
      select: {
        id: true,
        userId: true,
        stockId: true,
        status: true,
        user: { select: { isDemo: true } },
      },
    });
  });

  it("scopes research reports through their research-job owner", async () => {
    const report = {
      id: "report-1",
      researchJobId: "job-1",
      stockId: "stock-1",
      researchJob: { userId: "user-1", user: { isDemo: false } },
    };
    mocks.researchReportFindFirst.mockResolvedValue(report);

    await expect(
      requireOwnedResearchReport("user-1", "report-1"),
    ).resolves.toEqual(report);
    expect(mocks.researchReportFindFirst).toHaveBeenCalledWith({
      where: { id: "report-1", researchJob: { userId: "user-1" } },
      select: {
        id: true,
        researchJobId: true,
        stockId: true,
        researchJob: {
          select: {
            userId: true,
            user: { select: { isDemo: true } },
          },
        },
      },
    });
  });

  it("returns the persisted owner marker for transactional demo protection", async () => {
    mocks.holdingFindFirst.mockResolvedValue({
      id: "demo-holding",
      portfolioId: "demo-portfolio",
      stockId: "stock-1",
      portfolio: { user: { isDemo: true } },
    });

    const holding = await requireOwnedHolding("demo-user", "demo-holding");

    expect(() => assertMutableUser(holding.portfolio.user)).toThrowError(
      expectedError(AuthorizationErrorCode.DEMO_READ_ONLY),
    );
  });

  it.each<{
    label: string;
    query: ReturnType<typeof vi.fn>;
    requireOwned: OwnerRequirement;
  }>([
    {
      label: "portfolio",
      query: mocks.portfolioFindFirst,
      requireOwned: requireOwnedPortfolio,
    },
    {
      label: "holding",
      query: mocks.holdingFindFirst,
      requireOwned: requireOwnedHolding,
    },
    {
      label: "watchlist item",
      query: mocks.watchlistItemFindFirst,
      requireOwned: requireOwnedWatchlistItem,
    },
    {
      label: "alert",
      query: mocks.alertFindFirst,
      requireOwned: requireOwnedAlert,
    },
    {
      label: "research job",
      query: mocks.researchJobFindFirst,
      requireOwned: requireOwnedResearchJob,
    },
    {
      label: "research report",
      query: mocks.researchReportFindFirst,
      requireOwned: requireOwnedResearchReport,
    },
  ])(
    "uses the same controlled 404 for missing and foreign $label records",
    async ({ query, requireOwned }) => {
      query.mockResolvedValue(null);

      await expect(requireOwned("user-1", "missing-id")).rejects.toEqual(
        expectedError(AuthorizationErrorCode.RESOURCE_NOT_FOUND),
      );
      await expect(requireOwned("user-1", "foreign-id")).rejects.toMatchObject({
        code: AuthorizationErrorCode.RESOURCE_NOT_FOUND,
        message: "The requested resource was not found.",
        status: 404,
      });
    },
  );

  it("does not let an administrator bypass private ownership", async () => {
    mocks.getCurrentUser.mockResolvedValue(adminUser);
    mocks.portfolioFindFirst.mockResolvedValue(null);

    const admin = await requireApiAdmin();
    await expect(
      requireOwnedPortfolio(admin.id, "other-users-portfolio"),
    ).rejects.toMatchObject({
      code: AuthorizationErrorCode.RESOURCE_NOT_FOUND,
      status: 404,
    });
    expect(mocks.portfolioFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "other-users-portfolio", userId: "admin-1" },
      }),
    );
  });

  it("uses a supplied transaction client for an owner-scoped query", async () => {
    const portfolio = {
      id: "portfolio-2",
      userId: "user-2",
      user: { isDemo: false },
    };
    const transactionFindFirst = vi.fn().mockResolvedValue(portfolio);
    const transactionClient = {
      portfolio: { findFirst: transactionFindFirst },
    } as unknown as Prisma.TransactionClient;

    await expect(
      requireOwnedPortfolio("user-2", "portfolio-2", transactionClient),
    ).resolves.toEqual(portfolio);
    expect(transactionFindFirst).toHaveBeenCalledOnce();
    expect(mocks.portfolioFindFirst).not.toHaveBeenCalled();
  });
});
