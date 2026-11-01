"use client";

import { RouteError } from "@/components/ui/route-error";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      message="The demo dashboard could not load the sample portfolio. Try again or return to the demo entry."
      reset={reset}
    />
  );
}
