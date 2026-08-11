import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function WatchlistLoading() {
  return (
    <AppLayout>
      <PageShell
        description="Loading the curated public research queue."
        eyebrow="Research queue"
        title="Watchlist"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <Card key={item}>
              <CardContent className="space-y-3 py-5">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </PageShell>
    </AppLayout>
  );
}
