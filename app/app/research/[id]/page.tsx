import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { PageShell } from "@/components/layout/page-shell";
import { ResearchJobDetail } from "@/components/research/research-job-detail";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { getOwnedResearchJob } from "@/lib/research/orchestrator";

export const dynamic = "force-dynamic";

export default async function PrivateResearchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser(`/app/research/${id}`);
  const job = await getOwnedResearchJob(user.id, id);

  if (!job) notFound();

  return (
    <PageShell
      actions={
        <>
          <Link
            className={buttonVariants({ variant: "ghost" })}
            href="/app/research"
            prefetch={false}
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Research history
          </Link>
          <Link
            className={buttonVariants({ variant: "outline" })}
            href={`/stocks/${job.ticker.toLowerCase()}`}
            prefetch={false}
          >
            Public stock context
            <ExternalLink aria-hidden="true" className="size-4" />
          </Link>
        </>
      }
      description="Check the report's progress, then review its summary, strengths, risks, what to watch, and supporting evidence"
      eyebrow="Owner-only research report"
      title="Research run"
    >
      <ResearchJobDetail initialJob={job} />
    </PageShell>
  );
}
