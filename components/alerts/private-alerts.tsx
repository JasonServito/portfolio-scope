"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SeverityLabel } from "@/components/alerts/severity-label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type PrivateAlert = {
  id: string;
  title: string;
  message: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  status: "ACTIVE" | "RESOLVED";
  ticker: string | null;
  portfolioName: string | null;
};

export function PrivateAlerts({ alerts }: { alerts: PrivateAlert[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function setStatus(alert: PrivateAlert) {
    setPendingId(alert.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/alerts/${alert.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: alert.status === "ACTIVE" ? "RESOLVED" : "ACTIVE",
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setError(body.error ?? "Unable to update the alert.");
        return;
      }
      setNotice(
        alert.status === "ACTIVE"
          ? `${alert.title} was resolved.`
          : `${alert.title} was reopened.`,
      );
      router.refresh();
    } catch {
      setError("Unable to reach the alert service. Please try again.");
    } finally {
      setPendingId(null);
    }
  }

  if (alerts.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No private alerts have been created for your account.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        {error ? (
          <p className="mb-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="mb-3 text-sm text-muted-foreground" role="status">
            {notice}
          </p>
        ) : null}
        <ul className="divide-y">
          {alerts.map((alert) => (
            <li
              className="flex flex-col gap-4 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              key={alert.id}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <SeverityLabel severity={alert.severity} ticker={alert.ticker} />
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">
                    {alert.status.toLowerCase()}
                  </span>
                </div>
                <p className="mt-1.5 text-sm font-medium">{alert.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {alert.message}
                </p>
                {alert.portfolioName ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Portfolio: {alert.portfolioName}
                  </p>
                ) : null}
              </div>
              <Button
                className="self-start sm:self-center"
                disabled={pendingId !== null}
                onClick={() => setStatus(alert)}
                variant="outline"
              >
                {alert.status === "ACTIVE" ? "Resolve" : "Reopen"}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
