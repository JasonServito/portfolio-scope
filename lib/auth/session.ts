import type { Session } from "next-auth";
import { redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "@/auth";

export const getCurrentUser = cache(async function getCurrentUser() {
  try {
    const session = await auth();
    return session?.user?.id ? session.user : null;
  } catch (error) {
    if (isAuthFailure(error)) {
      if (error.type !== "MissingSecret") {
        console.error("Authentication session lookup failed.");
      }
      return null;
    }

    throw error;
  }
});

export async function requireUser(callbackUrl = "/app") {
  const user = await getCurrentUser();

  if (!user) {
    const query = new URLSearchParams({ callbackUrl });
    redirect(`/auth/signin?${query.toString()}`);
  }

  return user;
}

export async function requireAdmin(callbackUrl = "/admin") {
  const user = await requireUser(callbackUrl);

  if (user.role !== "ADMIN") {
    redirect("/auth/denied");
  }

  return user;
}

export function isAdminSession(session: Session | null) {
  return session?.user?.role === "ADMIN";
}

function isAuthFailure(error: unknown): error is Error & { type: string } {
  return (
    error instanceof Error &&
    "type" in error &&
    typeof (error as { type?: unknown }).type === "string"
  );
}
