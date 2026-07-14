import {
  AgentName,
  AgentRating,
  AgentStatus,
  AlertSeverity,
  AlertStatus,
  AlertType,
  PriceInterval,
  PrismaClient,
  ResearchStatus,
} from "@prisma/client";

const prisma = new PrismaClient();

const anchorDate = new Date("2026-06-26T21:00:00.000Z");
const demoUserEmail = process.env.DEMO_USER_EMAIL ?? "demo@portfolioscope.dev";
const demoPortfolioName = "Recruiter Demo Portfolio";
const seededResearchCreatedAt = addDays(anchorDate, -1);

const demoIds = {
  user: "portfolioscope-demo-user",
  portfolio: "portfolioscope-demo-portfolio",
  alert: (ticker, type) =>
    `portfolioscope-demo-alert-${ticker.toLowerCase()}-${type.toLowerCase()}`,
  researchJob: (ticker) =>
    `portfolioscope-demo-research-${ticker.toLowerCase()}`,
};

const stocks = [
  {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    sector: "Technology",
    industry: "Consumer Electronics",
    exchange: "NASDAQ",
    startPrice: 178,
    dailyDrift: 0.00045,
    amplitude: 0.018,
    volume: 58200000,
  },
  {
    ticker: "MSFT",
    companyName: "Microsoft Corporation",
    sector: "Technology",
    industry: "Software Infrastructure",
    exchange: "NASDAQ",
    startPrice: 403,
    dailyDrift: 0.00055,
    amplitude: 0.015,
    volume: 24800000,
  },
  {
    ticker: "NVDA",
    companyName: "NVIDIA Corporation",
    sector: "Technology",
    industry: "Semiconductors",
    exchange: "NASDAQ",
    startPrice: 119,
    dailyDrift: 0.00115,
    amplitude: 0.035,
    volume: 276000000,
  },
  {
    ticker: "AMD",
    companyName: "Advanced Micro Devices, Inc.",
    sector: "Technology",
    industry: "Semiconductors",
    exchange: "NASDAQ",
    startPrice: 152,
    dailyDrift: 0.0002,
    amplitude: 0.034,
    volume: 61100000,
  },
  {
    ticker: "TSLA",
    companyName: "Tesla, Inc.",
    sector: "Consumer Cyclical",
    industry: "Auto Manufacturers",
    exchange: "NASDAQ",
    startPrice: 247,
    dailyDrift: -0.00005,
    amplitude: 0.042,
    volume: 99300000,
  },
  {
    ticker: "SHOP",
    companyName: "Shopify Inc.",
    sector: "Technology",
    industry: "Software Application",
    exchange: "NYSE",
    startPrice: 71,
    dailyDrift: 0.00035,
    amplitude: 0.03,
    volume: 9400000,
  },
  {
    ticker: "GOOGL",
    companyName: "Alphabet Inc.",
    sector: "Communication Services",
    industry: "Internet Content & Information",
    exchange: "NASDAQ",
    startPrice: 164,
    dailyDrift: 0.0005,
    amplitude: 0.017,
    volume: 29600000,
  },
  {
    ticker: "AMZN",
    companyName: "Amazon.com, Inc.",
    sector: "Consumer Cyclical",
    industry: "Internet Retail",
    exchange: "NASDAQ",
    startPrice: 183,
    dailyDrift: 0.0004,
    amplitude: 0.021,
    volume: 43100000,
  },
  {
    ticker: "META",
    companyName: "Meta Platforms, Inc.",
    sector: "Communication Services",
    industry: "Internet Content & Information",
    exchange: "NASDAQ",
    startPrice: 492,
    dailyDrift: 0.00075,
    amplitude: 0.026,
    volume: 17700000,
  },
  {
    ticker: "COST",
    companyName: "Costco Wholesale Corporation",
    sector: "Consumer Defensive",
    industry: "Discount Stores",
    exchange: "NASDAQ",
    startPrice: 836,
    dailyDrift: 0.0003,
    amplitude: 0.012,
    volume: 2100000,
  },
];

