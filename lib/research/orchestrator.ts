import type { ResearchReport } from "@/lib/research/types";
import { synthesizeResearch } from "@/lib/research/synthesis-agent";

export async function createResearchReport(ticker: string): Promise<ResearchReport> {
  return {
    ticker: ticker.toUpperCase(),
    signals: [],
    synthesis: synthesizeResearch([]),
  };
}
