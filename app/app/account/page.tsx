import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyRound, Link2, ShieldAlert, Trash2 } from "lucide-react";

import {
  deleteAccountAction,
  revokeAllSessionsAction,
} from "@/app/auth/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAccountOverview } from "@/lib/auth/account-service";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Account settings" };

type AccountPageProps = {
  searchParams?: Promise<{ error?: string | string[] }>;
};

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const user = await requireUser("/app/account");
  const account = await getAccountOverview(user.id);
  if (!account) redirect("/auth/signin");

  const params = await searchParams;
  const error = Array.isArray(params?.error) ? params.error[0] : params?.error;

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-6 py-10">
      <div>
        <p className="text-sm font-medium text-muted-foreground">
          Identity and privacy
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Account settings</h1>
        <p className="mt-2 leading-7 text-muted-foreground">
          Review your profile and sign-in methods, sign out active sessions, or
          permanently remove your account and portfolio data.
        </p>
      </div>

      {error === "confirmation" ? (
        <Alert variant="destructive">
          <AlertTitle>Confirmation did not match</AlertTitle>
          <AlertDescription>
            Enter DELETE exactly before submitting.
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
            <CardDescription>Your basic account information.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Name
              </p>
              <p className="mt-1 font-medium">
                {account.name ?? "Not provided"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Email
              </p>
              <p className="mt-1 break-all font-medium">
                {account.email ?? "Not provided"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{account.role}</Badge>
              <span className="text-xs text-muted-foreground">
                Account role
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Link2 className="size-5 text-muted-foreground" />
            <CardTitle>Linked providers</CardTitle>
            <CardDescription>
              Sign-in methods connected to your account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {account.accounts.length ? (
                account.accounts.map(({ provider }) => (
                  <Badge key={provider} variant="secondary">
                    {provider === "github"
                      ? "GitHub"
                      : provider === "google"
                        ? "Google"
                        : provider}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">
                  No provider record is available.
                </span>
              )}
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              Use the same provider you originally chose when you return to
              PortfolioScope.
            </p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <KeyRound className="size-5 text-muted-foreground" />
          <CardTitle>Session revocation</CardTitle>
          <CardDescription>
            {account._count.sessions} active{" "}
            {account._count.sessions === 1 ? "session" : "sessions"}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={revokeAllSessionsAction}>
            <Button type="submit" variant="outline">
              Sign out every session
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border border-destructive/30">
        <CardHeader>
          <ShieldAlert className="size-5 text-destructive" />
          <CardTitle>Delete account</CardTitle>
          <CardDescription>
            This permanently deletes your account, portfolios, watchlist items,
            alerts, and saved research. Shared public stock information remains.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={deleteAccountAction} className="space-y-3">
            <label className="block text-sm font-medium" htmlFor="confirmation">
              Enter DELETE to confirm
            </label>
            <input
              autoComplete="off"
              className="h-10 w-full max-w-sm rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              id="confirmation"
              name="confirmation"
              required
            />
            <div>
              <Button type="submit" variant="destructive">
                <Trash2 className="size-4" />
                Permanently delete account
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