const holdings = [
  { ticker: "AAPL", shares: 42, averageCost: 154.25 },
  { ticker: "MSFT", shares: 24, averageCost: 336.4 },
  { ticker: "NVDA", shares: 68, averageCost: 88.75 },
  { ticker: "GOOGL", shares: 31, averageCost: 131.2 },
  { ticker: "AMZN", shares: 27, averageCost: 146.8 },
  { ticker: "COST", shares: 8, averageCost: 702.5 },
];

const watchlistItems = [
  {
    ticker: "AMD",
    targetPrice: 138,
    notes: "Semiconductor peer to compare against NVDA concentration.",
  },
  {
    ticker: "TSLA",
    targetPrice: 215,
    notes: "High-volatility name for risk monitoring examples.",
  },
  {
    ticker: "SHOP",
    targetPrice: 82,
    notes: "Growth software watchlist candidate.",
  },
  {
    ticker: "META",
    targetPrice: 540,
    notes: "Advertising and AI capex trend watch.",
  },
];

function addDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function round(value, places = 4) {
  return Number(value.toFixed(places));
}

function priceForDay(stock, dayIndex) {
  const cycle = Math.sin(dayIndex / 17) * stock.amplitude;
  const shorterCycle = Math.cos(dayIndex / 7) * stock.amplitude * 0.45;
  const growth = 1 + stock.dailyDrift * dayIndex;
  const close = stock.startPrice * growth * (1 + cycle + shorterCycle);
  const open = close * (1 - Math.sin(dayIndex / 5) * 0.006);
  const high = Math.max(open, close) * (1 + 0.008 + stock.amplitude * 0.12);
  const low = Math.min(open, close) * (1 - 0.007 - stock.amplitude * 0.1);

  return {
    open: round(open),
    high: round(high),
    low: round(low),
    close: round(close),
    volume: BigInt(
      Math.round(stock.volume * (1 + Math.sin(dayIndex / 11) * 0.18)),
    ),
  };
}

function createPriceRows(stockRecord, stockSeed) {
  return Array.from({ length: 366 }, (_, index) => {
    const dayIndex = index - 365;
    const timestamp = addDays(anchorDate, dayIndex);
    const price = priceForDay(stockSeed, index);

    return {
      stockId: stockRecord.id,
      timestamp,
      interval: PriceInterval.DAY,
      ...price,
    };
  });
}

async function seedStocks() {
  const records = new Map();

  for (const stock of stocks) {
    const record = await prisma.stock.upsert({
      where: { ticker: stock.ticker },
      update: {
        companyName: stock.companyName,
        sector: stock.sector,
        industry: stock.industry,
        exchange: stock.exchange,
        currency: "USD",
      },
      create: {
        ticker: stock.ticker,
        companyName: stock.companyName,
        sector: stock.sector,
        industry: stock.industry,
        exchange: stock.exchange,
        currency: "USD",
      },
    });

    records.set(stock.ticker, record);
    await prisma.stockPrice.createMany({
      data: createPriceRows(record, stock),
      skipDuplicates: true,
    });
  }

  return records;
}

async function seedPortfolio(user, stockRecords) {
  const existingPortfolio = await prisma.portfolio.findFirst({
    where: {
      userId: user.id,
      name: demoPortfolioName,
    },
    orderBy: { createdAt: "asc" },
  });

  const portfolio = existingPortfolio
    ? await prisma.portfolio.update({
        where: { id: existingPortfolio.id },
        data: {
          name: demoPortfolioName,
          baseCurrency: "USD",
        },
      })
    : await prisma.portfolio.create({
        data: {
          id: demoIds.portfolio,
          userId: user.id,
          name: demoPortfolioName,
          baseCurrency: "USD",
        },
      });

  const holdingRecords = [];

  for (const holding of holdings) {
    const stock = stockRecords.get(holding.ticker);
    const costBasis = round(holding.shares * holding.averageCost);
    const record = await prisma.holding.upsert({
      where: {
        portfolioId_stockId: {
          portfolioId: portfolio.id,
          stockId: stock.id,
        },
      },
      update: {
        shares: holding.shares,
        averageCost: holding.averageCost,
        costBasis,
      },
      create: {
        portfolioId: portfolio.id,
        stockId: stock.id,
        shares: holding.shares,
        averageCost: holding.averageCost,
        costBasis,
      },
    });

    holdingRecords.push({
      ...holding,
      id: record.id,
      stockId: stock.id,
      costBasis,
    });
  }

  for (const item of watchlistItems) {
    const stockId = stockRecords.get(item.ticker).id;

    await prisma.watchlistItem.upsert({
      where: {
        userId_stockId: {
          userId: user.id,
          stockId,
        },
      },
      update: {
        targetPrice: item.targetPrice,
        notes: item.notes,
      },
      create: {
        userId: user.id,
        stockId,
        targetPrice: item.targetPrice,
        notes: item.notes,
      },
    });
  }

  return { portfolio, holdingRecords };
}

