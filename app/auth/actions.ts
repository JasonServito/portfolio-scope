"use server";

import { AuthError } from "next-auth";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { signIn, signOut } from "@/auth";
import {
  assertAccountDeletionAllowed,
  deleteUserAccount,
  revokeAllUserSessions,
} from "@/lib/auth/account-service";
import {
  isAuthProviderConfigured,
  isAuthProviderId,
} from "@/lib/auth/providers";
import {
  createLocalDisposableDatabaseSession,
  isLocalDisposableAuthRequestAllowed,
} from "@/lib/auth/local-disposable";
import { getSafeRedirectPath } from "@/lib/auth/redirects";
import { requireUser } from "@/lib/auth/session";

export async function signInWithProvider(
  provider: string,
  formData: FormData,
) {
  if (!isAuthProviderId(provider)) {
    redirect("/auth/error?error=InvalidProvider");
  }

  if (!isAuthProviderConfigured(provider)) {
    redirect("/auth/error?error=Configuration");
  }

  const redirectTo = getSafeRedirectPath(formData.get("callbackUrl"));

  try {
    await signIn(provider, { redirectTo });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/auth/error?error=${encodeURIComponent(error.type)}`);
    }

    throw error;
  }
}

export async function signInWithLocalDisposable(formData: FormData) {
  if (!isLocalDisposableAuthRequestAllowed(await headers())) {
    redirect("/auth/error?error=Configuration");
  }

  const redirectTo = getSafeRedirectPath(formData.get("callbackUrl"));

  try {
    const session = await createLocalDisposableDatabaseSession();
    const cookieStore = await cookies();
    cookieStore.set("authjs.session-token", session.sessionToken, {
      expires: session.expires,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: false,
    });
  } catch {
    console.error("Local disposable sign-in failed.");
    redirect("/auth/error?error=LocalDisposableSignIn");
  }

  redirect(redirectTo);
}

export async function signOutCurrentSession() {
  try {
    await signOut({ redirectTo: "/" });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/auth/error?error=${encodeURIComponent(error.type)}`);
    }

    throw error;
  }
}

export async function revokeAllSessionsAction() {
  const user = await requireUser("/app/account");

  try {
    await signOut({ redirect: false });
    await revokeAllUserSessions(user.id);
  } catch {
    console.error("Account session revocation failed.");
    redirect("/auth/error?error=SessionRevocation");
  }

  redirect("/auth/signin?notice=sessions-revoked");
}

export async function deleteAccountAction(formData: FormData) {
  const user = await requireUser("/app/account");

  if (formData.get("confirmation") !== "DELETE") {
    redirect("/app/account?error=confirmation");
  }

  try {
    await assertAccountDeletionAllowed(user.id);
    await signOut({ redirect: false });
    await deleteUserAccount(user.id);
  } catch {
    console.error("Account deletion failed.");
    redirect("/auth/error?error=AccountDeletion");
  }

  redirect("/?accountDeleted=true");
}
