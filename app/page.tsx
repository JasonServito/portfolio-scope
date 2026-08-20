import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Bell,
  Binoculars,
  Gauge,
  LockKeyhole,
} from "lucide-react";

import { AnalyticsLink } from "@/components/analytics/analytics-link";
import { PublicSiteShell } from "@/components/layout/public-site-shell";
import { ProductPreview } from "@/components/marketing/product-preview";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Portfolio and stock dashboard",
  description: siteConfig.description,
  alternates: { canonical: "/" },
};

const capabilityCards = [
  {
    title: "Understand your portfolio",
    description:
      "Review value, return, allocation, and each holding's contribution over the same selected period.",
    icon: BarChart3,
    detail: "Portfolio overview and holdings",
  },
  {
    title: "Follow stocks",
    description:
      "Keep companies on a watchlist and open stock pages for market context and financial fundamentals.",
    icon: Binoculars,
    detail: "Watchlist and stock detail",
  },
  {
    title: "Review clear signals",
    description:
      "See alerts, research findings, risks, counterpoints, missing information, and supporting sources.",
    icon: Bell,
    detail: "Alerts and stock research",
  },
] as const;

const journey = [
  [
    "01",
    "Portfolio",
    "Change the period and see the whole dashboard reconcile.",
  ],
  ["02", "Holding", "Open a major position and inspect its contribution."],
  ["03", "Stock", "Review market context, fundamentals, risks, and research."],
] as const;

export default function Home() {
  return (
    <PublicSiteShell>
      <section className="relative overflow-hidden border-b">
        <div
          className="landing-grid absolute inset-0 opacity-45"
          aria-hidden="true"
        />
        <div className="relative mx-auto grid min-h-[calc(100vh-4.5rem)] w-full max-w-7xl items-center gap-12 px-6 py-14 lg:grid-cols-[0.92fr_1.08fr] lg:px-8 lg:py-20">
          <div>
            <Badge
              className="border-primary/20 bg-primary/5 text-primary"
              variant="outline"
            >
              Stock dashboard · Demo-first · Read-only
            </Badge>
            <h1 className="mt-7 max-w-3xl text-5xl font-semibold tracking-[-0.055em] text-balance sm:text-6xl lg:text-[4.6rem] lg:leading-[0.98]">
              Know what moved your portfolio—and why.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
              PortfolioScope brings portfolios, watchlists, alerts, company
              fundamentals, and stock research into one straightforward
              dashboard.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <AnalyticsLink
                className={buttonVariants({
                  size: "lg",
                  className: "min-h-11 px-5",
                })}
                eventName="demo_opened"
                eventProperties={{ entryPoint: "landing" }}
                href="/dashboard?demo=true"
                prefetch={false}
              >
                Explore the read-only demo
                <ArrowRight className="size-4" />
              </AnalyticsLink>
              <Link
                className={buttonVariants({
                  variant: "outline",
                  size: "lg",
                  className: "min-h-11 px-5",
                })}
                href="/stocks/aapl"
                prefetch={false}
              >
                Explore a stock
              </Link>
            </div>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <LockKeyhole className="size-3.5 text-primary" />
                No account required
              </span>
              <span className="flex items-center gap-1.5">
                <LockKeyhole className="size-3.5 text-primary" />
                Read-only sample data
              </span>
              <span className="flex items-center gap-1.5">
                <Gauge className="size-3.5 text-primary" />
                Two-minute guided path
              </span>
            </div>
          </div>

          <ProductPreview />
        </div>
      </section>

      <section className="border-b bg-foreground text-background">
        <div className="mx-auto w-full max-w-7xl px-6 py-12 lg:px-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-background/55">
                Product tour
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em]">
                See the core product in three stops.
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-background/60">
              The public journey stays available without an account and focuses
              on the tasks an investor comes here to complete.
            </p>
          </div>
          <ol className="mt-9 grid gap-px overflow-hidden rounded-2xl border border-background/15 bg-background/15 md:grid-cols-3">
            {journey.map(([number, title, description]) => (
              <li className="bg-foreground p-5" key={number}>
                <span className="font-mono text-xs text-[#6ee7b7]">
                  {number}
                </span>
                <p className="mt-8 font-semibold">{title}</p>
                <p className="mt-2 text-sm leading-6 text-background/55">
                  {description}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:px-8">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Built around decisions
          </p>
          <h2 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-balance">
            A portfolio dashboard that shows its work.
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Every major surface answers a practical investing question and keeps
            the next action clear.
          </p>
        </div>
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {capabilityCards.map(({ description, detail, icon: Icon, title }) => (
            <article
              className="rounded-2xl border bg-card p-6 shadow-[0_16px_48px_rgba(23,42,39,0.06)]"
              key={title}
            >
              <span className="flex size-11 items-center justify-center rounded-xl bg-primary/8 text-primary">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-8 text-xl font-semibold tracking-[-0.025em]">
                {title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {description}
              </p>
              <p className="mt-8 border-t pt-4 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {detail}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 py-16 lg:px-8">
        <div className="grid gap-5 rounded-2xl border bg-card p-6 md:grid-cols-[1fr_auto] md:items-center md:p-8">
          <div>
            <p className="text-sm font-semibold">
              Ready to inspect the product?
            </p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Start with the read-only demo, open a holding, and review a
              stock&apos;s fundamentals, risks, and research.
            </p>
          </div>
          <AnalyticsLink
            className={buttonVariants({ className: "min-h-10 px-4" })}
            eventName="demo_opened"
            eventProperties={{ entryPoint: "landing" }}
            href="/dashboard?demo=true"
            prefetch={false}
          >
            Start the product tour
            <ArrowRight className="size-4" />
          </AnalyticsLink>
        </div>
      </section>
    </PublicSiteShell>
  );
}
