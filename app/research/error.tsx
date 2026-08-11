"use client";

import { RouteError } from "@/components/ui/route-error";

export default function ResearchError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      message="The deterministic sample report could not load. No missing research was generated or substituted."
      reset={reset}
    />
  );
}
