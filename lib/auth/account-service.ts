import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

export class AccountLifecycleError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "DEMO_ACCOUNT",
  ) {
    super(message);
  }
}

export async function getAccountOverview(userId: string) {
  return db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      createdAt: true,
      accounts: {
        select: { provider: true },
        orderBy: { provider: "asc" },
      },
      _count: {
        select: { sessions: true },
      },
    },
  });
}

export async function assertAccountDeletionAllowed(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { isDemo: true },
  });

  assertDeletableUser(user);
}

export async function revokeAllUserSessions(userId: string) {
  return db.session.deleteMany({ where: { userId } });
}

export async function deleteUserAccount(userId: string) {
  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { isDemo: true },
      });
      assertDeletableUser(user);
      return tx.user.delete({ where: { id: userId } });
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      throw new AccountLifecycleError("Account was not found.", "NOT_FOUND");
    }

    throw error;
  }
}

function assertDeletableUser(user: { isDemo: boolean } | null) {
  if (!user) {
    throw new AccountLifecycleError("Account was not found.", "NOT_FOUND");
  }

  if (user.isDemo) {
    throw new AccountLifecycleError(
      "The public demo identity cannot be deleted.",
      "DEMO_ACCOUNT",
    );
  }
}
