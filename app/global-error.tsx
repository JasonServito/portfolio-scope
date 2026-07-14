"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6 text-center">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            PortfolioScope
          </p>
          <h1 className="text-3xl font-semibold">Something went wrong</h1>
          <p className="text-muted-foreground">
            The application could not complete this request. Try again, or return
            later if the problem continues.
          </p>
          <div>
            <button
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              type="button"
              onClick={reset}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
