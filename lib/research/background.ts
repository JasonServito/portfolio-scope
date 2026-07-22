import {
  AgentName,
  AgentStatus,
  BackgroundJobStatus,
  BackgroundJobType,
  Prisma,
  ResearchStatus,
} from "@prisma/client";

import { db } from "@/lib/db";
import { JobExecutionError } from "@/lib/jobs/errors";
import { enqueueBackgroundJob } from "@/lib/jobs/service";
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
  type SpecialistAgentName,
} from "@/lib/research/types";

const REPORT_TTL_DAYS = 30;

function expiresAtFrom(date: Date) {
  const expiresAt = new Date(date);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + REPORT_TTL_DAYS);
  return expiresAt;
}

function jsonArray<T>(value: Prisma.JsonValue): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function storedAgentResult(run: {
  agentName: AgentName;
  status: AgentStatus;
  rating: string | null;
  confidence: { toNumber(): number } | null;
  summary: string;
  findingsJson: Prisma.JsonValue;
  sourcesJson: Prisma.JsonValue;
  warningsJson: Prisma.JsonValue;
}): AgentResult {
  return {
    agentName: run.agentName,
    status: run.status === AgentStatus.FAILED ? "FAILED" : "COMPLETED",
    rating: (run.rating ?? "NEUTRAL") as ResearchRating,
    confidence: run.confidence?.toNumber() ?? 0,
    summary: run.summary,
    findings: jsonArray<ResearchFinding>(run.findingsJson),
    sources: jsonArray<ResearchSource>(run.sourcesJson),
    warnings: jsonArray<string>(run.warningsJson),
  };
}

function runSpecialist(agentName: SpecialistAgentName, data: Parameters<typeof runNewsAgent>[0]) {
  switch (agentName) {
    case "NEWS":
      return runNewsAgent(data);
    case "FINANCIALS":
      return runFinancialsAgent(data);
    case "COMPETITORS":
      return runCompetitorsAgent(data);
    case "POLITICAL_ACTIVITY":
      return runPoliticalActivityAgent(data);
    case "RISK":
      return runRiskAgent(data);
  }
}

export async function executeResearchAgent(input: {
  researchJobId: string;
  agentName: SpecialistAgentName;
  userId: string;
  correlationId: string;
}) {
  const researchJob = await db.researchJob.findFirst({
    where: { id: input.researchJobId, userId: input.userId },
    include: { stock: true },
  });
  if (!researchJob || researchJob.status === ResearchStatus.CANCELLED) {
    throw new JobExecutionError(
      "RESEARCH_JOB_NOT_FOUND",
      false,
      "The owned research job no longer exists.",
    );
  }

  await db.$transaction([
    db.researchJob.update({
      where: { id: researchJob.id },
      data: {
        status: ResearchStatus.RUNNING,
        startedAt: researchJob.startedAt ?? new Date(),
      },
    }),
    db.agentRun.upsert({
      where: {
        researchJobId_agentName: {
          researchJobId: researchJob.id,
          agentName: input.agentName,
        },
      },
      update: { status: AgentStatus.RUNNING, startedAt: new Date() },
      create: {
        researchJobId: researchJob.id,
        agentName: input.agentName,
        status: AgentStatus.RUNNING,
        summary: "",
        findingsJson: [],
        sourcesJson: [],
        warningsJson: [],
      },
    }),
  ]);

  let completedSpecialists: number;
  try {
    const providerData = await seededResearchProvider.getResearchData(
      researchJob.stock.ticker,
      { userId: input.userId },
    );
    if (!providerData) {
      throw new JobExecutionError(
        "RESEARCH_INPUT_UNAVAILABLE",
        false,
        "Deterministic research inputs are unavailable.",
      );
    }
    const result = runSpecialist(input.agentName, providerData);
    const completedAt = new Date();
    await db.agentRun.update({
      where: {
        researchJobId_agentName: {
          researchJobId: researchJob.id,
          agentName: input.agentName,
        },
      },
      data: {
        status: AgentStatus.COMPLETED,
        rating: result.rating,
        confidence: result.confidence,
        summary: result.summary,
        findingsJson: result.findings,
        sourcesJson: result.sources,
        warningsJson: result.warnings,
        completedAt,
      },
    });

    const specialistStates = await db.agentRun.findMany({
      where: {
        researchJobId: researchJob.id,
        agentName: { in: [...SPECIALIST_AGENT_NAMES] },
      },
      select: { status: true },
    });
    completedSpecialists = specialistStates.filter(
      ({ status }) => status === AgentStatus.COMPLETED,
    ).length;
    const failedSpecialists = specialistStates.filter(
      ({ status }) => status === AgentStatus.FAILED,
    ).length;
    const parent = await db.researchJob.findUnique({
      where: { id: researchJob.id },
      select: { status: true },
    });
    if (parent?.status === ResearchStatus.CANCELLED) {
      return {
        researchJobId: researchJob.id,
        agentName: input.agentName,
        completedSpecialists,
        cancelled: true,
      };
    }

    if (completedSpecialists !== SPECIALIST_AGENT_NAMES.length) {
      await db.researchJob.updateMany({
        where: {
          id: researchJob.id,
          status: { not: ResearchStatus.CANCELLED },
        },
        data: {
          status:
            failedSpecialists > 0
              ? ResearchStatus.PARTIALLY_COMPLETED
              : ResearchStatus.RUNNING,
        },
      });
    }

    if (completedSpecialists === SPECIALIST_AGENT_NAMES.length) {
      const synthesis = await enqueueBackgroundJob({
        type: BackgroundJobType.RESEARCH_SYNTHESIS,
        idempotencyKey: `research:${researchJob.id}:synthesis`,
        correlationId: input.correlationId,
        payload: { researchJobId: researchJob.id },
        userId: input.userId,
        researchJobId: researchJob.id,
      });
      if (
        synthesis.status === BackgroundJobStatus.FAILED ||
        synthesis.status === BackgroundJobStatus.PARTIALLY_COMPLETED ||
        synthesis.status === BackgroundJobStatus.CANCELLED
      ) {
        throw new JobExecutionError(
          "RESEARCH_SYNTHESIS_DISPATCH_FAILED",
          true,
          "Research synthesis requires an administrator retry.",
          true,
        );
      }
    }

    return {
      researchJobId: researchJob.id,
      agentName: input.agentName,
      completedSpecialists,
    };
  } catch (error) {
    const completedRun = await db.agentRun.findUnique({
      where: {
        researchJobId_agentName: {
          researchJobId: researchJob.id,
          agentName: input.agentName,
        },
      },
      select: { status: true },
    });
    if (completedRun?.status === AgentStatus.COMPLETED) {
      await db.researchJob.updateMany({
        where: {
          id: researchJob.id,
          status: { not: ResearchStatus.CANCELLED },
        },
        data: { status: ResearchStatus.PARTIALLY_COMPLETED },
      });
      if (error instanceof JobExecutionError) throw error;
      throw new JobExecutionError(
        "RESEARCH_SYNTHESIS_DISPATCH_FAILED",
        true,
        "Research synthesis could not be dispatched.",
        true,
        { cause: error },
      );
    }

    await db.$transaction([
      db.agentRun.update({
        where: {
          researchJobId_agentName: {
            researchJobId: researchJob.id,
            agentName: input.agentName,
          },
        },
        data: {
          status: AgentStatus.FAILED,
          completedAt: new Date(),
        },
      }),
      db.researchJob.updateMany({
        where: {
          id: researchJob.id,
          status: { not: ResearchStatus.CANCELLED },
        },
        data: { status: ResearchStatus.PARTIALLY_COMPLETED },
      }),
    ]);
    if (error instanceof JobExecutionError) throw error;
    throw new JobExecutionError(
      "RESEARCH_AGENT_FAILED",
      true,
      "A deterministic research agent failed.",
      true,
      { cause: error },
    );
  }
}

