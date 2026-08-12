import type { Metadata } from "next";
import {
  BarChart3,
  BrainCircuit,
  Database,
  FlaskConical,
  HardDrive,
} from "lucide-react";

import { PublicContent } from "@/components/layout/public-content";
import { PublicSiteShell } from "@/components/layout/public-site-shell";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Data sources",
  description:
    "See how PortfolioScope distinguishes SEC EDGAR facts, attributed TradingView widgets, deterministic fixtures, and private source storage.",
  alternates: { canonical: "/data-sources" },
};

const sources = [
  {
    icon: Database,
    name: "U.S. SEC EDGAR",
    role: "PortfolioScope-controlled fundamentals",
    status: "Authoritative filing source",
    detail:
      "Supported companies use SEC submissions and Company Facts. Displayed facts retain reporting period, form, accession, source URL, retrieval time, units, and normalization version.",
  },
  {
    icon: BarChart3,
    name: "TradingView",
    role: "Public market chart and quote context",
    status: "Attributed third-party widget",
    detail:
      "Widget data is rendered by TradingView, may be delayed, is not scraped, and is never stored or represented as PortfolioScope-owned market data.",
  },
  {
    icon: FlaskConical,
    name: "Deterministic fixtures",
    role: "Portfolio, price, and research demo data",
    status: "Seeded, not live",
    detail:
      "Stable fixtures make the public demo predictable and keep automated tests independent from external availability. The interface labels fixture-backed values explicitly.",
  },
  {
    icon: HardDrive,
    name: "Cloudflare R2",
    role: "Private immutable source storage",
    status: "Not a public data feed",
    detail:
      "Raw SEC responses and logical backups are stored privately outside PostgreSQL. Public source links point to the SEC rather than exposing object-storage credentials.",
  },
  {
    icon: BrainCircuit,
    name: "Optional OpenAI interpretation",
    role: "Bounded interpretation, never a financial-data source",
    status: "Default-off and budget capped",
    detail:
      "When an administrator explicitly enables it, the model receives only selected public company evidence and must return schema-validated claims tied to supplied evidence IDs. It cannot browse, and private holdings, watchlists, alerts, and portfolio values are excluded.",
  },
] as const;

export default function DataSourcesPage() {
  return (
    <PublicSiteShell>
      <PublicContent
        description="PortfolioScope separates first-party normalized facts, third-party widgets, deterministic fixtures, and private source artifacts so users can understand what each value represents."
        eyebrow="Provenance"
        title="Every source has a visible boundary."
      >
        <div className="grid gap-4 md:grid-cols-2">
          {sources.map(({ detail, icon: Icon, name, role, status }) => (
            <article className="rounded-2xl border bg-card p-6" key={name}>
              <div className="flex items-start justify-between gap-4">
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary/8 text-primary">
                  <Icon className="size-5" />
                </span>
                <Badge variant="outline">{status}</Badge>
              </div>
              <h2 className="mt-7 text-xl font-semibold">{name}</h2>
              <p className="mt-1 text-sm font-medium text-primary">{role}</p>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                {detail}
              </p>
            </article>
          ))}
        </div>

        <section className="mt-14 overflow-hidden rounded-2xl border">
          <div className="bg-foreground px-6 py-5 text-background">
            <h2 className="text-xl font-semibold">Freshness language</h2>
            <p className="mt-2 text-sm text-background/60">
              Major financial-data surfaces use an explicit, consistent state.
            </p>
          </div>
          <dl className="grid sm:grid-cols-2 lg:grid-cols-4">
            {[
              [
                "Current / recent",
                "A valid source retrieval is within its configured freshness window.",
              ],
              [
                "Delayed / stale",
                "Existing data remains visible with its original timestamp and a warning.",
              ],
              [
                "Missing / unsupported",
                "No eligible fact exists, or the issuer is outside curated coverage.",
              ],
              [
                "Failed / partial",
                "Useful prior data can remain visible while the failed refresh is disclosed.",
              ],
            ].map(([term, detail]) => (
              <div className="border-b p-5 sm:border-r" key={term}>
                <dt className="font-semibold">{term}</dt>
                <dd className="mt-2 text-sm leading-6 text-muted-foreground">
                  {detail}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </PublicContent>
    </PublicSiteShell>
  );
}
