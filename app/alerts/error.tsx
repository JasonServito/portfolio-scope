"use client";

import { RouteError } from "@/components/ui/route-error";

export default function AlertsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      message="The deterministic risk queue could not load its current signals."
      reset={reset}
    />
  );
}
