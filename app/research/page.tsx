import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { AnalyticsEvent } from "@/components/analytics/analytics-event";
import { PublicContent } from "@/components/layout/public-content";
import { PublicSiteShell } from "@/components/layout/public-site-shell";
import { ResearchTabs } from "@/components/research/research-tabs";
import { buttonVariants } from "@/components/ui/button";
import { getLatestResearch } from "@/lib/research/orchestrator";

export const metadata: Metadata = {
  title: "Sample research",
  description:
    "Review a read-only sample report with a summary, strengths, risks, what to watch, and expandable evidence.",
  alternates: { canonical: "/research" },
};
export const dynamic = "force-dynamic";

export default async function SampleResearchPage() {
  const research = await getLatestResearch("AAPL");

  return (
    <PublicSiteShell>
      {research ? (
        <AnalyticsEvent
          name="research_report_viewed"
          properties={{ reportMode: "demo", ticker: "AAPL" }}
        />
      ) : null}
      <PublicContent
        description="Review a prebuilt sample with a summary, strengths, risks, what to watch, and expandable evidence. It is read-only and will not start or change research."
        eyebrow="Read-only sample"
        title="Research that keeps the evidence visible."
      >
        <div className="mb-6 flex flex-col gap-4 rounded-2xl border bg-muted/35 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">Apple Inc. &middot; AAPL</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Continue to stock detail for market context and company
              fundamentals.
            </p>
          </div>
          <Link
            className={buttonVariants({ variant: "outline" })}
            href="/stocks/aapl#research"
          >
            Open full stock detail
            <ArrowRight className="size-4" />
          </Link>
        </div>
        <ResearchTabs initialResearch={research} readOnly ticker="AAPL" />
      </PublicContent>
    </PublicSiteShell>
  );
}
