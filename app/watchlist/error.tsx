"use client";

import { RouteError } from "@/components/ui/route-error";

export default function WatchlistError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      message="The public watchlist could not load. The demo remains read-only and no changes were made."
      reset={reset}
    />
  );
}
