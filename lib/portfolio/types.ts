export type Holding = {
  ticker: string;
  shares: number;
  averageCost: number;
  currentPrice: number;
};

export type PortfolioSummary = {
  marketValue: number;
  costBasis: number;
  unrealizedGain: number;
  unrealizedGainPercent: number;
};

export const PERFORMANCE_PERIODS = ["1D", "1W", "1M", "3M", "1Y"] as const;

export type PerformancePeriod = (typeof PERFORMANCE_PERIODS)[number];

export type SnapshotPoint = {
  date: string;
  value: number;
};

export type AllocationItem = {
  key: string;
  label: string;
  value: number;
  percentage: number;
};

export type HoldingAnalytics = {
  id: string;
  ticker: string;
  companyName: string;
  sector: string;
  shares: number;
  averageCost: number;
  costBasis: number;
  currentPrice: number;
  marketValue: number;
  allocationPercent: number;
  periodStartValue: number;
  periodEndValue: number;
  periodReturn: number;
  dollarContribution: number;
  portfolioContributionPercent: number;
  totalGainLoss: number;
  totalGainLossPercent: number;
};

export type WinnerLoser = Pick<
  HoldingAnalytics,
  | "id"
  | "ticker"
  | "companyName"
  | "marketValue"
  | "periodReturn"
  | "dollarContribution"
  | "portfolioContributionPercent"
>;

export type PortfolioAnalytics = {
  portfolio: {
    id: string;
    name: string;
    baseCurrency: string;
  };
  period: PerformancePeriod;
  asOf: string;
  summary: PortfolioSummary & {
    periodStartValue: number;
    periodEndValue: number;
    periodReturn: number;
    periodGainLoss: number;
  };
  holdings: HoldingAnalytics[];
  allocationByHolding: AllocationItem[];
  allocationBySector: AllocationItem[];
  performance: SnapshotPoint[];
  topWinners: WinnerLoser[];
  topLosers: WinnerLoser[];
};
