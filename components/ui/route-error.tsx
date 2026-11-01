"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";

import { BrandMark } from "@/components/layout/brand-mark";
import { Button, buttonVariants } from "@/components/ui/button";

export function RouteError({
  error,
  message = "This page could not load its current data. Try again without losing your place.",
  reset,
}: {
  error: Error & { digest?: string };
  message?: string;
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/35 px-6 py-12">
      <div className="w-full max-w-xl rounded-2xl border bg-card p-7 text-center shadow-sm">
        <BrandMark className="mx-auto" />
        <span className="mx-auto mt-7 flex size-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <AlertTriangle className="size-5" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-[-0.025em]">
          This view is temporarily unavailable
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Button onClick={reset}>
            <RotateCcw className="size-4" />
            Try again
          </Button>
          <Link
            className={buttonVariants({ variant: "outline" })}
            href="/dashboard?demo=true"
          >
            Return to demo
          </Link>
        </div>
      </div>
    </main>
  );
}
