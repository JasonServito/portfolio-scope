"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
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

  async function setStatus(alert: PrivateAlert) {
    setPendingId(alert.id);
    setError("");
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
    <div className="grid gap-3">
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {alerts.map((alert) => (
        <Card key={alert.id}>
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={alert.severity === "HIGH" ? "destructive" : "outline"}>
                  {alert.severity.toLowerCase()}
                </Badge>
                <Badge variant="secondary">{alert.status.toLowerCase()}</Badge>
                {alert.ticker ? <Badge variant="outline">{alert.ticker}</Badge> : null}
              </div>
              <p className="mt-3 font-medium">{alert.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{alert.message}</p>
              {alert.portfolioName ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Portfolio: {alert.portfolioName}
                </p>
              ) : null}
            </div>
            <Button
              disabled={pendingId !== null}
              onClick={() => setStatus(alert)}
              variant="outline"
            >
              {alert.status === "ACTIVE" ? "Resolve" : "Reopen"}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