async function seedSnapshots(portfolio, holdingRecords) {
  const pricesByStock = await prisma.stockPrice.findMany({
    where: {
      stockId: { in: holdingRecords.map((holding) => holding.stockId) },
    },
    orderBy: { timestamp: "asc" },
  });

  const priceMap = new Map();
  for (const price of pricesByStock) {
    const key = `${price.stockId}:${price.timestamp.toISOString()}`;
    priceMap.set(key, Number(price.close));
  }

  for (let index = 0; index < 366; index += 1) {
    const timestamp = addDays(anchorDate, index - 365);
    let totalValue = 0;
    let totalCostBasis = 0;

    for (const holding of holdingRecords) {
      const price = priceMap.get(
        `${holding.stockId}:${timestamp.toISOString()}`,
      );
      const marketValue = round(holding.shares * price);
      const gainLoss = round(marketValue - holding.costBasis);
      const gainLossPercent =
        holding.costBasis === 0 ? 0 : round(gainLoss / holding.costBasis, 6);

      totalValue += marketValue;
      totalCostBasis += holding.costBasis;

      await prisma.holdingSnapshot.upsert({
        where: {
          holdingId_timestamp: {
            holdingId: holding.id,
            timestamp,
          },
        },
        update: {
          price,
          marketValue,
          gainLoss,
          gainLossPercent,
        },
        create: {
          holdingId: holding.id,
          timestamp,
          price,
          marketValue,
          gainLoss,
          gainLossPercent,
        },
      });
    }

    const totalGainLoss = round(totalValue - totalCostBasis);
    const totalGainLossPercent = round(totalGainLoss / totalCostBasis, 6);

    await prisma.portfolioSnapshot.upsert({
      where: {
        portfolioId_timestamp: {
          portfolioId: portfolio.id,
          timestamp,
        },
      },
      update: {
        totalValue: round(totalValue),
        totalCostBasis: round(totalCostBasis),
        totalGainLoss,
        totalGainLossPercent,
      },
      create: {
        portfolioId: portfolio.id,
        timestamp,
        totalValue: round(totalValue),
        totalCostBasis: round(totalCostBasis),
        totalGainLoss,
        totalGainLossPercent,
      },
    });
  }
}

