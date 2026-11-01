import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AlertsLoading() {
  return (
    <AppLayout>
      <PageShell
        description="Positions and watchlist stocks that crossed a concentration, drawdown, price move, volatility, or target check"
        eyebrow="North Star Portfolio · Read-only demo"
        title="Alerts"
      >
        <Card>
          <CardContent className="space-y-3 py-5">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton className="h-24 w-full" key={item} />
            ))}
          </CardContent>
        </Card>
      </PageShell>
    </AppLayout>
  );
}
