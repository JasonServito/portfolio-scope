import type { Metadata } from "next";

import { JobDiagnostics } from "@/components/admin/job-diagnostics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { listBackgroundJobsForAdmin } from "@/lib/jobs/service";

export const metadata: Metadata = { title: "Job diagnostics" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const [jobs, companies] = await Promise.all([
    listBackgroundJobsForAdmin({ take: 100 }),
    db.company.findMany({
      where: { isSupported: true },
      select: {
        id: true,
        name: true,
        lastSyncedAt: true,
        securities: { select: { ticker: true }, take: 1 },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 px-6 py-10">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Administrator operations</p>
        <h1 className="mt-2 text-3xl font-semibold">Durable job diagnostics</h1>
        <p className="mt-2 max-w-3xl leading-7 text-muted-foreground">
          PostgreSQL is authoritative for job state. QStash transports signed work,
          while Redis coordinates short-lived locks and limits.
        </p>
      </div>

      <JobDiagnostics
        jobs={jobs.map((job) => ({
          id: job.id,
          type: job.type,
          status: job.status,
          target:
            job.company?.securities[0]?.ticker ??
            job.researchJob?.stock.ticker ??
            job.portfolio?.name ??
            "System",
          correlationId: job.correlationId,
          attemptCount: job.attemptCount,
          maxAttempts: job.maxAttempts,
          errorCode: job.errorCode,
          errorMessage: job.errorMessage,
          queuedAt: job.queuedAt.toISOString(),
        }))}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">SEC freshness by supported ticker</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {companies.map((company) => (
              <div className="rounded-lg border p-4" key={company.id}>
                <p className="font-medium">
                  {company.securities[0]?.ticker ?? "No ticker"} · {company.name}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {company.lastSyncedAt
                    ? `Last completed ${company.lastSyncedAt.toLocaleString("en-US")}`
                    : "No completed SEC synchronization"}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
