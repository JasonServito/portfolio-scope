import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AlertsLoading() {
  return (
    <AppLayout>
      <PageShell
        description="Loading deterministic portfolio risk signals."
        eyebrow="Risk monitoring"
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
