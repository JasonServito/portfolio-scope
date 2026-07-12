import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <AppLayout>
      <PageShell
        description="Loading seeded portfolio analytics."
        eyebrow="Demo portfolio"
        title="Dashboard"
      >
        <section className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <Card key={item}>
              <CardHeader>
                <Skeleton className="h-4 w-28" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-9 w-36" />
                <Skeleton className="mt-3 h-4 w-44" />
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
