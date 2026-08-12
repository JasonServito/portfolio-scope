"use client";

import { ArrowRight, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type ResearchJobRow = {
  id: string;
  ticker: string;
  companyName: string;
  status:
    | "PENDING"
    | "RUNNING"
    | "PARTIALLY_COMPLETED"
    | "COMPLETED"
    | "FAILED"
    | "CANCELLED";
  createdAt: string;
  generationMode?: "DETERMINISTIC" | "RECORDED" | "EXTERNAL";
};

function formatStatus(status: ResearchJobRow["status"]) {
  return status.toLowerCase().replaceAll("_", " ");
}

function formatMode(mode: ResearchJobRow["generationMode"]) {
  if (mode === "EXTERNAL") return "AI-generated";
  if (mode === "RECORDED") return "Recorded AI";
  if (mode === "DETERMINISTIC") return "Deterministic";
  return "Mode unavailable";
}

type ResearchWorkspaceSummary = {
  enabled: boolean;
  configurationReady: boolean;
  reportLimit: number | null;
  userBudgetUsd: number | null;
  usage: {
    periodStart: string;
    reservedUsd: number;
    usedUsd: number;
    calls: number;
  };
};

export function PrivateResearch({
  jobs,
  workspace,
}: {
  jobs: ResearchJobRow[];
  workspace?: ResearchWorkspaceSummary;
}) {
  const router = useRouter();
  const [ticker, setTicker] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const hasActiveJob = jobs.some((job) =>
    ["PENDING", "RUNNING"].includes(job.status),
  );
  const hasPartialJob = jobs.some(
    (job) => job.status === "PARTIALLY_COMPLETED",
  );

  useEffect(() => {
    if (!hasActiveJob) return;
    const timer = window.setInterval(() => router.refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [hasActiveJob, router]);

  async function run(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch(
        `/api/research/${encodeURIComponent(ticker)}`,
        {
          body: JSON.stringify({ regenerate: false }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const body = (await response.json()) as {
        error?: string;
        jobId?: string;
      };
      if (!response.ok) {
        setError(body.error ?? "Research could not be queued.");
        return;
      }
      if (!body.jobId) {
        setError("Research was queued without a report identifier.");
        return;
      }
      setTicker("");
      router.push(`/app/research/${encodeURIComponent(body.jobId)}`);
    } catch {
      setError("Unable to reach the research service. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Run evidence-grounded research</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3 sm:flex-row" onSubmit={run}>
            <label className="grid flex-1 gap-1.5 text-sm font-medium">
              Ticker
              <input
                className="h-10 rounded-lg border bg-background px-3 font-normal uppercase outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
                maxLength={5}
                onChange={(event) =>
                  setTicker(event.target.value.toUpperCase())
                }
                placeholder="AAPL"
                required
                value={ticker}
              />
            </label>
            <Button className="sm:self-end" disabled={pending} type="submit">
              <Play /> {pending ? "Queuing..." : "Queue research"}
            </Button>
          </form>
          {error ? (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            External AI is used only when it is enabled by an administrator and
            the configured user, job, and monthly cost limits allow the run. If
            AI is disabled, the deterministic path remains available; an enabled
            but invalid or exhausted AI configuration blocks a new run.
          </p>
          {workspace ? (
            <div className="mt-4 grid gap-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-3">
              <div>
                <p className="text-muted-foreground">External AI</p>
                <p className="mt-1 font-medium">
                  {workspace.enabled && workspace.configurationReady
                    ? "Available within limits"
                    : workspace.enabled
                      ? "Configuration incomplete"
                      : "Disabled (deterministic mode)"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Monthly user cost</p>
                <p className="mt-1 font-medium">
                  ${workspace.usage.usedUsd.toFixed(6)} used
                  {workspace.userBudgetUsd === null
                    ? ""
                    : ` / $${workspace.userBudgetUsd.toFixed(2)}`}
                </p>
                {workspace.usage.reservedUsd > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    ${workspace.usage.reservedUsd.toFixed(6)} reserved
                  </p>
                ) : null}
              </div>
              <div>
                <p className="text-muted-foreground">Monthly report limit</p>
                <p className="mt-1 font-medium">
                  {workspace.reportLimit === null
                    ? "Not active"
                    : `${workspace.reportLimit} reports`}
                </p>
              </div>
            </div>
          ) : null}
          {hasActiveJob ? (
            <p
              className="mt-3 text-sm text-muted-foreground"
              aria-live="polite"
            >
              Specialist jobs are running in the background. This view refreshes
              while work is active.
            </p>
          ) : null}
          {hasPartialJob ? (
            <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
              A research run preserved partial specialist output and needs an
              administrator retry before synthesis can finish.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {jobs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Your private research history is empty.
          </CardContent>
        </Card>
      ) : (
        <section className="grid gap-3">
          {jobs.map((job) => (
            <Card key={job.id}>
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{job.ticker}</p>
                    <Badge variant="outline">{formatStatus(job.status)}</Badge>
                    <Badge variant="secondary">
                      {formatMode(job.generationMode)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {job.companyName} {" · "}
                    {new Date(job.createdAt).toLocaleDateString("en-US")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <Link
                    className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    href={`/stocks/${job.ticker.toLowerCase()}`}
                  >
                    Public stock context
                  </Link>
                  <Link
                    className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
                    href={`/app/research/${job.id}`}
                  >
                    Open private report
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
