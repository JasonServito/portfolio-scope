import Link from "next/link";

import { SessionControls } from "@/components/auth/session-controls";
import { requireUser } from "@/lib/auth/session";

export default async function ProtectedAppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireUser("/app");

  return (
    <div className="min-h-screen bg-muted/25">
      <header className="border-b bg-background">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center gap-4 px-6">
          <Link className="flex items-center gap-2 text-sm font-semibold" href="/app">
            <span className="size-3 rounded-full bg-emerald-500" />
            PortfolioScope
          </Link>
          <nav className="ml-auto hidden items-center gap-4 text-sm text-muted-foreground md:flex">
            <Link className="hover:text-foreground" href="/app">
              Portfolios
            </Link>
            <Link className="hover:text-foreground" href="/app/watchlist">
              Watchlist
            </Link>
            <Link className="hover:text-foreground" href="/app/alerts">
              Alerts
            </Link>
            <Link className="hover:text-foreground" href="/app/research">
              Research
            </Link>
            <Link className="text-sm text-muted-foreground hover:text-foreground" href="/demo">
              Read-only demo
            </Link>
          </nav>
          <div className="ml-auto md:ml-0">
            <SessionControls />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
