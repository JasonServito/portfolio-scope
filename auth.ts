import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

import { createAuthAdapter } from "@/lib/auth/adapter";
import { isOAuthSignInAllowed } from "@/lib/auth/policy";

const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60;
const ONE_DAY_IN_SECONDS = 24 * 60 * 60;

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: createAuthAdapter(),
  providers: [GitHub, Google],
  session: {
    strategy: "database",
    maxAge: THIRTY_DAYS_IN_SECONDS,
    updateAge: ONE_DAY_IN_SECONDS,
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  callbacks: {
    signIn({ account, profile, user }) {
      return isOAuthSignInAllowed({
        email: user.email,
        emailVerified: profile?.email_verified,
        provider: account?.provider,
      });
    },
    session({ session, user }) {
      session.user.id = user.id;
      session.user.role = user.role;
      return session;
    },
  },
});
