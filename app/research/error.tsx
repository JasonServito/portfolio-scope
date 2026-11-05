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
      message="This page could not load. Try again in a moment."
      reset={reset}
    />
  );
}
