import type { Prisma } from "@prisma/client";
import type { Session } from "next-auth";

import { db } from "@/lib/db";
import { demoReadOnlyMessage } from "@/lib/demo";

export const AuthorizationErrorCode = {
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  ADMIN_REQUIRED: "ADMIN_REQUIRED",
  DEMO_READ_ONLY: "DEMO_READ_ONLY",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
} as const;

export type AuthorizationErrorCode =
  (typeof AuthorizationErrorCode)[keyof typeof AuthorizationErrorCode];

type AuthorizationStatus = 401 | 403 | 404;

const authorizationErrors = {
  [AuthorizationErrorCode.AUTHENTICATION_REQUIRED]: {
    status: 401,
    message: "Authentication is required.",
  },
  [AuthorizationErrorCode.ADMIN_REQUIRED]: {
    status: 403,
    message: "Administrator access is required.",
  },
  [AuthorizationErrorCode.DEMO_READ_ONLY]: {
    status: 403,
    message: demoReadOnlyMessage,
  },
  [AuthorizationErrorCode.RESOURCE_NOT_FOUND]: {
    status: 404,
    message: "The requested resource was not found.",
  },
} satisfies Record<
  AuthorizationErrorCode,
  { status: AuthorizationStatus; message: string }
>;

export class AuthorizationError extends Error {
  readonly name = "AuthorizationError";
  readonly status: AuthorizationStatus;

  constructor(public readonly code: AuthorizationErrorCode) {
    const definition = authorizationErrors[code];
    super(definition.message);
    this.status = definition.status;
  }
}

export async function requireApiUser(): Promise<Session["user"]> {
  // Keep Auth.js out of data-service module initialization. This also lets
  // authorization services run in database-only integration tests.
  const { getCurrentUser } = await import("@/lib/auth/session");
  const user = await getCurrentUser();

  if (!user) {
    throw new AuthorizationError(
      AuthorizationErrorCode.AUTHENTICATION_REQUIRED,
    );
  }

  return user;
}

export async function requireApiAdmin(): Promise<Session["user"]> {
  const user = await requireApiUser();

  if (user.role !== "ADMIN") {
    throw new AuthorizationError(AuthorizationErrorCode.ADMIN_REQUIRED);
  }

  return user;
}

export function assertMutableUser<T extends { isDemo: boolean }>(user: T): T {
  if (user.isDemo) {
    throw new AuthorizationError(AuthorizationErrorCode.DEMO_READ_ONLY);
  }

  return user;
}

export async function requireMutableUser(
  userId: string,
  client: Prisma.TransactionClient = db,
) {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { id: true, isDemo: true },
  });

  if (!user) {
    throw new AuthorizationError(
      AuthorizationErrorCode.AUTHENTICATION_REQUIRED,
    );
  }

  return assertMutableUser(user);
}

async function requireFound<T>(resource: T | null): Promise<T> {
  if (!resource) {
    throw new AuthorizationError(AuthorizationErrorCode.RESOURCE_NOT_FOUND);
  }

  return resource;
}

export async function requireOwnedPortfolio(
  userId: string,
  portfolioId: string,
  client: Prisma.TransactionClient = db,
) {
  return requireFound(
    await client.portfolio.findFirst({
      where: { id: portfolioId, userId },
      select: {
        id: true,
        userId: true,
        user: { select: { isDemo: true } },
      },
    }),
  );
}

export async function requireOwnedHolding(
  userId: string,
  holdingId: string,
  client: Prisma.TransactionClient = db,
) {
  return requireFound(
    await client.holding.findFirst({
      where: { id: holdingId, portfolio: { userId } },
      select: {
        id: true,
        portfolioId: true,
        stockId: true,
        portfolio: {
          select: { user: { select: { isDemo: true } } },
        },
      },
    }),
  );
}

export async function requireOwnedWatchlistItem(
  userId: string,
  watchlistItemId: string,
  client: Prisma.TransactionClient = db,
) {
  return requireFound(
    await client.watchlistItem.findFirst({
      where: { id: watchlistItemId, userId },
      select: {
        id: true,
        userId: true,
        user: { select: { isDemo: true } },
      },
    }),
  );
}

export async function requireOwnedAlert(
  userId: string,
  alertId: string,
  client: Prisma.TransactionClient = db,
) {
  return requireFound(
    await client.alert.findFirst({
      where: {
        id: alertId,
        userId,
        OR: [{ portfolioId: null }, { portfolio: { userId } }],
      },
      select: {
        id: true,
        userId: true,
        user: { select: { isDemo: true } },
      },
    }),
  );
}

export async function requireOwnedResearchJob(
  userId: string,
  researchJobId: string,
  client: Prisma.TransactionClient = db,
) {
  return requireFound(
    await client.researchJob.findFirst({
      where: { id: researchJobId, userId },
      select: {
        id: true,
        userId: true,
        stockId: true,
        status: true,
        user: { select: { isDemo: true } },
      },
    }),
  );
}

export async function requireOwnedResearchReport(
  userId: string,
  researchReportId: string,
  client: Prisma.TransactionClient = db,
) {
  return requireFound(
    await client.researchReport.findFirst({
      where: { id: researchReportId, researchJob: { userId } },
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
    }),
  );
}
