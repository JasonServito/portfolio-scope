import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { PageShell } from "@/components/layout/page-shell";
import { PrivatePortfolioManager } from "@/components/portfolios/private-portfolio-manager";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { getPortfolio } from "@/lib/portfolio/management";

export const dynamic = "force-dynamic";

export default async function PrivatePortfolioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser("/app");
  const { id } = await params;
  const portfolio = await getPortfolio(user.id, id);

  if (!portfolio) notFound();

  return (
    <PageShell
      actions={
        <Link
          className={buttonVariants({ variant: "ghost" })}
          href="/app"
          prefetch={false}
        >
          <ArrowLeft /> Back to portfolios
        </Link>
      }
      description="Update the portfolio details and keep its holdings current"
      eyebrow="Portfolio"
      title={portfolio.name}
    >
      <PrivatePortfolioManager
        holdings={portfolio.holdings.map((holding) => ({
          id: holding.id,
          ticker: holding.stock.ticker,
          companyName: holding.stock.companyName,
          shares: Number(holding.shares),
          averageCost: Number(holding.averageCost),
          costBasis: Number(holding.costBasis),
        }))}
        id={portfolio.id}
        initialBaseCurrency={portfolio.baseCurrency}
        initialName={portfolio.name}
      />
    </PageShell>
  );
}
