import { notFound } from "next/navigation";

import { PreviewSentryTest } from "./preview-sentry-test";

export const dynamic = "force-dynamic";

export default function PreviewSentryTestPage() {
  if (process.env.VERCEL_ENV !== "preview") {
    notFound();
  }

  return <PreviewSentryTest />;
}
