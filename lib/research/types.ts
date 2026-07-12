export type ResearchSignal = {
  source: string;
  summary: string;
  confidence: "low" | "medium" | "high";
};

export type ResearchReport = {
  ticker: string;
  signals: ResearchSignal[];
  synthesis: string;
};