async function seedAlerts(user, portfolio, stockRecords) {
  const alerts = [
    {
      stock: "NVDA",
      type: AlertType.CONCENTRATION,
      severity: AlertSeverity.HIGH,
      title: "Semiconductor exposure is elevated",
      message:
        "NVDA is one of the largest positions in the demo portfolio. Review allocation before adding similar chip exposure.",
    },
    {
      stock: "TSLA",
      type: AlertType.VOLATILITY,
      severity: AlertSeverity.MEDIUM,
      title: "Watchlist volatility remains high",
      message:
        "TSLA has wider seeded price swings than the rest of the watchlist, making it useful for risk alert demos.",
    },
    {
      stock: "AMD",
      type: AlertType.WATCHLIST_MOVE,
      severity: AlertSeverity.LOW,
      title: "Watchlist peer moved near target zone",
      message:
        "AMD is seeded near the watchlist target range so later analytics can show a deterministic movement alert.",
    },
  ];

  for (const alert of alerts) {
    const stockId = stockRecords.get(alert.stock).id;
    const alertId = demoIds.alert(alert.stock, alert.type);
    const existingAlert = await prisma.alert.findFirst({
      where: {
        OR: [
          { id: alertId },
          {
            userId: user.id,
            portfolioId: portfolio.id,
            stockId,
            type: alert.type,
            title: alert.title,
          },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    const data = {
      userId: user.id,
      portfolioId: portfolio.id,
      stockId,
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      status: AlertStatus.ACTIVE,
      createdAt: addDays(anchorDate, -2),
      resolvedAt: null,
    };

    if (existingAlert) {
      await prisma.alert.update({
        where: { id: existingAlert.id },
        data,
      });
    } else {
      await prisma.alert.create({
        data: {
          id: alertId,
          ...data,
        },
      });
    }
  }
}

function seededAgentOutput(stock, agentName) {
  const label = agentName.toLowerCase().replaceAll("_", " ");
  const baseSource = {
    title: `PortfolioScope seeded ${label} dataset`,
    reference: `seed://research/${stock.ticker}/${label.replaceAll(" ", "-")}`,
    detail: "Deterministic demo input; no live API or LLM was used.",
  };

  const outputs = {
    [AgentName.NEWS]: {
      rating: AgentRating.MIXED,
      confidence: 0.76,
      summary: `${stock.companyName} has a seeded operating narrative tied to execution in ${stock.industry.toLowerCase()}.`,
      findings: [
        {
          label: "Seeded research scenario",
          detail: `Track execution and demand signals for ${stock.ticker} without treating the scenario as current news.`,
        },
      ],
      sources: [baseSource],
      warnings: [
        "This scenario is illustrative and may not reflect current events.",
      ],
    },
    [AgentName.FINANCIALS]: {
      rating: AgentRating.NEUTRAL,
      confidence: 0.72,
      summary: `${stock.companyName} has a qualitative seeded financial profile for research workflow demonstrations.`,
      findings: [
        {
          label: "Growth",
          detail: `Seeded ${stock.sector.toLowerCase()} growth profile`,
        },
        {
          label: "Margins",
          detail:
            "Margins remain sensitive to investment and operating mix in the demo scenario.",
        },
        {
          label: "Balance sheet",
          detail: "Seeded financial capacity is modeled as adequate.",
        },
      ],
      sources: [baseSource],
      warnings: [
        "The MVP does not include live filings, estimates, or valuation data.",
      ],
    },
    [AgentName.COMPETITORS]: {
      rating: AgentRating.NEUTRAL,
      confidence: 0.68,
      summary: `${stock.companyName} is positioned within the seeded ${stock.industry.toLowerCase()} peer context.`,
      findings: [
        { label: "Industry", detail: stock.industry },
        { label: "Sector", detail: stock.sector },
      ],
      sources: [baseSource],
      warnings: ["Peer coverage is limited to the ten-stock demo universe."],
    },
    [AgentName.POLITICAL_ACTIVITY]: {
      rating: AgentRating.NEUTRAL,
      confidence: 0.3,
      summary:
        "No verified political activity is included in the deterministic demo dataset.",
      findings: [],
      sources: [],
      warnings: [
        "Absence of seeded data is not evidence that no political activity occurred.",
      ],
    },
    [AgentName.RISK]: {
      rating: AgentRating.MIXED,
      confidence: 0.82,
      summary: `${stock.ticker} risk context is derived from deterministic price, sector, and portfolio inputs.`,
      findings: [
        {
          label: "Primary context",
          detail: `${stock.sector} exposure and seeded price variability should be reviewed together.`,
        },
      ],
      sources: [baseSource],
      warnings: [
        "Market and company-specific risk remain present even when rule thresholds are not triggered.",
      ],
    },
    [AgentName.SYNTHESIS]: {
      rating: AgentRating.MIXED,
      confidence: 0.66,
      summary: `${stock.companyName} has five visible deterministic specialist views with explicit evidence gaps.`,
      findings: [
        {
          label: "Research posture",
          detail:
            "Balance operating context against visible risk and missing live data.",
        },
      ],
      sources: [baseSource],
      warnings: [
        "This research context is not financial advice or an investment recommendation.",
      ],
    },
  };

  return outputs[agentName];
}

async function seedResearch(user, stockRecords) {
  const agentNames = [
    AgentName.NEWS,
    AgentName.FINANCIALS,
    AgentName.COMPETITORS,
    AgentName.POLITICAL_ACTIVITY,
    AgentName.RISK,
    AgentName.SYNTHESIS,
  ];

  for (const stock of stocks) {
    const stockRecord = stockRecords.get(stock.ticker);
    const researchJobId = demoIds.researchJob(stock.ticker);
    const existingJob = await prisma.researchJob.findFirst({
      where: {
        OR: [
          { id: researchJobId },
          {
            userId: user.id,
            stockId: stockRecord.id,
            createdAt: seededResearchCreatedAt,
            completedAt: anchorDate,
          },
        ],
      },
      orderBy: { id: "asc" },
    });
    const jobData = {
      userId: user.id,
      stockId: stockRecord.id,
      status: ResearchStatus.COMPLETED,
      requestedAgents: agentNames,
      createdAt: seededResearchCreatedAt,
      completedAt: anchorDate,
    };
    const job = existingJob
      ? await prisma.researchJob.update({
          where: { id: existingJob.id },
          data: jobData,
        })
      : await prisma.researchJob.create({
          data: {
            id: researchJobId,
            ...jobData,
          },
        });

    for (const agentName of agentNames) {
      const output = seededAgentOutput(stock, agentName);
      await prisma.agentRun.upsert({
        where: {
          researchJobId_agentName: {
            researchJobId: job.id,
            agentName,
          },
        },
        update: {
          status: AgentStatus.COMPLETED,
          rating: output.rating,
          confidence: output.confidence,
          summary: output.summary,
          findingsJson: output.findings,
          sourcesJson: output.sources,
          warningsJson: output.warnings,
          startedAt: seededResearchCreatedAt,
          completedAt: anchorDate,
        },
        create: {
          researchJobId: job.id,
          agentName,
          status: AgentStatus.COMPLETED,
          rating: output.rating,
          confidence: output.confidence,
          summary: output.summary,
          findingsJson: output.findings,
          sourcesJson: output.sources,
          warningsJson: output.warnings,
          startedAt: seededResearchCreatedAt,
          completedAt: anchorDate,
        },
      });
    }

    const reportData = {
      stockId: stockRecord.id,
      overview: `${stock.companyName} has five deterministic specialist views. The synthesis balances seeded operating context, peer coverage, and visible risk inputs; it is research context, not financial advice.`,
      bullCaseJson: [
        `The seeded ${stock.sector.toLowerCase()} profile provides supportive operating context.`,
      ],
      bearCaseJson: [
        "The demo does not include live valuation, estimates, or event data.",
      ],
      risksJson: ["Market, execution, and sector-specific risks remain relevant."],
      missingDataJson: [
        "Political activity and live filings are not included in the seeded dataset.",
      ],
      confidence: 0.66,
      generatedAt: anchorDate,
      expiresAt: addDays(anchorDate, 30),
    };

    await prisma.researchReport.upsert({
      where: { researchJobId: job.id },
      update: reportData,
      create: {
        researchJobId: job.id,
        ...reportData,
      },
    });
  }
}

async function main() {
  const user = await prisma.user.upsert({
    where: { email: demoUserEmail },
    update: {
      name: "Demo Investor",
    },
    create: {
      id: demoIds.user,
      name: "Demo Investor",
      email: demoUserEmail,
      createdAt: addDays(anchorDate, -365),
    },
  });

  const stockRecords = await seedStocks();
  const { portfolio, holdingRecords } = await seedPortfolio(user, stockRecords);

  await seedSnapshots(portfolio, holdingRecords);
  await seedAlerts(user, portfolio, stockRecords);
  await seedResearch(user, stockRecords);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
