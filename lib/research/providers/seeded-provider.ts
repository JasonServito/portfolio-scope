import { db } from "@/lib/db";
import { calculatePercentChange } from "@/lib/portfolio/calculations";
import type {
  ResearchProvider,
  ResearchProviderData,
  SeededFinancialSnapshot,
  SeededNewsItem,
} from "@/lib/research/providers/provider";

const newsByTicker: Record<string, SeededNewsItem> = {
  AAPL: {
    headline: "Services mix remains a key demo catalyst",
    context:
      "The seeded scenario highlights recurring services revenue alongside hardware cycles.",
    tone: "positive",
  },
  MSFT: {
    headline: "Cloud and AI investment shape the demo outlook",
    context:
      "The seeded scenario balances cloud demand with elevated infrastructure spending.",
    tone: "positive",
  },
  NVDA: {
    headline: "Accelerated-computing demand drives the demo narrative",
    context:
      "The seeded scenario pairs strong demand with supply and valuation sensitivity.",
    tone: "positive",
  },
  AMD: {
    headline: "Data-center execution is the seeded focus",
    context:
      "The demo scenario emphasizes product execution in a competitive chip market.",
    tone: "mixed",
  },
  TSLA: {
    headline: "Delivery variability remains the seeded watch item",
    context:
      "The demo scenario highlights demand, pricing, and execution uncertainty.",
    tone: "mixed",
  },
  SHOP: {
    headline: "Merchant platform expansion supports the demo case",
    context:
      "The seeded scenario emphasizes operating leverage and merchant growth.",
    tone: "positive",
  },
  GOOGL: {
    headline: "Search durability and AI spending shape the demo outlook",
    context:
      "The seeded scenario balances advertising resilience with investment intensity.",
    tone: "mixed",
  },
  AMZN: {
    headline: "Cloud and retail efficiency anchor the demo case",
    context:
      "The seeded scenario highlights margin discipline across two distinct businesses.",
    tone: "positive",
  },
  META: {
    headline: "Advertising strength funds the seeded investment cycle",
    context:
      "The demo scenario balances engagement trends with high infrastructure spending.",
    tone: "mixed",
  },
  COST: {
    headline: "Membership renewal quality anchors the demo narrative",
    context:
      "The seeded scenario emphasizes recurring membership economics and defensive demand.",
    tone: "positive",
  },
};

const financialsBySector: Record<string, SeededFinancialSnapshot> = {
  Technology: {
    growthProfile: "Seeded above-market growth profile",
    marginProfile: "Strong but investment-sensitive margins",
    balanceSheetProfile: "Seeded balance sheet capacity is resilient",
  },
  "Communication Services": {
    growthProfile: "Seeded advertising-led growth profile",
    marginProfile: "Healthy margins with elevated AI investment",
    balanceSheetProfile: "Seeded liquidity profile is strong",
  },
  "Consumer Cyclical": {
    growthProfile: "Seeded demand-sensitive growth profile",
    marginProfile: "Margins vary with mix and operating execution",
    balanceSheetProfile: "Seeded balance sheet capacity is adequate",
  },
  "Consumer Defensive": {
    growthProfile: "Seeded steady-growth profile",
    marginProfile: "Stable, lower-volatility margin profile",
    balanceSheetProfile: "Seeded balance sheet capacity is resilient",
  },
};

function toNumber(value: { toNumber: () => number } | number) {
  return typeof value === "number" ? value : value.toNumber();
}

export const seededResearchProvider: ResearchProvider = {
  async getResearchData(
    ticker,
    { userId },
  ): Promise<ResearchProviderData | null> {
    const stock = await db.stock.findUnique({
      where: { ticker: ticker.toUpperCase() },
      include: {
        prices: { orderBy: { timestamp: "desc" }, take: 31 },
        holdings: {
          where: { portfolio: { userId } },
          include: { portfolio: { include: { holdings: true } } },
        },
        alerts: {
          where: {
            status: "ACTIVE",
            userId,
            OR: [{ portfolioId: null }, { portfolio: { userId } }],
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!stock || stock.prices.length < 2) return null;

    const peers = await db.stock.findMany({
      where: {
        id: { not: stock.id },
        OR: [{ industry: stock.industry }, { sector: stock.sector }],
      },
      select: { ticker: true, companyName: true, industry: true },
      orderBy: { ticker: "asc" },
      take: 3,
    });
    const prices = [...stock.prices].reverse();
    const latest = toNumber(prices.at(-1)!.close);
    const first = toNumber(prices[0].close);
    const maxDailyMove = prices.slice(1).reduce((maximum, price, index) => {
      const move = Math.abs(
        calculatePercentChange(
          toNumber(prices[index].close),
          toNumber(price.close),
        ),
      );
      return Math.max(maximum, move);
    }, 0);
    const holding = stock.holdings[0];
    const totalCostBasis = holding
      ? holding.portfolio.holdings.reduce(
          (sum, item) => sum + toNumber(item.costBasis),
          0,
        )
      : 0;

    return {
      ticker: stock.ticker,
      companyName: stock.companyName,
      sector: stock.sector,
      industry: stock.industry,
      news: newsByTicker[stock.ticker] ? [newsByTicker[stock.ticker]] : [],
      financials: financialsBySector[stock.sector] ?? {
        growthProfile: "No seeded growth profile",
        marginProfile: "No seeded margin profile",
        balanceSheetProfile: "No seeded balance sheet profile",
      },
      competitors: peers,
      politicalActivity: {
        summary:
          "No verified political activity is included in the deterministic demo dataset.",
        disclosed: false,
      },
      risk: {
        oneMonthReturn: calculatePercentChange(first, latest),
        maxDailyMove,
        portfolioWeight:
          holding && totalCostBasis > 0
            ? toNumber(holding.costBasis) / totalCostBasis
            : null,
        activeAlerts: stock.alerts.map((alert) => alert.title),
      },
    };
  },
};
