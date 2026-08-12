import type { Metadata } from "next";

import { PublicContent } from "@/components/layout/public-content";
import { PublicSiteShell } from "@/components/layout/public-site-shell";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "PortfolioScope's concise privacy policy for OAuth identity, portfolio data, product analytics, logs, and account deletion.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <PublicSiteShell>
      <PublicContent
        description="PortfolioScope collects only what the requested feature needs and keeps private financial values out of product analytics and operational logs."
        eyebrow="Privacy"
        title="Minimal collection. Explicit boundaries."
      >
        <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr]">
          <aside className="h-fit rounded-2xl border bg-muted/35 p-5 text-sm leading-6 text-muted-foreground">
            <p className="font-semibold text-foreground">At a glance</p>
            <p className="mt-3">
              The public demo requires no account. OAuth passwords are never
              received or stored. Private portfolio values are not sent to
              PostHog, Sentry, public pages, or an external research model.
            </p>
          </aside>
          <div className="space-y-10">
            <PolicySection title="Information used">
              Authenticated features may store your name, email, OAuth identity,
              database session, and the portfolios, holdings, watchlist items,
              alerts, or research records you create.
            </PolicySection>
            <PolicySection title="Product analytics">
              PortfolioScope records a small allowlisted set of navigation
              events. Autocapture, session replay, person profiles, portfolio
              values, quantities, transactions, credentials, and private
              research contents are excluded.
            </PolicySection>
            <PolicySection title="Operational telemetry">
              Privacy-safe logs and error reports may include route, timing,
              request or correlation ID, stable error code, ticker, and a
              one-way-hashed user identifier. Cookies, authorization headers,
              provider keys, and private payloads are redacted.
            </PolicySection>
            <PolicySection title="Optional external AI processing">
              External research is disabled by default. When enabled, a model
              receives only bounded public company identity, peer, SEC fact,
              filing-provenance, and explicit missing-data evidence. Portfolio
              holdings, quantities, values, watchlists, alerts, identity data,
              and user-entered targets are not included. Requests set the
              provider API&apos;s response-storage option to false; provider
              processing remains governed by its applicable terms.
              PortfolioScope retains the validated report, evidence copies,
              versions, and usage record.
            </PolicySection>
            <PolicySection title="Account deletion">
              The account settings flow can revoke sessions and delete the user
              with dependent private records. Shared stock catalog and public
              source data remain. Cost records already incurred may remain
              without the deleted user identifier for reconciliation. The stable
              public demo identity cannot be deleted through the normal account
              flow.
            </PolicySection>
          </div>
        </div>
      </PublicContent>
    </PublicSiteShell>
  );
}

function PolicySection({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-3 text-sm leading-7 text-muted-foreground">{children}</p>
    </section>
  );
}
