"use client";

import { Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ResearchJobRow = {
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
};

export function PrivateResearch({ jobs }: { jobs: ResearchJobRow[] }) {
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
      const response = await fetch(`/api/research/${ticker}`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setError(body.error ?? "Research could not be queued.");
        return;
      }
      setTicker("");
      router.refresh();
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
          <CardTitle>Run deterministic research</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3 sm:flex-row" onSubmit={run}>
            <label className="grid flex-1 gap-1.5 text-sm font-medium">
              Seeded ticker
              <input
                className="h-10 rounded-lg border bg-background px-3 font-normal uppercase outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
                maxLength={5}
                onChange={(event) => setTicker(event.target.value.toUpperCase())}
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
          {hasActiveJob ? (
            <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
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
                    <Badge variant="outline">
                      {job.status.toLowerCase().replaceAll("_", " ")}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {job.companyName} · {new Date(job.createdAt).toLocaleDateString("en-US")}
                  </p>
                </div>
                <Link
                  className="text-sm font-medium underline-offset-4 hover:underline"
                  href={`/stocks/${job.ticker.toLowerCase()}`}
                >
                  Open public stock context
                </Link>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
