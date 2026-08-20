import Link from "next/link";

import { SessionControls } from "@/components/auth/session-controls";
import { BrandMark } from "@/components/layout/brand-mark";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";

const privateNavigation = [
  ["/app", "Dashboard"],
  ["/app/watchlist", "Watchlist"],
  ["/app/alerts", "Alerts"],
  ["/app/research", "Research"],
] as const;

export default async function ProtectedAppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireUser("/app");

  return (
    <div className="min-h-screen bg-muted/25">
      <a
        className="fixed top-3 left-3 z-50 -translate-y-20 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg transition focus:translate-y-0"
        href="#private-content"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-18 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            aria-label="PortfolioScope private workspace"
            className="flex items-center gap-3"
            href="/app"
            prefetch={false}
          >
            <BrandMark />
            <span>
              <span className="block text-sm font-semibold">
                PortfolioScope
              </span>
              <span className="block text-[11px] text-muted-foreground">
                Your dashboard
              </span>
            </span>
          </Link>
          <nav
            aria-label="Private workspace navigation"
            className="ml-auto hidden items-center gap-1 md:flex"
          >
            {privateNavigation.map(([href, label]) => (
              <Link
                className={buttonVariants({ variant: "ghost", size: "sm" })}
                href={href}
                key={href}
                prefetch={false}
              >
                {label}
              </Link>
            ))}
            <Link
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href="/dashboard?demo=true"
              prefetch={false}
            >
              Public demo
            </Link>
          </nav>
          <div className="ml-auto md:ml-0">
            <SessionControls />
          </div>
        </div>
        <nav
          aria-label="Private workspace navigation on small screens"
          className="scrollbar-none flex gap-1 overflow-x-auto border-t px-3 py-2 md:hidden"
        >
          {privateNavigation.map(([href, label]) => (
            <Link
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              href={href}
              key={href}
              prefetch={false}
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <div id="private-content">{children}</div>
      <footer className="border-t bg-background">
        <div className="mx-auto max-w-7xl px-6 py-5 text-xs text-muted-foreground lg:px-8">
          <p>Educational portfolio tracking — not financial advice.</p>
        </div>
      </footer>
    </div>
  );
}
