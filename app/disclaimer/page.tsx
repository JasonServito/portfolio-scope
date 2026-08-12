import type { Metadata } from "next";

import { PublicContent } from "@/components/layout/public-content";
import { PublicSiteShell } from "@/components/layout/public-site-shell";

export const metadata: Metadata = {
  title: "Disclaimer",
  description:
    "PortfolioScope is a non-commercial educational analytics project, not a brokerage, adviser, recommendation service, or guaranteed real-time data source.",
  alternates: { canonical: "/disclaimer" },
};

export default function DisclaimerPage() {
  return (
    <PublicSiteShell>
      <PublicContent
        description="PortfolioScope demonstrates full-stack engineering through financial analytics. It does not execute trades, provide personalized advice, or guarantee real-time market information."
        eyebrow="Important disclosure"
        title="Analytics for education—not financial advice."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Disclosure title="No recommendation">
            Research summaries, ratings, alerts, and calculations are
            educational outputs. They are not personalized buy, sell, or hold
            recommendations and should not replace professional advice.
          </Disclosure>
          <Disclosure title="No brokerage">
            PortfolioScope does not connect to brokerage accounts, accept
            deposits, execute orders, custody assets, or automate trading.
          </Disclosure>
          <Disclosure title="Data limitations">
            SEC-derived facts can be missing, ambiguous, delayed, stale, or
            affected by issuer filings. TradingView widgets may be delayed or
            unavailable. Seeded demo values are not live production quotes.
          </Disclosure>
          <Disclosure title="AI limitations">
            Optional AI-generated research can be incomplete, incorrect, or
            misinterpret cited evidence even after automated validation. Its
            confidence, ratings, and summaries are not guarantees or forecasts;
            review the linked primary evidence yourself.
          </Disclosure>
          <Disclosure title="Do your own review">
            Verify important information with original filings and qualified
            professionals. Historical performance and deterministic signals do
            not predict future results.
          </Disclosure>
        </div>
      </PublicContent>
    </PublicSiteShell>
  );
}

function Disclosure({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-2xl border bg-card p-6">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-3 text-sm leading-7 text-muted-foreground">{children}</p>
    </section>
  );
}
