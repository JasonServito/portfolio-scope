import { PrivateResearch } from "@/components/research/private-research";
import { requireUser } from "@/lib/auth/session";
import { listResearchJobs } from "@/lib/research/orchestrator";

export const dynamic = "force-dynamic";

export default async function PrivateResearchPage() {
  const user = await requireUser("/app/research");
  const jobs = await listResearchJobs(user.id);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-6 py-10">
      <div>
        <p className="text-sm font-medium text-muted-foreground">
          Private research history
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Your research</h1>
        <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
          Research jobs run as independently retryable specialists and preserve
          partial results. Ownership remains derived from your authenticated
          session; public sample reports are a separate read-only exception.
        </p>
      </div>
      <PrivateResearch
        jobs={jobs.map((job) => ({
          id: job.id,
          ticker: job.stock.ticker,
          companyName: job.stock.companyName,
          status: job.status,
          createdAt: job.createdAt.toISOString(),
        }))}
      />
    </main>
  );
}
