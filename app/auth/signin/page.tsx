import type { Metadata } from "next";
import Link from "next/link";
import { Code2, FlaskConical, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import {
  signInWithLocalDisposable,
  signInWithProvider,
} from "@/app/auth/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isAuthProviderConfigured } from "@/lib/auth/providers";
import { isLocalDisposableAuthAvailable } from "@/lib/auth/local-disposable";
import { getSafeRedirectPath } from "@/lib/auth/redirects";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Sign in" };

type SignInPageProps = {
  searchParams?: Promise<{
    callbackUrl?: string | string[];
    error?: string | string[];
    notice?: string | string[];
  }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const user = await getCurrentUser();
  if (user) redirect("/app");

  const params = await searchParams;
  const callbackValue = Array.isArray(params?.callbackUrl)
    ? params.callbackUrl[0]
    : params?.callbackUrl;
  const callbackUrl = getSafeRedirectPath(callbackValue);
  const error = Array.isArray(params?.error) ? params.error[0] : params?.error;
  const notice = Array.isArray(params?.notice)
    ? params.notice[0]
    : params?.notice;
  const githubConfigured = isAuthProviderConfigured("github");
  const googleConfigured = isAuthProviderConfigured("google");
  const localDisposableAuthAvailable = isLocalDisposableAuthAvailable();

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-12">
      <div className="w-full max-w-md space-y-4">
        <Link className="inline-flex items-center gap-2 text-sm font-semibold" href="/">
          <span className="size-3 rounded-full bg-emerald-500" />
          PortfolioScope
        </Link>

        {notice === "sessions-revoked" ? (
          <Alert>
            <ShieldCheck className="size-4" />
            <AlertTitle>All sessions were revoked</AlertTitle>
            <AlertDescription>
              Sign in again to create a new database-backed session.
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Sign-in was not completed</AlertTitle>
            <AlertDescription>
              The provider returned a controlled authentication error. Try again
              or continue with the demo.
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Sign in to PortfolioScope</CardTitle>
            <CardDescription>
              {localDisposableAuthAvailable
                ? "Use a trusted OAuth provider or the guarded local validation identity."
                : "Use a trusted OAuth provider. PortfolioScope never receives or stores your provider password."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ProviderForm
              callbackUrl={callbackUrl}
              configured={githubConfigured}
              icon={<Code2 className="size-4" />}
              label="Continue with GitHub"
              provider="github"
            />
            <ProviderForm
              callbackUrl={callbackUrl}
              configured={googleConfigured}
              icon={<span aria-hidden="true" className="text-sm font-semibold">G</span>}
              label="Continue with Google"
              provider="google"
            />

            {localDisposableAuthAvailable ? (
              <form action={signInWithLocalDisposable}>
                <input name="callbackUrl" type="hidden" value={callbackUrl} />
                <Button className="w-full" size="lg" type="submit" variant="outline">
                  <FlaskConical className="size-4" />
                  Create or reuse local validation identity
                </Button>
              </form>
            ) : null}

            {!githubConfigured || !googleConfigured ? (
              <p className="text-xs leading-5 text-muted-foreground">
                One or more OAuth providers are not configured in this
                environment. The recruiter demo remains available without sign-in.
              </p>
            ) : null}

            <div className="pt-2">
              <Link
                className={buttonVariants({ variant: "secondary", className: "w-full" })}
                href="/demo"
              >
                Continue with the read-only demo
              </Link>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs leading-5 text-muted-foreground">
          New identities receive the server-controlled USER role. Accounts that
          share an email are not merged automatically when signed out.
        </p>
        {localDisposableAuthAvailable ? (
          <p className="text-xs leading-5 text-muted-foreground">
            Local validation creates one disposable, non-demo USER. Administrator
            access still requires a trusted database update.
          </p>
        ) : null}
      </div>
    </main>
  );
}

function ProviderForm({
  callbackUrl,
  configured,
  icon,
  label,
  provider,
}: {
  callbackUrl: string;
  configured: boolean;
  icon: React.ReactNode;
  label: string;
  provider: "github" | "google";
}) {
  const action = signInWithProvider.bind(null, provider);

  return (
    <form action={action}>
      <input name="callbackUrl" type="hidden" value={callbackUrl} />
      <Button className="w-full" disabled={!configured} size="lg" type="submit" variant="outline">
        {icon}
        {label}
      </Button>
    </form>
  );
}
