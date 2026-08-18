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
      message="The sample report could not load. Try again to view the saved research."
      reset={reset}
    />
  );
}
