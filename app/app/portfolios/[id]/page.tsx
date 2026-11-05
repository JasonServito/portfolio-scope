import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { getPortfolio } from "@/lib/portfolio/management";

export const dynamic = "force-dynamic";

// Older links open the owner's portfolio on the Holdings page. Another
// account's portfolio ID still resolves to the same not-found response.
export default async function PrivatePortfolioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser("/app");
  const { id } = await params;
  const portfolio = await getPortfolio(user.id, id);

  if (!portfolio) notFound();

  redirect("/app/holdings");
}
