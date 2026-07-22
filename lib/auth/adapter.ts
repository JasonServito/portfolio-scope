import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter } from "next-auth/adapters";

import { db } from "@/lib/db";

export function createAuthAdapter(): Adapter {
  const adapter = PrismaAdapter(db);
  const linkAccount = adapter.linkAccount;

  if (!linkAccount) {
    throw new Error("The configured authentication adapter cannot link accounts.");
  }

  return {
    ...adapter,
    async linkAccount(account) {
      const owner = await db.user.findUnique({
        where: { id: account.userId },
        select: { isDemo: true },
      });

      if (!owner || owner.isDemo) {
        throw new Error("This identity cannot be linked to an OAuth account.");
      }

      await linkAccount({
        userId: account.userId,
        type: account.type,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
      });
    },
  };
}
