import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function HoldingsLoading() {
  return (
    <AppLayout>
      <PageShell
        description="Loading portfolio positions and period returns."
        eyebrow="Portfolio"
        title="Holdings"
      >
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-36" />
          </CardHeader>
          <CardContent className="space-y-3">
            {[0, 1, 2, 3, 4].map((item) => (
              <Skeleton className="h-12 w-full" key={item} />
            ))}
          </CardContent>
        </Card>
      </PageShell>
    </AppLayout>
  );
}
