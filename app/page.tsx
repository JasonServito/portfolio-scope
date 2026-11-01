import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { AnalyticsLink } from "@/components/analytics/analytics-link";
import { PublicSiteShell } from "@/components/layout/public-site-shell";
import { ProductPreview } from "@/components/marketing/product-preview";
import { buttonVariants } from "@/components/ui/button";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Portfolio and stock dashboard",
  description: siteConfig.description,
  alternates: { canonical: "/" },
};

const capabilities = [
  {
    title: "Understand your portfolio",
    description:
      "Review value, return, allocation, and each holding's contribution over the same selected period.",
    detail: "Portfolio overview and holdings",
  },
  {
    title: "Follow stocks",
    description:
      "Keep companies on a watchlist and open stock pages for market context and financial fundamentals.",
    detail: "Watchlist and stock detail",
  },
  {
    title: "Review clear signals",
    description:
      "See alerts, research findings, risks, counterpoints, missing information, and supporting sources.",
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
      <section className="border-b">
        <div className="mx-auto grid min-h-[calc(100vh-4.5rem)] w-full max-w-7xl items-center gap-12 px-6 py-14 lg:grid-cols-[0.9fr_1.1fr] lg:px-8 lg:py-20">
          <div>
            <h1 className="max-w-3xl text-5xl leading-[1.04] font-medium tracking-[-0.03em] text-balance sm:text-6xl lg:text-[4rem]">
              Know what moved your portfolio—and why
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
              PortfolioScope shows what a portfolio is worth, which positions
              moved it, and what each company&apos;s filings say, in one
              read-only dashboard built for newer investors.
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
            <p className="mt-6 flex flex-wrap gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span>No account required</span>
              <span aria-hidden="true">·</span>
              <span>Read-only sample data</span>
              <span aria-hidden="true">·</span>
              <span>Two-minute guided path</span>
            </p>
          </div>

          <ProductPreview />
        </div>
      </section>

      <section className="border-b">
        <div className="mx-auto w-full max-w-7xl px-6 py-16 lg:px-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Product tour</p>
              <h2 className="mt-2 text-3xl font-medium tracking-[-0.01em]">
                See the core product in three stops
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              The public journey stays available without an account and focuses
              on the tasks an investor comes here to complete.
            </p>
          </div>
          <ol className="mt-8 grid gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-3">
            {journey.map(([number, title, description]) => (
              <li className="bg-card p-5" key={number}>
                <span className="font-mono text-xs text-muted-foreground">
                  {number}
                </span>
                <p className="mt-6 font-medium">{title}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {description}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:px-8">
        <div className="max-w-3xl">
          <p className="text-sm text-muted-foreground">Built around decisions</p>
          <h2 className="mt-2 text-4xl font-medium tracking-[-0.02em] text-balance">
            A portfolio dashboard that shows its work
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Every major surface answers a practical investing question and keeps
            the next action clear.
          </p>
        </div>
        <div className="mt-10 grid gap-8 lg:grid-cols-3">
          {capabilities.map(({ description, detail, title }) => (
            <article className="border-t pt-6" key={title}>
              <h3 className="text-lg font-medium">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {description}
              </p>
              <p className="mt-4 text-xs text-muted-foreground">{detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 pb-20 lg:px-8">
        <div className="grid gap-5 rounded-xl border bg-card p-6 md:grid-cols-[1fr_auto] md:items-center md:p-8">
          <div>
            <p className="font-medium">Ready to inspect the product?</p>
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
