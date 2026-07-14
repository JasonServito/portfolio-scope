export type SeededNewsItem = {
  headline: string;
  context: string;
  tone: "positive" | "neutral" | "mixed";
};

export type SeededFinancialSnapshot = {
  growthProfile: string;
  marginProfile: string;
  balanceSheetProfile: string;
};

export type ResearchProviderData = {
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
  news: SeededNewsItem[];
  financials: SeededFinancialSnapshot;
  competitors: { ticker: string; companyName: string; industry: string }[];
  politicalActivity: { summary: string; disclosed: boolean };
  risk: {
    oneMonthReturn: number;
    maxDailyMove: number;
    portfolioWeight: number | null;
    activeAlerts: string[];
  };
};

export interface ResearchProvider {
  getResearchData(ticker: string): Promise<ResearchProviderData | null>;
}
