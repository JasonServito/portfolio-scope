import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

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
    <main className="mx-auto w-full max-w-6xl space-y-6 px-6 py-10">
      <div>
        <Link
          className={buttonVariants({ variant: "ghost", size: "sm" })}
          href="/app"
        >
          <ArrowLeft /> Back to portfolios
        </Link>
        <p className="mt-6 text-sm font-medium text-muted-foreground">
          Private portfolio
        </p>
        <h1 className="mt-2 text-3xl font-semibold">{portfolio.name}</h1>
        <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
          Reads and mutations are scoped to your server-side session. A foreign
          portfolio or holding identifier returns the same not-found response as
          a missing record.
        </p>
      </div>

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
    </main>
  );
}
