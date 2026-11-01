"use client";

import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";

export default function AuthenticatedAppError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 items-center px-6 py-16">
      <div className="w-full rounded-xl border bg-card p-8 text-center shadow-sm">
        <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <AlertTriangle className="size-5" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-[-0.025em]">
          This account view could not be loaded
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          We could not load the latest account data. Try loading the view again
          or return to the dashboard.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Button onClick={retry}>
            <RotateCcw className="size-4" />
            Try again
          </Button>
          <Link className={buttonVariants({ variant: "outline" })} href="/app">
            Return to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
