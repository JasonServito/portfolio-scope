"use client";

import { Button } from "@/components/ui/button";
import { captureAnalyticsEvent } from "@/lib/analytics/client";

export function AnalyticsSubmitButton({
  children,
  disabled,
  provider,
}: {
  children: React.ReactNode;
  disabled: boolean;
  provider: "github" | "google";
}) {
  return (
    <Button
      className="w-full"
      disabled={disabled}
      onClick={() =>
        captureAnalyticsEvent("sign_in_started", { provider })
      }
      size="lg"
      type="submit"
      variant="outline"
    >
      {children}
    </Button>
  );
}
