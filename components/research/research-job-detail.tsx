"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  CircleX,
  Clock3,
  LoaderCircle,
} from "lucide-react";

import { ResearchTabs } from "@/components/research/research-tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ResearchReportDiff } from "@/lib/research/ai/report-diff";
import type { StockResearch } from "@/lib/research/types";

export type ResearchJobDetailData = {
  id: string;
  status:
    | "PENDING"
    | "RUNNING"
    | "PARTIALLY_COMPLETED"
    | "COMPLETED"
    | "FAILED"
    | "CANCELLED";
  ticker: string;
  companyName: string;
  generationMode?: "DETERMINISTIC" | "RECORDED" | "EXTERNAL";
  createdAt: string;
  completedAt: string | null;
  research: StockResearch | null;
  comparison?: {
    previousJobId: string;
    diff: ResearchReportDiff;
  } | null;
};

const POLLED_STATUSES = new Set<ResearchJobDetailData["status"]>([
  "PENDING",
  "RUNNING",
  "PARTIALLY_COMPLETED",
]);

function statusLabel(status: ResearchJobDetailData["status"]) {
  return status.toLowerCase().replaceAll("_", " ");
}

function generationLabel(mode: ResearchJobDetailData["generationMode"]) {
  if (mode === "EXTERNAL") return "AI-assisted";
  if (mode === "RECORDED") return "Saved sample";
  if (mode === "DETERMINISTIC") return "Prebuilt";
  return null;
}

function ReportComparison({
  comparison,
}: {
  comparison: NonNullable<ResearchJobDetailData["comparison"]>;
}) {
  const { diff } = comparison;
  const confidenceDelta = Math.round(diff.confidence.delta * 100);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">
            Changes from previous report
          </CardTitle>
          <Badge variant={diff.hasMaterialChanges ? "default" : "secondary"}>
            {diff.hasMaterialChanges
              ? "Material changes"
              : "No material changes"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Rating</p>
            <p className="mt-1 text-sm font-medium">
              {diff.rating.previous.toLowerCase()} {" → "}
              {diff.rating.current.toLowerCase()}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Confidence change</p>
            <p className="mt-1 text-sm font-medium">
              {confidenceDelta > 0 ? "+" : ""}
              {confidenceDelta} percentage points
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Claims</p>
            <p className="mt-1 text-sm font-medium">
              {diff.newClaims.length} new, {diff.removedClaims.length} removed,{" "}
              {diff.changedClaims.length} changed
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Sources</p>
            <p className="mt-1 text-sm font-medium">
              {diff.source.snapshotChanged || diff.source.dataChanged
                ? "Sources changed"
                : "Sources unchanged"}
            </p>
          </div>
        </div>
        <Link
          className="text-sm font-medium underline-offset-4 hover:underline"
          href={`/app/research/${comparison.previousJobId}`}
          prefetch={false}
        >
          Open previous private report
        </Link>
      </CardContent>
    </Card>
  );
}

function JobStatus({ job }: { job: ResearchJobDetailData }) {
  if (job.status === "COMPLETED" && job.research) {
    return (
      <div
        className="flex gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
        role="status"
      >
        <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        The report is complete. Review its findings, counterpoints, missing
        information, and sources below.
      </div>
    );
  }

  if (job.status === "FAILED" || job.status === "CANCELLED") {
    return (
      <div
        className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        role="alert"
      >
        <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {job.status === "FAILED"
          ? "This run failed before a report could be completed. No automatic regeneration will be started."
          : "This run was cancelled. No automatic regeneration will be started."}
      </div>
    );
  }

  if (job.status === "PARTIALLY_COMPLETED") {
    return (
      <div
        className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
        role="status"
      >
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        Some completed work was preserved, but the report is not complete. This
        page checks for retry or recovery updates without starting another run.
      </div>
    );
  }

  return (
    <div
      className="flex gap-3 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground"
      role="status"
    >
      <LoaderCircle
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 animate-spin"
      />
      Research is running in the background. This page checks the current report
      for updates without starting another run.
    </div>
  );
}

export function ResearchJobDetail({
  initialJob,
}: {
  initialJob: ResearchJobDetailData;
}) {
  const [job, setJob] = useState(initialJob);
  const [pollError, setPollError] = useState<string | null>(null);
  const shouldPoll =
    POLLED_STATUSES.has(job.status) ||
    (job.status === "COMPLETED" && !job.research);

  useEffect(() => {
    if (!shouldPoll) return;

    let disposed = false;
    const controller = new AbortController();

    async function refreshJob() {
      try {
        const response = await fetch(`/api/research/jobs/${job.id}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("The latest job status could not be loaded.");
        }
        const nextJob = (await response.json()) as ResearchJobDetailData;
        if (!disposed) {
          setJob(nextJob);
          setPollError(null);
        }
      } catch (error) {
        if (!disposed && !controller.signal.aborted) {
          setPollError(
            error instanceof Error
              ? error.message
              : "The latest job status could not be loaded.",
          );
        }
      }
    }

    const timer = window.setInterval(refreshJob, 5_000);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [job.id, shouldPoll]);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>
                {job.companyName} {" · "} {job.ticker}
              </CardTitle>
              <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Clock3 aria-hidden="true" className="size-4" />
                Started {new Date(job.createdAt).toLocaleString("en-US")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {generationLabel(job.generationMode) ? (
                <Badge variant="secondary">
                  {generationLabel(job.generationMode)}
                </Badge>
              ) : null}
              <Badge variant="outline">{statusLabel(job.status)}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <JobStatus job={job} />
          {pollError ? (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {pollError} This page will try again.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {job.comparison ? <ReportComparison comparison={job.comparison} /> : null}

      {job.research ? (
        <ResearchTabs initialResearch={job.research} ticker={job.ticker} />
      ) : job.status === "COMPLETED" ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            The job completed, but the report payload is not available yet. This
            page will check the existing job again.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
