import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function StockLoading() {
  return (
    <AppLayout>
      <PageShell
        description="Loading market context, position data, SEC provenance, and research."
        eyebrow="Stock detail"
        title="Loading company"
      >
        <Card>
          <CardContent className="grid gap-4 py-6 sm:grid-cols-4">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton className="h-20 w-full" key={item} />
            ))}
          </CardContent>
        </Card>
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardContent>
              <Skeleton className="h-[420px] w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-36" />
            </CardHeader>
            <CardContent className="space-y-4">
              {[0, 1, 2, 3, 4].map((item) => (
                <Skeleton className="h-8 w-full" key={item} />
              ))}
            </CardContent>
          </Card>
        </div>
      </PageShell>
    </AppLayout>
  );
}
