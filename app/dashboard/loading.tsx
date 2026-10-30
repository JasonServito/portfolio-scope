import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <AppLayout>
      <PageShell
        description="What the sample portfolio is worth, how it moved, and which positions need a closer look"
        eyebrow="North Star Portfolio · Read-only demo"
        title="Dashboard"
      >
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <Card key={item}>
              <CardContent>
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-3 h-7 w-36" />
                <Skeleton className="mt-3 h-4 w-40" />
              </CardContent>
            </Card>
          ))}
        </section>
        <Card>
          <CardContent>
            <Skeleton className="h-72 w-full" />
          </CardContent>
        </Card>
      </PageShell>
    </AppLayout>
  );
}
