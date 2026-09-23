import { randomUUID } from "node:crypto";

import {
  AgentName,
  AgentStatus,
  ResearchGenerationMode,
  ResearchStatus,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import type { JobPublisher } from "@/lib/jobs/qstash";
import {
  AI_OUTPUT_SCHEMA_VERSION,
  AI_PROMPT_VERSION,
  AI_REPORT_VERSION,
  getAiResearchConfig,
} from "@/lib/research/ai/config";
import { computeEvidenceCoverage } from "@/lib/research/ai/evidence-coverage";
import {
  AAPL_FIXTURE_FILING_DOCUMENTS,
  AAPL_FIXTURE_PEERS,
  AAPL_FIXTURE_STOCK,
  AAPL_FIXTURE_UPCOMING_EARNINGS,
  aaplFixtureFactCandidates,
  aaplFixtureFilingPassages,
  aaplFixturePeerFactCandidates,
} from "@/lib/research/ai/fixtures/aapl-evidence-snapshot";
import {
  AAPL_GROUNDED_SYNTHESIS,
  AAPL_RECORDED_SPECIALIST_OUTPUTS,
  CURATED_AAPL_SNAPSHOT,
} from "@/lib/research/ai/fixtures/curated-evaluation";
import { RecordedResearchModelProvider } from "@/lib/research/ai/providers";
import { assembleResearchEvidenceSnapshot } from "@/lib/research/ai/retrieval";
import type {
  GroundedModelOutput,
  SpecialistModelOutput,
} from "@/lib/research/ai/schemas";
import {
  executeResearchAgent,
  executeResearchSynthesis,
} from "@/lib/research/background";
import { getOwnedResearchJob, runResearch } from "@/lib/research/orchestrator";
import { EXTERNAL_SPECIALIST_AGENT_NAMES } from "@/lib/research/types";

const runId = randomUUID().replaceAll("-", "");
const prefix = `m30-${runId}`;
const ticker = `Z${runId.slice(0, 8).toUpperCase()}`;
const ids = {
  user: `${prefix}-user`,
  faultUser: `${prefix}-fault-user`,
  legacyUser: `${prefix}-legacy-user`,
  stock: `${prefix}-stock`,
  subjectCompany: `${prefix}-subject-company`,
  subjectEntity: `${prefix}-subject-entity`,
  filing10k: `${prefix}-filing-10k`,
  filing10q: `${prefix}-filing-10q`,
  raw10k: `${prefix}-raw-10k`,
  raw10q: `${prefix}-raw-10q`,
};
const fixtureUserIds = [ids.user, ids.faultUser, ids.legacyUser];
const subjectCik = String(
  (Number.parseInt(runId.slice(8, 16), 16) % 1_000_000_000) + 2,
).padStart(10, "0");
// Run-specific accession numbers keep the fixture filings unique per run.
const accessionSuffix = String(
  Number.parseInt(runId.slice(16, 22), 16) % 1_000_000,
).padStart(6, "0");
const accessions = {
  "10-K": `0000320193-93-${accessionSuffix}`,
  "10-Q": `0000320193-92-${accessionSuffix}`,
} as const;
const filingPassages = aaplFixtureFilingPassages({
  "10-K": {
    filingId: ids.filing10k,
    rawSourceId: ids.raw10k,
    accessionNumber: accessions["10-K"],
  },
  "10-Q": {
    filingId: ids.filing10q,
    rawSourceId: ids.raw10q,
    accessionNumber: accessions["10-Q"],
  },
});

const environment = {
  NODE_ENV: "test",
  NEXT_PUBLIC_APP_URL: "https://portfolioscope.invalid",
  BACKGROUND_JOBS_ENABLED: "true",
  RESEARCH_GENERATION_ENABLED: "true",
  AI_RESEARCH_ENABLED: "true",
  OPENAI_API_KEY: "recorded-provider-only-no-network",
  OPENAI_RESEARCH_MODEL: "gpt-5.4-mini-2026-03-17",
  AI_MONTHLY_BUDGET_USD: "5",
  AI_USER_MONTHLY_BUDGET_USD: "1",
  AI_MAX_COST_PER_JOB_USD: "0.25",
  AI_MAX_TOKENS_PER_JOB: "50000",
  AI_MAX_OUTPUT_TOKENS_PER_CALL: "2000",
  AI_PROVIDER_TIMEOUT_MS: "20000",
  AI_USER_MONTHLY_REPORT_LIMIT: "5",
} as NodeJS.ProcessEnv;

const publisher: JobPublisher = {
  publishJSON: vi.fn().mockImplementation(async () => ({
    messageId: `${prefix}-${randomUUID()}`,
  })),
};

// The AAPL fixture snapshot re-keyed to this run's catalog stock so the
// persisted snapshot passes the job/stock identity check.
const snapshot = assembleResearchEvidenceSnapshot({
  record: { ...AAPL_FIXTURE_STOCK, id: ids.stock, ticker },
  factCandidates: aaplFixtureFactCandidates(),
  peerRecords: AAPL_FIXTURE_PEERS,
  peerFactCandidates: aaplFixturePeerFactCandidates(),
  upcomingEarnings: AAPL_FIXTURE_UPCOMING_EARNINGS,
  filingPassages,
});

const evidenceIdByReference = new Map(
  snapshot.evidence.map((item) => [item.sourceReference, item.id]),
);
const fixtureReferenceById = new Map(
  CURATED_AAPL_SNAPSHOT.evidence.map((item) => [item.id, item.sourceReference]),
);
function rekey(id: string) {
  const reference = fixtureReferenceById
    .get(id)!
    .replaceAll("AAPL", ticker)
    .replaceAll(
      AAPL_FIXTURE_FILING_DOCUMENTS["10-K"].accessionNumber,
      accessions["10-K"],
    )
    .replaceAll(
      AAPL_FIXTURE_FILING_DOCUMENTS["10-Q"].accessionNumber,
      accessions["10-Q"],
    );
  const mapped = evidenceIdByReference.get(reference);
  if (!mapped) throw new Error(`No run evidence for ${reference}`);
  return mapped;
}
function rekeyOutput<T extends GroundedModelOutput>(output: T): T {
  return {
    ...output,
    claims: output.claims.map((claim) => ({
      ...claim,
      evidenceIds: claim.evidenceIds.map(rekey),
      counterEvidenceIds: claim.counterEvidenceIds.map(rekey),
    })),
  };
}

const recordedOutputs = {
  FINANCIALS: rekeyOutput(AAPL_RECORDED_SPECIALIST_OUTPUTS.FINANCIALS),
  COMPETITORS: rekeyOutput(AAPL_RECORDED_SPECIALIST_OUTPUTS.COMPETITORS),
  RISK: rekeyOutput(AAPL_RECORDED_SPECIALIST_OUTPUTS.RISK),
  SYNTHESIS: rekeyOutput(AAPL_GROUNDED_SYNTHESIS),
};

function recordedProvider(outputs: readonly GroundedModelOutput[]) {
  return new RecordedResearchModelProvider({
    model: "recorded-m30-integration-v1",
    fixtures: outputs.map((output, index) => ({
      result: {
        output,
        providerRequestId: `${prefix}-recording-${index + 1}`,
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    })),
  });
}

async function queueExternalJob(userId: string, regenerate = false) {
  const queued = await runResearch(userId, ticker, {
    publisher,
    environment,
    regenerate,
    prepareSnapshot: async () => snapshot,
  });
  if (!queued || !("jobId" in queued)) {
    throw new Error("The external research job was not queued.");
  }
  return queued;
}

async function runAllScheduledAgents(
  jobId: string,
  userId: string,
  correlationId: string,
  provider: RecordedResearchModelProvider,
) {
  const config = getAiResearchConfig(environment);
  const results = [];
  for (const agentName of EXTERNAL_SPECIALIST_AGENT_NAMES) {
    results.push(
      await executeResearchAgent(
        { researchJobId: jobId, agentName, userId, correlationId },
        { provider, config, environment, publisher },
      ),
    );
  }
  await executeResearchSynthesis(
    { researchJobId: jobId, userId },
    { provider, config, environment },
  );
  return results;
}

async function cleanup() {
  await db.backgroundJob.deleteMany({
    where: {
      OR: [
        { idempotencyKey: { startsWith: prefix } },
        { userId: { in: fixtureUserIds } },
        { researchJob: { userId: { in: fixtureUserIds } } },
      ],
    },
  });
  await db.aiUsage.deleteMany({
    where: {
      OR: [
        { idempotencyKey: { startsWith: prefix } },
        { userId: { in: fixtureUserIds } },
      ],
    },
  });
  await db.aiBudgetPeriod.deleteMany({
    where: { userId: { in: fixtureUserIds } },
  });
  await db.researchJob.deleteMany({
    where: { userId: { in: fixtureUserIds } },
  });
  await db.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
  await db.stock.deleteMany({ where: { id: ids.stock } });
  await db.company.deleteMany({ where: { id: ids.subjectCompany } });
}

beforeAll(async () => {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  ) {
    throw new Error("M30 integration tests must not run against production.");
  }
  await cleanup();
  await db.user.createMany({
    data: fixtureUserIds.map((id) => ({
      id,
      email: `${id}@portfolioscope.invalid`,
    })),
  });
  await db.stock.create({
    data: {
      id: ids.stock,
      ticker,
      companyName: snapshot.stock.companyName,
      sector: snapshot.stock.sector,
      industry: snapshot.stock.industry,
      exchange: snapshot.stock.exchange,
    },
  });
  // Filing and raw-document rows behind the fixture passages, so persisted
  // passage citations can hold their filing and object-store foreign keys.
  const passageFilings = (["10-K", "10-Q"] as const).map(
    (formType) =>
      filingPassages.find((passage) => passage.filing.formType === formType)!,
  );
  await db.company.create({
    data: {
      id: ids.subjectCompany,
      slug: `${prefix}-subject`,
      name: "Subject Filing Fixture",
      isSupported: true,
      secEntity: {
        create: {
          id: ids.subjectEntity,
          cik: subjectCik,
          legalName: "Subject Filing Fixture Inc.",
          filings: {
            create: passageFilings.map((record) => ({
              id: record.filing.id,
              accessionNumber: record.filing.accessionNumber,
              formType: record.filing.formType,
              filingDate: record.filing.filingDate as Date,
              reportDate: record.filing.reportDate as Date,
              primaryDocument: record.filing.primaryDocument,
              sourceUrl: record.filing.sourceUrl,
            })),
          },
          rawSources: {
            create: passageFilings.map((record) => ({
              id: record.rawSource.id,
              kind: "FILING_DOCUMENT" as const,
              sourceUrl: record.rawSource.sourceUrl,
              objectKey: `sec/${subjectCik}/filings/${record.rawSource.sha256}.htm`,
              sha256: record.rawSource.sha256,
              contentType: "text/html",
              byteLength: Number(String(record.rawSource.byteLength)),
              firstRetrievedAt: record.rawSource.firstRetrievedAt as Date,
              lastRetrievedAt: record.rawSource.lastRetrievedAt as Date,
            })),
          },
        },
      },
    },
  });
});

afterAll(cleanup);

describe("M30 specialist contracts and calibration", () => {
  it("schedules four specialists, persists availability, claim kinds, coverage, and what would change, and keeps history and diff working", async () => {
    const provider = recordedProvider([
      recordedOutputs.FINANCIALS,
      recordedOutputs.COMPETITORS,
      recordedOutputs.RISK,
      recordedOutputs.SYNTHESIS,
    ]);
    const generate = vi.spyOn(provider, "generate");
    const queued = await queueExternalJob(ids.user);
    const yesterday = new Date(Date.now() - 86_400_000);
    yesterday.setUTCHours(23, 59, 0, 0);
    await db.researchJob.update({
      where: { id: queued.jobId },
      data: { createdAt: yesterday },
    });

    // Political activity is no longer scheduled; the enum value remains.
    const created = await db.researchJob.findUniqueOrThrow({
      where: { id: queued.jobId },
      include: { agentRuns: true },
    });
    expect(created.agentRuns.map((run) => run.agentName).sort()).toEqual(
      [...EXTERNAL_SPECIALIST_AGENT_NAMES].sort(),
    );
    expect(created.requestedAgents).not.toContain(AgentName.POLITICAL_ACTIVITY);
    expect(created.requestedAgents).toContain(AgentName.SYNTHESIS);
    await expect(
      db.backgroundJob.count({
        where: { researchJobId: queued.jobId, type: "RESEARCH_AGENT_RUN" },
      }),
    ).resolves.toBe(EXTERNAL_SPECIALIST_AGENT_NAMES.length);

    // Four-specialist readiness: synthesis is not enqueued until the fourth
    // scheduled specialist completes, and the stub never blocks it.
    const config = getAiResearchConfig(environment);
    const partialOrder = ["NEWS", "FINANCIALS", "COMPETITORS"] as const;
    for (const agentName of partialOrder) {
      await executeResearchAgent(
        {
          researchJobId: queued.jobId,
          agentName,
          userId: ids.user,
          correlationId: queued.correlationId!,
        },
        { provider, config, environment, publisher },
      );
    }
    await expect(
      db.backgroundJob.count({
        where: { researchJobId: queued.jobId, type: "RESEARCH_SYNTHESIS" },
      }),
    ).resolves.toBe(0);
    await executeResearchAgent(
      {
        researchJobId: queued.jobId,
        agentName: "RISK",
        userId: ids.user,
        correlationId: queued.correlationId!,
      },
      { provider, config, environment, publisher },
    );
    await expect(
      db.backgroundJob.count({
        where: { researchJobId: queued.jobId, type: "RESEARCH_SYNTHESIS" },
      }),
    ).resolves.toBe(1);
    await executeResearchSynthesis(
      { researchJobId: queued.jobId, userId: ids.user },
      { provider, config, environment },
    );
    expect(generate).toHaveBeenCalledTimes(4);

    // The stubbed specialist persists NOT_AVAILABLE and reaches synthesis as
    // an availability state with its gap, never as a neutral opinion.
    const stored = await db.researchJob.findUniqueOrThrow({
      where: { id: queued.jobId },
      include: {
        agentRuns: true,
        report: { include: { claims: { orderBy: { ordinal: "asc" } } } },
      },
    });
    const runsByName = new Map(stored.agentRuns.map((run) => [run.agentName, run]));
    expect(runsByName.get(AgentName.NEWS)).toMatchObject({
      status: AgentStatus.COMPLETED,
      availability: "NOT_AVAILABLE",
      provider: "bounded-missing-data",
      rating: "NEUTRAL",
      claimsJson: [],
    });
    expect(runsByName.get(AgentName.FINANCIALS)?.availability).toBe("COMPLETE");
    expect(runsByName.get(AgentName.COMPETITORS)?.availability).toBe("PARTIAL");
    expect(runsByName.has(AgentName.POLITICAL_ACTIVITY)).toBe(false);
    const synthesisRequest = JSON.parse(
      String(generate.mock.calls[3][0].input),
    ) as { specialists: Array<Record<string, unknown>> };
    const newsForSynthesis = synthesisRequest.specialists.find(
      (specialist) => specialist.agentName === "NEWS",
    );
    expect(newsForSynthesis).toMatchObject({
      availability: "NOT_AVAILABLE",
      claims: [],
    });
    for (const specialist of synthesisRequest.specialists) {
      expect(specialist).not.toHaveProperty("rating");
      expect(specialist).not.toHaveProperty("confidence");
    }
    expect(synthesisRequest.specialists.map((item) => item.agentName)).not.toContain(
      "POLITICAL_ACTIVITY",
    );

    // Every persisted claim carries a kind; the report carries the additive
    // coverage and what-would-change fields with the bumped versions.
    expect(stored.status).toBe(ResearchStatus.COMPLETED);
    expect(stored.report).toMatchObject({
      promptVersion: AI_PROMPT_VERSION,
      outputSchemaVersion: AI_OUTPUT_SCHEMA_VERSION,
      reportVersion: AI_REPORT_VERSION,
      whatWouldChangeJson: recordedOutputs.SYNTHESIS.whatWouldChange,
    });
    expect(stored.report?.claims.map((claim) => claim.kind)).toEqual(
      recordedOutputs.SYNTHESIS.claims.map((claim) => claim.kind),
    );
    expect(stored.report?.claims.every((claim) => claim.kind !== null)).toBe(true);
    const expectedCoverage = computeEvidenceCoverage(
      snapshot,
      yesterday.toISOString().slice(0, 10),
    );
    expect(stored.report?.evidenceCoverageJson).toEqual(expectedCoverage);
    expect(expectedCoverage.score).toBeGreaterThan(0);
    expect(expectedCoverage.newestFilingDate).not.toBeNull();

    const owned = await getOwnedResearchJob(ids.user, queued.jobId);
    expect(owned?.research?.report).toMatchObject({
      evidenceCoverage: expectedCoverage,
      whatWouldChange: recordedOutputs.SYNTHESIS.whatWouldChange,
      upcomingEarnings: { eventDate: "2026-10-29", marketSession: "AFTER_MARKET" },
    });
    expect(owned?.research?.claims?.map((claim) => claim.kind)).toEqual(
      recordedOutputs.SYNTHESIS.claims.map((claim) => claim.kind),
    );
    expect(
      owned?.research?.agents.find((agent) => agent.agentName === "NEWS")
        ?.availability,
    ).toBe("NOT_AVAILABLE");
    expect(
      owned?.research?.agents.some(
        (agent) => agent.agentName === "POLITICAL_ACTIVITY",
      ),
    ).toBe(false);
    await expect(getOwnedResearchJob(ids.faultUser, queued.jobId)).resolves.toBeNull();

    // Reuse and the same-day limit are unchanged, and a regenerated report
    // diffs cleanly against the first one with the additive fields present.
    await expect(queueExternalJob(ids.user)).resolves.toMatchObject({
      jobId: queued.jobId,
      reused: true,
    });
    const regenerated = await queueExternalJob(ids.user, true);
    expect(regenerated.jobId).not.toBe(queued.jobId);
    await runAllScheduledAgents(
      regenerated.jobId,
      ids.user,
      regenerated.correlationId!,
      recordedProvider([
        recordedOutputs.FINANCIALS,
        recordedOutputs.COMPETITORS,
        recordedOutputs.RISK,
        recordedOutputs.SYNTHESIS,
      ]),
    );
    const second = await getOwnedResearchJob(ids.user, regenerated.jobId);
    expect(second?.comparison?.previousJobId).toBe(queued.jobId);
    expect(second?.comparison?.diff).toMatchObject({
      hasMaterialChanges: false,
      newClaims: [],
      removedClaims: [],
      changedClaims: [],
    });
    expect(second?.research?.report.evidenceCoverage?.score).toBe(
      expectedCoverage.score,
    );
  });

  it("rejects an inconsistent recorded output at runtime, repairs once, then preserves the fail-safe partial state", async () => {
    const financials = recordedOutputs.FINANCIALS;
    const numberNotInEvidence: SpecialistModelOutput = {
      ...financials,
      claims: [
        {
          ...financials.claims[0],
          statement:
            "Derived revenue growth (year over year) was 9.9 percent for the annual period ending 2025-09-27.",
        },
      ],
    };
    const bullishWithoutSupport: SpecialistModelOutput = {
      ...recordedOutputs.COMPETITORS,
      rating: "BULLISH",
    };
    const provider = recordedProvider([
      numberNotInEvidence,
      numberNotInEvidence,
      bullishWithoutSupport,
      bullishWithoutSupport,
    ]);
    const generate = vi.spyOn(provider, "generate");
    const config = getAiResearchConfig(environment);
    const queued = await queueExternalJob(ids.faultUser);

    const financialsResult = await executeResearchAgent(
      {
        researchJobId: queued.jobId,
        agentName: "FINANCIALS",
        userId: ids.faultUser,
        correlationId: queued.correlationId!,
      },
      { provider, config, environment, publisher },
    );
    const competitorsResult = await executeResearchAgent(
      {
        researchJobId: queued.jobId,
        agentName: "COMPETITORS",
        userId: ids.faultUser,
        correlationId: queued.correlationId!,
      },
      { provider, config, environment, publisher },
    );

    expect(generate).toHaveBeenCalledTimes(4);
    expect(provider.remainingFixtures).toBe(0);
    const repairFeedback = generate.mock.calls.map(
      ([request]) =>
        (JSON.parse(String(request.input)) as { repairFeedback: string | null })
          .repairFeedback,
    );
    expect(repairFeedback[0]).toBeNull();
    expect(repairFeedback[1]).toMatch(/does not appear with the same unit/);
    expect(repairFeedback[2]).toBeNull();
    expect(repairFeedback[3]).toMatch(/BULLISH rating does not agree/);
    expect(financialsResult).toMatchObject({ partial: true });
    expect(competitorsResult).toMatchObject({ partial: true });

    const runs = await db.agentRun.findMany({
      where: {
        researchJobId: queued.jobId,
        agentName: { in: [AgentName.FINANCIALS, AgentName.COMPETITORS] },
      },
    });
    expect(runs).toHaveLength(2);
    for (const run of runs) {
      expect(run).toMatchObject({
        status: AgentStatus.COMPLETED,
        availability: "NOT_AVAILABLE",
        provider: "partial-fallback",
        rating: "NEUTRAL",
        claimsJson: [],
      });
    }
    await expect(
      db.researchJob.findUniqueOrThrow({ where: { id: queued.jobId } }),
    ).resolves.toMatchObject({
      generationMode: ResearchGenerationMode.EXTERNAL,
      status: ResearchStatus.RUNNING,
    });
  });

  it("completes synthesis for a job whose specialists were persisted under an earlier schema, forwarding them as gaps and ignoring an unscheduled political run", async () => {
    const queued = await queueExternalJob(ids.legacyUser);
    const legacyClaim = {
      category: "SUPPORTIVE",
      statement: "Legacy claim without a kind.",
      confidence: 0.8,
      evidenceIds: [snapshot.evidence[0].id],
      counterEvidenceIds: [],
      assumptions: [],
    };
    // Scheduled runs completed by the M29 code path: no kind, no availability.
    await db.agentRun.updateMany({
      where: {
        researchJobId: queued.jobId,
        agentName: { in: [...EXTERNAL_SPECIALIST_AGENT_NAMES] },
      },
      data: {
        status: AgentStatus.COMPLETED,
        rating: "NEUTRAL",
        confidence: 0.7,
        summary: "Legacy specialist summary.",
        claimsJson: [legacyClaim],
        missingDataJson: [],
        provider: "recorded",
        completedAt: new Date(),
      },
    });
    // An unscheduled run left by an older job shape must neither block nor
    // feed synthesis.
    await db.agentRun.create({
      data: {
        researchJobId: queued.jobId,
        agentName: AgentName.POLITICAL_ACTIVITY,
        status: AgentStatus.COMPLETED,
        rating: "NEUTRAL",
        confidence: 0.3,
        summary: "Legacy political-activity stub.",
        findingsJson: [],
        sourcesJson: [],
        warningsJson: [],
        claimsJson: [],
        missingDataJson: ["Verified political-activity evidence is not configured."],
        completedAt: new Date(),
      },
    });

    // Legacy specialists forward no claims, so synthesis receives no filing
    // passage and the replayed output must not cite one.
    const passageIds = new Set(
      snapshot.evidence
        .filter((item) => item.sourceKind === "SEC_FILING")
        .map((item) => item.id),
    );
    const legacySynthesis = {
      ...recordedOutputs.SYNTHESIS,
      claims: recordedOutputs.SYNTHESIS.claims.filter(
        (claim) =>
          ![...claim.evidenceIds, ...claim.counterEvidenceIds].some((id) =>
            passageIds.has(id),
          ),
      ),
    };
    const provider = recordedProvider([legacySynthesis]);
    const generate = vi.spyOn(provider, "generate");
    await executeResearchSynthesis(
      { researchJobId: queued.jobId, userId: ids.legacyUser },
      { provider, config: getAiResearchConfig(environment), environment },
    );

    expect(generate).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(generate.mock.calls[0][0].input)) as {
      specialists: Array<{
        agentName: string;
        availability: string;
        claims: unknown[];
        missingData: string[];
      }>;
    };
    expect(request.specialists.map((item) => item.agentName).sort()).toEqual(
      [...EXTERNAL_SPECIALIST_AGENT_NAMES].sort(),
    );
    for (const specialist of request.specialists) {
      expect(specialist).toMatchObject({ availability: "NOT_AVAILABLE", claims: [] });
      expect(specialist.missingData.join(" ")).toMatch(/earlier output schema/);
    }
    await expect(
      db.researchJob.findUniqueOrThrow({
        where: { id: queued.jobId },
        include: { report: true },
      }),
    ).resolves.toMatchObject({
      status: ResearchStatus.COMPLETED,
      report: { provider: "recorded", reportVersion: AI_REPORT_VERSION },
    });
  });
});
