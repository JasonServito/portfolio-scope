"use client";

import { RouteError } from "@/components/ui/route-error";

export default function HoldingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      message="The holdings table could not load its deterministic portfolio data."
      reset={reset}
    />
  );
}
