import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PublicSiteShell } from "@/components/layout/public-site-shell";
import { ResearchSignInNotice } from "@/components/research/research-sign-in-notice";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Research reports",
  description: "Research reports are available when you're signed in.",
  alternates: { canonical: "/research" },
};
export const dynamic = "force-dynamic";

// Kept so old links still resolve: signed-in users go to their own research.
export default async function ResearchPage() {
  if (await getCurrentUser()) redirect("/app/research");

  return (
    <PublicSiteShell>
      <div className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-24 lg:px-8">
        <ResearchSignInNotice headingLevel={1} />
      </div>
    </PublicSiteShell>
  );
}
