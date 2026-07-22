"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type JobRow = {
  id: string;
  type: string;
  status: string;
  target: string;
  correlationId: string;
  attemptCount: number;
  maxAttempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  queuedAt: string;
};

type JobDetail = {
  id: string;
  status: string;
  attempts: Array<{
    attemptNumber: number;
    status: string;
    errorCode: string | null;
    startedAt: string;
    completedAt: string | null;
  }>;
  controlEvents: Array<{ action: string; createdAt: string }>;
};

const retryable = new Set(["FAILED", "PARTIALLY_COMPLETED"]);
const cancellable = new Set(["QUEUED", "RETRYING"]);

export function JobDiagnostics({ jobs }: { jobs: JobRow[] }) {
  const router = useRouter();
  const [status, setStatus] = useState("ALL");
  const [pendingId, setPendingId] = useState("");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const filtered = useMemo(
    () => (status === "ALL" ? jobs : jobs.filter((job) => job.status === status)),
    [jobs, status],
  );

  async function mutate(jobId: string, action: "retry" | "cancel") {
    setPendingId(jobId);
    setError("");
    try {
      const response = await fetch(`/api/admin/jobs/${jobId}/${action}`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setError(body.error ?? `Job ${action} failed.`);
        return;
      }
      setDetail(null);
      router.refresh();
    } catch {
      setError("The job control endpoint could not be reached.");
    } finally {
      setPendingId("");
    }
  }

  async function loadDetail(jobId: string) {
    setPendingId(jobId);
    setError("");
    try {
      const response = await fetch(`/api/admin/jobs/${jobId}`);
      if (!response.ok) {
        setError("Job details could not be loaded.");
        return;
      }
      setDetail((await response.json()) as JobDetail);
    } catch {
      setError("The job detail endpoint could not be reached.");
    } finally {
      setPendingId("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="grid gap-1 text-sm font-medium">
          Job status
          <select
            className="h-10 rounded-md border bg-background px-3"
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            {[
              "ALL",
              "QUEUED",
              "RUNNING",
              "RETRYING",
              "PARTIALLY_COMPLETED",
              "COMPLETED",
              "FAILED",
              "CANCELLED",
            ].map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ").toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-muted-foreground">
          {filtered.length} of {jobs.length} durable jobs
        </p>
      </div>

      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[900px] text-left text-sm">
          <caption className="sr-only">Background job state and controls</caption>
          <thead className="border-b bg-muted/40 text-muted-foreground">
            <tr>
              {[
                "Job",
                "Target",
                "State",
                "Attempts",
                "Last error",
                "Queued",
                "Controls",
              ].map((heading) => (
                <th className="px-4 py-3 font-medium" key={heading} scope="col">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((job) => (
              <tr className="border-b last:border-0" key={job.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">{job.type.replaceAll("_", " ")}</p>
                  <p className="font-mono text-xs text-muted-foreground" title={job.correlationId}>
                    {job.correlationId.slice(0, 12)}
                  </p>
                </td>
                <td className="px-4 py-3">{job.target}</td>
                <td className="px-4 py-3">
                  <Badge variant="outline">{job.status.toLowerCase().replaceAll("_", " ")}</Badge>
                </td>
                <td className="px-4 py-3">{job.attemptCount}/{job.maxAttempts}</td>
                <td className="max-w-xs px-4 py-3">
                  {job.errorCode ? (
                    <div>
                      <p className="font-mono text-xs">{job.errorCode}</p>
                      <p className="truncate text-muted-foreground" title={job.errorMessage ?? ""}>
                        {job.errorMessage}
                      </p>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </td>
                <td className="px-4 py-3">{new Date(job.queuedAt).toLocaleString("en-US")}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <Button
                      disabled={pendingId === job.id}
                      onClick={() => loadDetail(job.id)}
                      size="sm"
                      variant="outline"
                    >
                      Details
                    </Button>
                    {retryable.has(job.status) ? (
                      <Button disabled={pendingId === job.id} onClick={() => mutate(job.id, "retry")} size="sm">
                        Retry
                      </Button>
                    ) : null}
                    {cancellable.has(job.status) ? (
                      <Button disabled={pendingId === job.id} onClick={() => mutate(job.id, "cancel")} size="sm" variant="outline">
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Job attempt history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p><span className="font-medium">Job:</span> {detail.id}</p>
            {detail.attempts.length === 0 ? (
              <p className="text-muted-foreground">No worker attempt has started.</p>
            ) : (
              <ol className="space-y-2">
                {detail.attempts.map((attempt) => (
                  <li className="rounded-md border p-3" key={attempt.attemptNumber}>
                    Attempt {attempt.attemptNumber}: {attempt.status.toLowerCase()}
                    {attempt.errorCode ? ` · ${attempt.errorCode}` : ""}
                  </li>
                ))}
              </ol>
            )}
            {detail.controlEvents.length ? (
              <p className="text-muted-foreground">
                Admin controls: {detail.controlEvents.map((event) => event.action.toLowerCase()).join(", ")}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