export async function executeResearchSynthesis(input: {
  researchJobId: string;
  userId: string;
}) {
  const researchJob = await db.researchJob.findFirst({
    where: { id: input.researchJobId, userId: input.userId },
    include: { stock: true, agentRuns: true },
  });
  if (!researchJob || researchJob.status === ResearchStatus.CANCELLED) {
    throw new JobExecutionError(
      "RESEARCH_JOB_NOT_FOUND",
      false,
      "The owned research job no longer exists.",
    );
  }

  const specialists = researchJob.agentRuns.filter(
    (run) =>
      run.agentName !== AgentName.SYNTHESIS &&
      run.status === AgentStatus.COMPLETED,
  );
  if (specialists.length !== SPECIALIST_AGENT_NAMES.length) {
    throw new JobExecutionError(
      "RESEARCH_INPUTS_PENDING",
      true,
      "Research synthesis is waiting for specialist results.",
      true,
    );
  }

  const agentResults = specialists.map(storedAgentResult);
  const report = synthesizeResearch(researchJob.stock.companyName, agentResults);
  const synthesis: AgentResult = {
    agentName: "SYNTHESIS",
    status: "COMPLETED",
    rating: "MIXED",
    confidence: report.confidence,
    summary: report.overview,
    findings: [
      ...report.bullCase.map((detail) => ({ label: "Supportive context", detail })),
      ...report.bearCase.map((detail) => ({ label: "Counterpoint", detail })),
    ],
    sources: agentResults.flatMap((agent) => agent.sources),
    warnings: report.risks,
  };
  const completedAt = new Date();

  await db.$transaction([
    db.agentRun.upsert({
      where: {
        researchJobId_agentName: {
          researchJobId: researchJob.id,
          agentName: AgentName.SYNTHESIS,
        },
      },
      update: {
        status: AgentStatus.COMPLETED,
        rating: synthesis.rating,
        confidence: synthesis.confidence,
        summary: synthesis.summary,
        findingsJson: synthesis.findings,
        sourcesJson: synthesis.sources,
        warningsJson: synthesis.warnings,
        completedAt,
      },
      create: {
        researchJobId: researchJob.id,
        agentName: AgentName.SYNTHESIS,
        status: AgentStatus.COMPLETED,
        rating: synthesis.rating,
        confidence: synthesis.confidence,
        summary: synthesis.summary,
        findingsJson: synthesis.findings,
        sourcesJson: synthesis.sources,
        warningsJson: synthesis.warnings,
        completedAt,
      },
    }),
    db.researchReport.upsert({
      where: { researchJobId: researchJob.id },
      update: {
        overview: report.overview,
        bullCaseJson: report.bullCase,
        bearCaseJson: report.bearCase,
        risksJson: report.risks,
        missingDataJson: report.missingData,
        confidence: report.confidence,
        generatedAt: completedAt,
        expiresAt: expiresAtFrom(completedAt),
      },
      create: {
        researchJobId: researchJob.id,
        stockId: researchJob.stockId,
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
      where: { id: researchJob.id },
      data: { status: ResearchStatus.COMPLETED, completedAt },
    }),
  ]);

  return { researchJobId: researchJob.id, completedAt: completedAt.toISOString() };
}
