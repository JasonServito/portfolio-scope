import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { SessionControls } from "@/components/auth/session-controls";
import { BrandMark } from "@/components/layout/brand-mark";
import { AnalyticsLink } from "@/components/analytics/analytics-link";
import { buttonVariants } from "@/components/ui/button";
import { publicNavigation, siteConfig } from "@/lib/site";

export function PublicSiteShell({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <a
        className="fixed top-3 left-3 z-50 -translate-y-20 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg transition focus:translate-y-0"
        href="#main-content"
      >
        Skip to content
      </a>
      <PublicSiteHeader />
      <main className="flex-1" id="main-content">
        {children}
      </main>
      <PublicSiteFooter />
    </div>
  );
}

function PublicSiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/95 backdrop-blur">
      <div className="mx-auto flex min-h-18 w-full max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          aria-label="PortfolioScope home"
          className="flex shrink-0 items-center gap-3"
          href="/"
        >
          <BrandMark />
          <span>
            <span className="block text-sm font-semibold leading-4">
              PortfolioScope
            </span>
            <span className="hidden text-[11px] text-muted-foreground sm:block">
              Analytics with an audit trail
            </span>
          </span>
        </Link>

        <nav
          aria-label="Public navigation"
          className="ml-auto hidden items-center gap-1 lg:flex"
        >
          {publicNavigation.map((item) => (
            <Link
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
          <a
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            href={siteConfig.repositoryUrl}
            rel="noreferrer"
            target="_blank"
          >
            GitHub
            <ExternalLink className="size-3" />
          </a>
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-2">
          <AnalyticsLink
            className={buttonVariants({ size: "sm" })}
            eventName="demo_opened"
            eventProperties={{ entryPoint: "navigation" }}
            href="/dashboard?demo=true"
          >
            Try demo
          </AnalyticsLink>
          <SessionControls />
        </div>
      </div>

      <nav
        aria-label="Public navigation on small screens"
        className="scrollbar-none flex gap-1 overflow-x-auto border-t px-3 py-2 lg:hidden"
      >
        {publicNavigation.map((item) => (
          <Link
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        ))}
        <Link
          className={buttonVariants({ variant: "ghost", size: "sm" })}
          href="/research"
        >
          Sample research
        </Link>
      </nav>
    </header>
  );
}

function PublicSiteFooter() {
  return (
    <footer className="border-t bg-foreground text-background">
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-6 py-10 md:grid-cols-[1.2fr_1fr_1fr] lg:px-8">
        <div className="max-w-md">
          <div className="flex items-center gap-3">
            <BrandMark className="bg-background text-foreground" />
            <p className="font-semibold">{siteConfig.name}</p>
          </div>
          <p className="mt-4 text-sm leading-6 text-background/65">
            A non-commercial engineering project for transparent portfolio
            analytics, source-backed fundamentals, and explainable research.
          </p>
        </div>
        <FooterGroup
          links={[
            ["/dashboard?demo=true", "Read-only demo"],
            ["/research", "Sample research"],
            ["/architecture", "Architecture"],
            ["/methodology", "Methodology"],
          ]}
          title="Explore"
        />
        <FooterGroup
          links={[
            ["/data-sources", "Data sources"],
            ["/privacy", "Privacy"],
            ["/disclaimer", "Disclaimer"],
            [siteConfig.repositoryUrl, "GitHub repository"],
          ]}
          title="Project"
        />
      </div>
      <div className="border-t border-background/15">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-6 py-5 text-xs text-background/55 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <p>Educational project. Not investment advice or a brokerage.</p>
          <p>SEC EDGAR facts · Attributed TradingView widgets · Seeded demo data</p>
        </div>
      </div>
    </footer>
  );
}

function FooterGroup({
  links,
  title,
}: {
  links: ReadonlyArray<readonly [string, string]>;
  title: string;
}) {
  return (
    <div>
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-4 space-y-3 text-sm text-background/65">
        {links.map(([href, label]) => (
          <li key={href}>
            {href.startsWith("http") ? (
              <a
                className="transition hover:text-background focus-visible:text-background"
                href={href}
                rel="noreferrer"
                target="_blank"
              >
                {label}
              </a>
            ) : (
              <Link
                className="transition hover:text-background focus-visible:text-background"
                href={href}
              >
                {label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
