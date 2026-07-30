import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthErrorContent } from "@/lib/auth/errors";

export const metadata: Metadata = { title: "Authentication error" };

type AuthErrorPageProps = {
  searchParams?: Promise<{ error?: string | string[] }>;
};

export default async function AuthErrorPage({ searchParams }: AuthErrorPageProps) {
  const params = await searchParams;
  const error = Array.isArray(params?.error) ? params.error[0] : params?.error;
  const content = getAuthErrorContent(error);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <span className="mb-2 flex size-11 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <ShieldAlert className="size-5" />
          </span>
          <CardTitle className="text-xl">{content.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="leading-6 text-muted-foreground">{content.description}</p>
          <div className="flex flex-wrap gap-2">
            <Link className={buttonVariants()} href="/auth/signin">
              Try sign-in again
            </Link>
            <Link
              className={buttonVariants({ variant: "outline" })}
              href="/dashboard?demo=true"
            >
              Open read-only demo
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
