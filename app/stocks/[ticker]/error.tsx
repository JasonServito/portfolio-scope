"use client";

import { RouteError } from "@/components/ui/route-error";

export default function StockError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      message="This stock view could not combine its demo context and persisted fundamentals. No missing values were substituted."
      reset={reset}
    />
  );
}
