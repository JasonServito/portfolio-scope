import type { Metadata } from "next";
import {
  Boxes,
  Cloud,
  Database,
  KeyRound,
  RadioTower,
  ShieldCheck,
} from "lucide-react";

import { AnalyticsEvent } from "@/components/analytics/analytics-event";
import { PublicContent } from "@/components/layout/public-content";
import { PublicSiteShell } from "@/components/layout/public-site-shell";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Architecture",
  description:
    "Explore PortfolioScope's modular Next.js architecture, security boundaries, durable job flow, and cost-aware production stack.",
  alternates: { canonical: "/architecture" },
};

const layers = [
  {
    icon: Boxes,
    name: "Interface",
    detail: "Next.js App Router · React Server Components · focused client islands",
  },
  {
    icon: KeyRound,
    name: "Identity boundary",
    detail: "Auth.js database sessions · user ownership · explicit admin roles",
  },
  {
    icon: ShieldCheck,
    name: "Application services",
    detail: "Portfolio analytics · SEC normalization · research orchestration",
  },
  {
    icon: RadioTower,
    name: "Durable work",
    detail: "Signed QStash delivery · idempotency · retries · PostgreSQL job state",
  },
  {
    icon: Database,
    name: "Data systems",
    detail: "Neon PostgreSQL authority · ephemeral Redis · private Cloudflare R2",
  },
] as const;

export default function ArchitecturePage() {
  return (
    <PublicSiteShell>
      <AnalyticsEvent name="architecture_page_viewed" oncePerSession properties={{}} />
      <PublicContent
        description="PortfolioScope is a modular monolith with deliberate boundaries between presentation, authorization, services, providers, and durable infrastructure."
        eyebrow="Technical overview"
        title="One deployable system. Clear production boundaries."
      >
        <section aria-labelledby="request-flow-heading">
          <div className="max-w-3xl">
            <Badge variant="outline">Request flow</Badge>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em]" id="request-flow-heading">
              From interaction to authoritative state
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Each layer narrows responsibility. UI never parses raw SEC
              responses, authorization does not depend on client state, and
              Redis never owns permanent records.
            </p>
          </div>
          <ol className="mt-8 grid gap-3 lg:grid-cols-5">
            {layers.map(({ detail, icon: Icon, name }, index) => (
              <li className="relative rounded-2xl border bg-card p-5" key={name}>
                <div className="flex items-center justify-between">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary/8 text-primary">
                    <Icon className="size-5" />
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    0{index + 1}
                  </span>
                </div>
                <h3 className="mt-6 font-semibold">{name}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {detail}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-16 grid gap-4 lg:grid-cols-3">
          <Principle
            detail="Session identity is resolved server-side. Private queries include the authenticated owner and foreign IDs return the same response as missing records."
            title="Security by ownership"
          />
          <Principle
            detail="PostgreSQL owns job and application state. QStash delivers signed messages while Redis provides only short-lived caches, limits, locks, and deduplication."
            title="Durability before convenience"
          />
          <Principle
            detail="SEC observations keep source, filing, period, unit, retrieval time, and normalization version. Ambiguity remains visible instead of being guessed away."
            title="Provenance before presentation"
          />
        </section>

        <section className="mt-16 overflow-hidden rounded-2xl border bg-[#0d1a19] text-white">
          <div className="grid lg:grid-cols-[0.8fr_1.2fr]">
            <div className="border-b border-white/10 p-7 lg:border-r lg:border-b-0">
              <Cloud className="size-6 text-[#6ee7b7]" />
              <h2 className="mt-8 text-3xl font-semibold tracking-[-0.035em]">
                Cost-aware production stack
              </h2>
              <p className="mt-4 text-sm leading-6 text-white/60">
                The initial architecture uses approved free tiers and a bounded
                recruiter workload. The operating target remains approximately
                $1–2 USD monthly, including the annualized domain.
              </p>
            </div>
            <dl className="grid sm:grid-cols-2">
              {[
                ["Application", "Next.js 15 on Vercel"],
                ["Database", "Neon PostgreSQL + Prisma"],
                ["Identity", "Auth.js · GitHub · Google"],
                ["Documents", "Private Cloudflare R2"],
                ["Coordination", "Upstash Redis + QStash"],
                ["Operations", "Sentry · Better Stack · PostHog"],
              ].map(([term, value]) => (
                <div className="border-b border-white/10 p-6 odd:sm:border-r" key={term}>
                  <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#6ee7b7]">
                    {term}
                  </dt>
                  <dd className="mt-3 text-sm font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </PublicContent>
    </PublicSiteShell>
  );
}

function Principle({ detail, title }: { detail: string; title: string }) {
  return (
    <article className="rounded-2xl border bg-card p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{detail}</p>
    </article>
  );
}
