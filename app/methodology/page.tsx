import type { Metadata } from "next";
import {
  Calculator,
  CircleOff,
  FileCheck2,
  Scale,
  TimerReset,
} from "lucide-react";

import { PublicContent } from "@/components/layout/public-content";
import { PublicSiteShell } from "@/components/layout/public-site-shell";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "Understand PortfolioScope's calculation periods, portfolio return assumptions, risk rules, and missing-data behavior.",
  alternates: { canonical: "/methodology" },
};

const methods = [
  {
    icon: Calculator,
    title: "Portfolio value and gain",
    formula: "market value = shares × latest seeded close",
    detail:
      "Cost basis is stored per holding. Unrealized gain is market value minus cost basis; percentages are unavailable when the denominator is zero.",
  },
  {
    icon: TimerReset,
    title: "Selected-period return",
    formula: "(period end value − period start value) ÷ period start value",
    detail:
      "The dashboard uses the same 1D, 1W, 1M, 3M, or 1Y window for its summary, chart, holding rankings, and contributions.",
  },
  {
    icon: Scale,
    title: "Holding contribution",
    formula: "holding period gain ÷ portfolio period start value",
    detail:
      "Contribution connects each position's dollar movement to the portfolio-level change without presenting a predictive signal.",
  },
  {
    icon: CircleOff,
    title: "Missing-data behavior",
    formula: "missing ≠ zero",
    detail:
      "PortfolioScope preserves unavailable, ambiguous, unsupported, delayed, stale, partial, and failed states instead of fabricating a numeric value.",
  },
  {
    icon: FileCheck2,
    title: "Evidence-grounded AI research",
    formula: "validated claim → supporting and counter evidence",
    detail:
      "The optional model path retrieves a bounded, versioned public-source snapshot. Runtime schemas reject malformed or uncited claims, numerical statements must appear in cited evidence, and missing information remains explicit. External AI is disabled by default.",
  },
] as const;

export default function MethodologyPage() {
  return (
    <PublicSiteShell>
      <PublicContent
        description="The current demo prioritizes deterministic, reproducible calculations. Inputs, periods, missing-data rules, and source boundaries remain visible."
        eyebrow="Calculation policy"
        title="Transparent inputs. Reproducible outputs."
      >
        <section
          aria-label="Portfolio calculation methods"
          className="grid gap-4 md:grid-cols-2"
        >
          {methods.map(({ detail, formula, icon: Icon, title }) => (
            <article className="rounded-2xl border bg-card p-6" key={title}>
              <Icon className="size-5 text-primary" />
              <h2 className="mt-6 text-xl font-semibold">{title}</h2>
              <p className="mt-3 rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground">
                {formula}
              </p>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                {detail}
              </p>
            </article>
          ))}
        </section>

        <section className="mt-14 grid gap-8 border-t pt-12 lg:grid-cols-[0.75fr_1.25fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              Risk alerts
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em]">
              Rules, not opaque scores.
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              [
                "Concentration",
                "Flags outsized position exposure against a documented threshold.",
              ],
              ["Drawdown", "Compares an observed price with its period high."],
              [
                "Price move",
                "Surfaces deterministic movement over the configured period.",
              ],
              [
                "Watchlist",
                "Compares seeded context with an optional user target.",
              ],
            ].map(([title, detail]) => (
              <div className="rounded-xl border bg-card p-5" key={title}>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {detail}
                </p>
              </div>
            ))}
          </div>
        </section>

        <aside className="mt-14 rounded-2xl border border-amber-300 bg-amber-50 p-6 text-amber-950">
          <h2 className="font-semibold">Current limitation</h2>
          <p className="mt-2 text-sm leading-6">
            The M17 demo does not add transaction-aware return calculations,
            benchmark comparison, volatility, drawdown analytics, or scenarios.
            Those deterministic methods remain M19 scope.
          </p>
        </aside>
      </PublicContent>
    </PublicSiteShell>
  );
}
