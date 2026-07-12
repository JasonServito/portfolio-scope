import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";

import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function StockNotFound() {
  return (
    <AppLayout>
      <PageShell
        actions={
          <Link className={buttonVariants({ variant: "outline" })} href="/watchlist">
            <ArrowLeft className="size-4" />
            Watchlist
          </Link>
        }
        description="The requested ticker is not part of the seeded PortfolioPulse demo dataset."
        eyebrow="Stock detail"
        title="Stock unavailable"
      >
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="flex size-11 items-center justify-center rounded-md bg-muted">
              <AlertTriangle className="size-5" />
            </span>
            <div>
              <p className="font-medium">No seeded data found for this ticker.</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Open a holding or watchlist item to view deterministic price
                history, risk flags, and company context.
              </p>
            </div>
          </CardContent>
        </Card>
      </PageShell>
    </AppLayout>
  );
}
