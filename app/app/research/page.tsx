import { PageShell } from "@/components/layout/page-shell";
import { PrivateResearch } from "@/components/research/private-research";
import { requireUser } from "@/lib/auth/session";
import {
  getResearchWorkspaceSummary,
  listResearchJobs,
} from "@/lib/research/orchestrator";

export const dynamic = "force-dynamic";

export default async function PrivateResearchPage() {
  const user = await requireUser("/app/research");
  const [jobs, workspace] = await Promise.all([
    listResearchJobs(user.id),
    getResearchWorkspaceSummary(user.id),
  ]);

  return (
    <PageShell
      description="Start stock research and revisit each report's summary, strengths, risks, what to watch, and supporting evidence. Reports here are private to your account."
      eyebrow="Private research history"
      title="Your research"
    >
      <PrivateResearch
        workspace={workspace}
        jobs={jobs.map((job) => {
          return {
            id: job.id,
            ticker: job.stock.ticker,
            companyName: job.stock.companyName,
            status: job.status,
            createdAt: job.createdAt.toISOString(),
            generationMode: job.generationMode,
          };
        })}
      />
    </PageShell>
  );
}
