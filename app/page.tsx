import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Braces,
  Database,
  ExternalLink,
  FileSearch,
  Gauge,
  LockKeyhole,
  Route,
  ServerCog,
  ShieldCheck,
} from "lucide-react";

import { AnalyticsLink } from "@/components/analytics/analytics-link";
import { PublicSiteShell } from "@/components/layout/public-site-shell";
import { ProductPreview } from "@/components/marketing/product-preview";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Portfolio analytics with an audit trail",
  description: siteConfig.description,
  alternates: { canonical: "/" },
};

const capabilityCards = [
  {
    title: "Period-aware analytics",
    description:
      "See value, return, allocation, and holding contribution over the same selected observation window.",
    icon: BarChart3,
    detail: "Typed calculation services",
  },
  {
    title: "Financial-data provenance",
    description:
      "Inspect filing period, accession, retrieval time, units, and normalization status beside SEC-derived facts.",
    icon: FileSearch,
    detail: "SEC EDGAR + private R2",
  },
  {
    title: "Explainable research",
    description:
      "Review deterministic specialist outputs, missing information, counterpoints, and the sources behind synthesis.",
    icon: Braces,
    detail: "Structured, testable results",
  },
] as const;

const journey = [
  ["01", "Portfolio", "Change the period and see the whole dashboard reconcile."],
  ["02", "Holding", "Open a major position and inspect its contribution."],
  ["03", "Evidence", "Compare market context with SEC-controlled fundamentals."],
  ["04", "Architecture", "Trace the same journey through production boundaries."],
] as const;

export default function Home() {
  return (
    <PublicSiteShell>
      <section className="relative overflow-hidden border-b">
        <div className="landing-grid absolute inset-0 opacity-45" aria-hidden="true" />
        <div className="relative mx-auto grid min-h-[calc(100vh-4.5rem)] w-full max-w-7xl items-center gap-12 px-6 py-14 lg:grid-cols-[0.92fr_1.08fr] lg:px-8 lg:py-20">
          <div>
            <Badge className="border-primary/20 bg-primary/5 text-primary" variant="outline">
              Production-oriented · Demo-first · Read-only
            </Badge>
            <h1 className="mt-7 max-w-3xl text-5xl font-semibold tracking-[-0.055em] text-balance sm:text-6xl lg:text-[4.6rem] lg:leading-[0.98]">
              Know what moved your portfolio—and why.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
              PortfolioScope combines period-based portfolio analytics,
              deterministic risk signals, and source-backed company research in
              one inspectable full-stack product.
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
                href="/architecture"
              >
                See how it is built
              </Link>
            </div>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <LockKeyhole className="size-3.5 text-primary" />
                No account required
              </span>
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-primary" />
                Server-enforced read-only data
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
                Recruiter path
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em]">
                The strongest signal, in four stops.
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-background/60">
              The public journey stays available without OAuth and connects
              product decisions to the engineering beneath them.
            </p>
          </div>
          <ol className="mt-9 grid gap-px overflow-hidden rounded-2xl border border-background/15 bg-background/15 md:grid-cols-4">
            {journey.map(([number, title, description]) => (
              <li className="bg-foreground p-5" key={number}>
                <span className="font-mono text-xs text-[#6ee7b7]">{number}</span>
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
            Every major surface answers a practical investing question and
            exposes the data boundary behind the answer.
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

      <section className="border-y bg-muted/35">
        <div className="mx-auto grid w-full max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Engineering proof
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-balance">
              Production boundaries you can explain in an interview.
            </h2>
            <p className="mt-5 text-base leading-7 text-muted-foreground">
              The modular monolith keeps UI, authorization, services, providers,
              and persistence distinct while background jobs remain durable and
              observable.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                className={buttonVariants({ variant: "outline" })}
                href="/architecture"
              >
                Explore architecture
                <Route className="size-4" />
              </Link>
              <a
                className={buttonVariants({ variant: "ghost" })}
                href={siteConfig.repositoryUrl}
                rel="noreferrer"
                target="_blank"
              >
                View source
                <ExternalLink className="size-4" />
              </a>
            </div>
          </div>

          <div
            aria-label="PortfolioScope system flow from interface to services and data infrastructure"
            className="grid gap-3 sm:grid-cols-2"
            role="img"
          >
            <ArchitectureNode
              detail="Responsive public, demo, private, and admin routes"
              icon={Gauge}
              label="Next.js interface"
            />
            <ArchitectureNode
              detail="Session, role, ownership, and demo boundaries"
              icon={LockKeyhole}
              label="Authorization"
            />
            <ArchitectureNode
              detail="Analytics, SEC, research, and durable job orchestration"
              icon={ServerCog}
              label="Typed services"
            />
            <ArchitectureNode
              detail="PostgreSQL authority, ephemeral Redis, private R2"
              icon={Database}
              label="Data layer"
            />
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 py-16 lg:px-8">
        <div className="grid gap-5 rounded-2xl border bg-card p-6 md:grid-cols-[1fr_auto] md:items-center md:p-8">
          <div>
            <p className="text-sm font-semibold">
              Ready to inspect the product?
            </p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Start with the deterministic demo, open a holding, inspect its SEC
              provenance, and finish on the public architecture page.
            </p>
          </div>
          <AnalyticsLink
            className={buttonVariants({ className: "min-h-10 px-4" })}
            eventName="demo_opened"
            eventProperties={{ entryPoint: "landing" }}
            href="/dashboard?demo=true"
          >
            Start the two-minute tour
            <ArrowRight className="size-4" />
          </AnalyticsLink>
        </div>
      </section>
    </PublicSiteShell>
  );
}

function ArchitectureNode({
  detail,
  icon: Icon,
  label,
}: {
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <div className="rounded-2xl border bg-background p-5">
      <Icon className="size-5 text-primary" />
      <p className="mt-5 font-semibold">{label}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
    </div>
  );
}
