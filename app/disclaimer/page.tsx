import type { Metadata } from "next";

import { PublicContent } from "@/components/layout/public-content";
import { PublicSiteShell } from "@/components/layout/public-site-shell";

export const metadata: Metadata = {
  title: "Disclaimer",
  description:
    "PortfolioScope is for informational and educational purposes only and does not provide financial, investment, legal, or tax advice.",
  alternates: { canonical: "/disclaimer" },
};

export default function DisclaimerPage() {
  return (
    <PublicSiteShell>
      <PublicContent
        description="PortfolioScope is for informational and educational purposes only. Nothing in the app is financial, investment, legal, or tax advice."
        eyebrow="Important disclosure"
        title="Information, not advice."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Disclosure title="No recommendation">
            Research summaries, ratings, alerts, and calculations are
            educational outputs, not personalized buy, sell, or hold
            recommendations. Make your own decisions and consult qualified
            financial, legal, or tax professionals where appropriate.
          </Disclosure>
          <Disclosure title="No brokerage">
            PortfolioScope does not connect to brokerage accounts, accept
            deposits, execute orders, custody assets, or automate trading.
          </Disclosure>
          <Disclosure title="Data limitations">
            Market and financial data may be delayed, incomplete, inaccurate,
            unavailable, or outdated. SEC-derived facts can be affected by
            filing quality or interpretation, TradingView widgets may be delayed
            or unavailable, and seeded demo values are not live quotes.
          </Disclosure>
          <Disclosure title="AI limitations">
            Some research may be AI-generated or AI-assisted. It can contain
            mistakes, omissions, or outdated information, including
            misinterpretation of cited evidence. Verify important information
            independently and do not rely on AI output as the sole basis for
            investment decisions.
          </Disclosure>
          <Disclosure title="Do your own review">
            Check important information against original filings and other
            reliable sources. Historical performance and deterministic signals
            do not predict future results.
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
