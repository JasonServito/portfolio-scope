import { AgentName, Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { demoPortfolioName } from "@/lib/demo";
import { runCompetitorsAgent } from "@/lib/research/agents/competitors-agent";
import { runFinancialsAgent } from "@/lib/research/agents/financials-agent";
import { runNewsAgent } from "@/lib/research/agents/news-agent";
import { runPoliticalActivityAgent } from "@/lib/research/agents/political-activity-agent";
import { runRiskAgent } from "@/lib/research/agents/risk-agent";
import { seededResearchProvider } from "@/lib/research/providers/seeded-provider";
import { synthesizeResearch } from "@/lib/research/synthesis-agent";
import {
  SPECIALIST_AGENT_NAMES,
  type AgentResult,
  type ResearchFinding,
  type ResearchRating,
  type ResearchSource,
  type StockResearch,
} from "@/lib/research/types";

const ALL_AGENT_NAMES = [...SPECIALIST_AGENT_NAMES, "SYNTHESIS"] as const;
const REPORT_TTL_DAYS = 30;

function expiresAtFrom(date: Date) {
  const expiresAt = new Date(date);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + REPORT_TTL_DAYS);
  return expiresAt;
}

function jsonArray<T>(value: Prisma.JsonValue): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asAgentResult(run: {
  agentName: string;
  status: string;
  rating: string | null;
  confidence: { toNumber(): number } | null;
  summary: string;
  findingsJson: Prisma.JsonValue;
  sourcesJson: Prisma.JsonValue;
  warningsJson: Prisma.JsonValue;
}): AgentResult {
  return {
    agentName: run.agentName as AgentResult["agentName"],
    status: run.status === "FAILED" ? "FAILED" : "COMPLETED",
    rating: (run.rating ?? "NEUTRAL") as ResearchRating,
    confidence: run.confidence?.toNumber() ?? 0,
    summary: run.summary,
    findings: jsonArray<ResearchFinding>(run.findingsJson),
    sources: jsonArray<ResearchSource>(run.sourcesJson),
    warnings: jsonArray<string>(run.warningsJson),
  };
}

export async function getLatestResearch(
  ticker: string,
): Promise<StockResearch | null> {
  const symbol = ticker.toUpperCase();
  const job = await db.researchJob.findFirst({
    where: {
      stock: { ticker: symbol },
      user: { portfolios: { some: { name: demoPortfolioName } } },
      status: "COMPLETED",
      report: { isNot: null },
    },
    include: { stock: true, agentRuns: true, report: true },
    orderBy: { completedAt: "desc" },
  });

  if (!job?.report) return null;
  const order = new Map(ALL_AGENT_NAMES.map((name, index) => [name, index]));

  return {
    jobId: job.id,
    ticker: job.stock.ticker,
    companyName: job.stock.companyName,
    status: "COMPLETED",
    generatedAt: job.report.generatedAt.toISOString(),
    expiresAt: job.report.expiresAt.toISOString(),
    agents: job.agentRuns
      .map(asAgentResult)
      .sort(
        (a, b) =>
          (order.get(a.agentName) ?? 99) - (order.get(b.agentName) ?? 99),
      ),
    report: {
      overview: job.report.overview,
      bullCase: jsonArray<string>(job.report.bullCaseJson),
      bearCase: jsonArray<string>(job.report.bearCaseJson),
      risks: jsonArray<string>(job.report.risksJson),
      missingData: jsonArray<string>(job.report.missingDataJson),
      confidence: job.report.confidence.toNumber(),
    },
  };
}

export async function runResearch(
  ticker: string,
): Promise<StockResearch | null> {
  const symbol = ticker.toUpperCase();
  const [user, stock] = await Promise.all([
    db.user.findFirst({
      where: { portfolios: { some: { name: demoPortfolioName } } },
    }),
    db.stock.findUnique({ where: { ticker: symbol } }),
  ]);
  if (!user || !stock) return null;

  const job = await db.researchJob.create({
    data: {
      userId: user.id,
      stockId: stock.id,
      status: "RUNNING",
      requestedAgents: ALL_AGENT_NAMES.map((name) => AgentName[name]),
    },
  });

  try {
    const providerData = await seededResearchProvider.getResearchData(symbol);
    if (!providerData)
      throw new Error("Seeded research inputs are unavailable.");

    const agents = [
      runNewsAgent(providerData),
      runFinancialsAgent(providerData),
      runCompetitorsAgent(providerData),
      runPoliticalActivityAgent(providerData),
      runRiskAgent(providerData),
    ];
    const report = synthesizeResearch(stock.companyName, agents);
    const synthesis: AgentResult = {
      agentName: "SYNTHESIS",
      status: "COMPLETED",
      rating: "MIXED",
      confidence: report.confidence,
      summary: report.overview,
      findings: [
        ...report.bullCase.map((detail) => ({
          label: "Supportive context",
          detail,
        })),
        ...report.bearCase.map((detail) => ({ label: "Counterpoint", detail })),
      ],
      sources: agents.flatMap((agent) => agent.sources),
      warnings: report.risks,
    };
    const completedAt = new Date();

    await db.$transaction([
      ...[...agents, synthesis].map((result) =>
        db.agentRun.create({
          data: {
            researchJobId: job.id,
            agentName: AgentName[result.agentName],
            status: result.status,
            rating: result.rating,
            confidence: result.confidence,
            summary: result.summary,
            findingsJson: result.findings,
            sourcesJson: result.sources,
            warningsJson: result.warnings,
            completedAt,
          },
        }),
      ),
      db.researchReport.create({
        data: {
          researchJobId: job.id,
          stockId: stock.id,
          overview: report.overview,
          bullCaseJson: report.bullCase,
          bearCaseJson: report.bearCase,
          risksJson: report.risks,
          missingDataJson: report.missingData,
          confidence: report.confidence,
          generatedAt: completedAt,
          expiresAt: expiresAtFrom(completedAt),
        },
      }),
      db.researchJob.update({
        where: { id: job.id },
        data: { status: "COMPLETED", completedAt },
      }),
    ]);
  } catch (error) {
    await db.researchJob.update({
      where: { id: job.id },
      data: { status: "FAILED", completedAt: new Date() },
    });
    throw error;
  }

  return getLatestResearch(symbol);
}
