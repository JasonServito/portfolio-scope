import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

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
    <main className="mx-auto w-full max-w-6xl space-y-6 px-6 py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            href="/app/research"
            prefetch={false}
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Research history
          </Link>
          <p className="mt-5 text-sm font-medium text-muted-foreground">
            Owner-only research report
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Research run</h1>
          <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
            Check the report&apos;s progress, then review its summary,
            strengths, risks, what to watch, and supporting evidence.
          </p>
        </div>
        <Link
          className={buttonVariants({ variant: "outline" })}
          href={`/stocks/${job.ticker.toLowerCase()}`}
          prefetch={false}
        >
          Public stock context
          <ExternalLink aria-hidden="true" className="size-4" />
        </Link>
      </div>

      <ResearchJobDetail initialJob={job} />
    </main>
  );
}
