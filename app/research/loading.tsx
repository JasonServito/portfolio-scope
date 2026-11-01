import { PublicContent } from "@/components/layout/public-content";
import { PublicSiteShell } from "@/components/layout/public-site-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ResearchLoading() {
  return (
    <PublicSiteShell>
      <PublicContent
        description="Loading the read-only sample report."
        eyebrow="Read-only sample"
        title="Research that keeps the evidence visible."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <Card key={item}>
              <CardContent className="space-y-4 py-6">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      </PublicContent>
    </PublicSiteShell>
  );
}
