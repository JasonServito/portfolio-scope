import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { SessionControls } from "@/components/auth/session-controls";
import { BrandMark } from "@/components/layout/brand-mark";
import { buttonVariants } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth/session";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireAdmin();

  return (
    <div className="min-h-screen bg-muted/25">
      <a
        className="fixed top-3 left-3 z-50 -translate-y-20 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg transition focus:translate-y-0"
        href="#admin-content"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-18 w-full max-w-7xl items-center gap-4 px-6 lg:px-8">
          <Link className="flex items-center gap-3" href="/admin">
            <BrandMark />
            <span>
              <span className="block text-sm font-semibold">PortfolioScope</span>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <ShieldCheck className="size-3" />
                Administrator operations
              </span>
            </span>
          </Link>
          <nav
            aria-label="Administrator navigation"
            className="ml-auto hidden items-center gap-1 sm:flex"
          >
            <Link
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              href="/app"
            >
              Private workspace
            </Link>
            <Link
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href="/dashboard?demo=true"
            >
              Public demo
            </Link>
          </nav>
          <div className="ml-auto sm:ml-0">
            <SessionControls />
          </div>
        </div>
        <nav
          aria-label="Administrator navigation on small screens"
          className="scrollbar-none flex gap-1 overflow-x-auto border-t px-3 py-2 sm:hidden"
        >
          <Link
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            href="/app"
          >
            Private workspace
          </Link>
          <Link
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            href="/dashboard?demo=true"
          >
            Public demo
          </Link>
        </nav>
      </header>
      <div id="admin-content">{children}</div>
    </div>
  );
}
