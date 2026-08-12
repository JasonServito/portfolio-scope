import { randomUUID } from "node:crypto";

import {
  AgentName,
  ResearchGenerationMode,
  ResearchStatus,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import type { JobPublisher } from "@/lib/jobs/qstash";
import {
  executeResearchAgent,
  executeResearchSynthesis,
} from "@/lib/research/background";
import {
  AiBudgetError,
  releaseAiUsage,
  reserveAiUsage,
  settleAiUsage,
  utcMonthStart,
} from "@/lib/research/ai/budget";
import {
  AI_PROMPT_VERSION,
  AI_RETRIEVAL_VERSION,
  getAiResearchConfig,
} from "@/lib/research/ai/config";
import {
  ModelProviderError,
  ModelProviderErrorCode,
  RecordedResearchModelProvider,
  type ResearchModelProvider,
} from "@/lib/research/ai/providers";
import {
  buildResearchEvidenceSnapshot,
  RESEARCH_EVIDENCE_SNAPSHOT_VERSION,
  type ResearchEvidenceSnapshot,
} from "@/lib/research/ai/retrieval";
import type {
  ResearchEvidence,
  SpecialistModelOutput,
  SynthesisModelOutput,
} from "@/lib/research/ai/schemas";
import { stableHash } from "@/lib/research/ai/schemas";
import {
  getLatestResearchForUser,
  getOwnedResearchJob,
  runResearch,
} from "@/lib/research/orchestrator";
import { SPECIALIST_AGENT_NAMES } from "@/lib/research/types";

const runId = randomUUID().replaceAll("-", "");
const prefix = `m18-${runId}`;
const ticker = `Z${runId.slice(0, 8).toUpperCase()}`;
const privateMarker = `PRIVATE-${runId}-DO-NOT-SEND`;
const ids = {
  user: `${prefix}-user`,
  otherUser: `${prefix}-other-user`,
  budgetUserA: `${prefix}-budget-user-a`,
  budgetUserB: `${prefix}-budget-user-b`,
  dedupeUser: `${prefix}-dedupe-user`,
  meteredUser: `${prefix}-metered-user`,
  stock: `${prefix}-stock`,
  portfolio: `${prefix}-portfolio`,
};
const fixtureUserIds = [
  ids.user,
  ids.otherUser,
  ids.budgetUserA,
  ids.budgetUserB,
  ids.dedupeUser,
  ids.meteredUser,
];
const baseYear = 2100 + (Number.parseInt(runId.slice(0, 4), 16) % 6_000);
const baseMonth = Number.parseInt(runId.slice(4, 6), 16) % 9;
const budgetMonths = [0, 1, 2, 3, 4, 5].map(
  (offset) => new Date(Date.UTC(baseYear, baseMonth + offset, 1)),
);
const meteredBudgetMonth = budgetMonths[3];

const environment = {
  NODE_ENV: "test",
  NEXT_PUBLIC_APP_URL: "https://portfolioscope.invalid",
  BACKGROUND_JOBS_ENABLED: "true",
  RESEARCH_GENERATION_ENABLED: "true",
  AI_RESEARCH_ENABLED: "true",
  OPENAI_API_KEY: "recorded-provider-only-no-network",
  OPENAI_RESEARCH_MODEL: "gpt-5-mini-2025-08-07",
  AI_MONTHLY_BUDGET_USD: "5",
  AI_USER_MONTHLY_BUDGET_USD: "1",
  AI_MAX_COST_PER_JOB_USD: "0.25",
  AI_MAX_TOKENS_PER_JOB: "50000",
  AI_MAX_OUTPUT_TOKENS_PER_CALL: "1500",
  AI_PROVIDER_TIMEOUT_MS: "20000",
  AI_USER_MONTHLY_REPORT_LIMIT: "5",
} as NodeJS.ProcessEnv;

const publisher: JobPublisher = {
  publishJSON: vi.fn().mockImplementation(async () => ({
    messageId: `${prefix}-${randomUUID()}`,
  })),
};

const revenueEvidence: ResearchEvidence = {
  id: "ev_1111111111111111",
  sourceKind: "SEC_FACT",
  title: "Annual revenue financial performance evidence",
  sourceReference: "sec://public-fact/revenue/FY2025",
  sourceUrl: "https://www.sec.gov/Archives/example/revenue",
  accessionNumber: "0000000000-25-000001",
  section: "Revenue FY2025",
  objectKey: "sec/public/company-facts/revenue.json",
  sha256: "1".repeat(64),
  sourceDate: "2025-12-31",
  retrievedAt: "2026-08-10T12:00:00.000Z",
  excerpt:
    "Public SEC revenue evidence reports annual financial performance of USD 125 million for FY2025.",
  passageStart: null,
  passageEnd: null,
  secFilingId: null,
  secRawSourceId: null,
  secFinancialFactId: null,
  metadata: {
    canonicalMetric: "REVENUE",
    periodKind: "ANNUAL",
    agentNames: ["FINANCIALS", "RISK", "SYNTHESIS"],
  },
};

const liabilityEvidence: ResearchEvidence = {
  id: "ev_2222222222222222",
  sourceKind: "SEC_FACT",
  title: "Liabilities and risk counterpoint evidence",
  sourceReference: "sec://public-fact/liabilities/FY2025",
  sourceUrl: "https://www.sec.gov/Archives/example/liabilities",
  accessionNumber: "0000000000-25-000001",
  section: "Liabilities FY2025",
  objectKey: "sec/public/company-facts/liabilities.json",
  sha256: "2".repeat(64),
  sourceDate: "2025-12-31",
  retrievedAt: "2026-08-10T12:00:00.000Z",
  excerpt:
    "Public SEC risk evidence reports total liabilities of USD 70 million for FY2025.",
  passageStart: null,
  passageEnd: null,
  secFilingId: null,
  secRawSourceId: null,
  secFinancialFactId: null,
  metadata: {
    canonicalMetric: "LIABILITIES",
    periodKind: "INSTANT",
    agentNames: ["FINANCIALS", "RISK", "SYNTHESIS"],
  },
};

const peerEvidence: ResearchEvidence = {
  id: "ev_3333333333333333",
  sourceKind: "PEER_SET",
  title: "Public company competitors and peer comparison",
  sourceReference: "portfolioscope://public-peers/fixture",
  sourceUrl: null,
  accessionNumber: null,
  section: "Deterministic public peer set",
  objectKey: null,
  sha256: null,
  sourceDate: null,
  retrievedAt: "2026-08-10T12:00:00.000Z",
  excerpt:
    "The public industry peer set contains ACME and EXAMPLE for competitor comparison evidence.",
  passageStart: null,
  passageEnd: null,
  secFilingId: null,
  secRawSourceId: null,
  secFinancialFactId: null,
  metadata: {
    relationship: "INDUSTRY",
    agentNames: ["COMPETITORS", "SYNTHESIS"],
  },
};

function withSnapshotIntegrity(
  input: ResearchEvidenceSnapshot,
): ResearchEvidenceSnapshot {
  const sourceDataVersion = stableHash({
    schemaVersion: input.schemaVersion,
    stock: input.stock,
    peers: input.peers,
    missingMetrics: input.missingMetrics,
    ambiguousMetrics: input.ambiguousMetrics,
    evidence: input.evidence,
  });
  const inputDataVersion = stableHash({
    sourceDataVersion,
    retrievalVersion: input.retrievalVersion,
    evidenceIds: input.evidence.map((item) => item.id),
  });
  const withoutHash = {
    schemaVersion: input.schemaVersion,
    retrievalVersion: input.retrievalVersion,
    sourceDataVersion,
    inputDataVersion,
    stock: input.stock,
    peers: input.peers,
    missingMetrics: input.missingMetrics,
    ambiguousMetrics: input.ambiguousMetrics,
    evidence: input.evidence,
  };
  return {
    ...withoutHash,
    sourceSnapshotSha256: stableHash(withoutHash),
  };
}

const snapshot: ResearchEvidenceSnapshot = withSnapshotIntegrity({
  schemaVersion: RESEARCH_EVIDENCE_SNAPSHOT_VERSION,
  retrievalVersion: AI_RETRIEVAL_VERSION,
  sourceDataVersion: "a".repeat(64),
  inputDataVersion: "b".repeat(64),
  sourceSnapshotSha256: "c".repeat(64),
  stock: {
    stockId: ids.stock,
    companyId: null,
    ticker,
    companyName: "M18 Public Evidence Fixture",
    legalName: "M18 Public Evidence Fixture Ltd.",
    slug: null,
    sector: "Technology",
    industry: "Integration Testing",
    exchange: "TEST",
    currency: "USD",
    cik: "0000000000",
    sic: "9999",
    sicDescription: "Public test fixture",
    fiscalYearEnd: "1231",
    stateOfIncorporation: "DE",
    isSupported: true,
    lastSyncedAt: "2026-08-10T12:00:00.000Z",
  },
  peers: [
    {
      stockId: `${prefix}-peer`,
      companyId: null,
      ticker: "ACME",
      companyName: "Acme Public Peer",
      legalName: "Acme Public Peer Inc.",
      slug: null,
      sector: "Technology",
      industry: "Integration Testing",
      exchange: "TEST",
      currency: "USD",
      cik: null,
      relationship: "INDUSTRY",
    },
  ],
  missingMetrics: ["NET_INCOME"],
  ambiguousMetrics: [],
  evidence: [revenueEvidence, liabilityEvidence, peerEvidence],
});

const specialistOnlyEvidence: ResearchEvidence = {
  ...revenueEvidence,
  id: "ev_4444444444444444",
  title: "Annual revenue specialist-only evidence",
  sourceReference: "sec://public-fact/revenue-specialist/FY2025",
  excerpt:
    "Annual revenue specialist evidence reports USD 130 million for FY2025.",
  metadata: {
    canonicalMetric: "REVENUE",
    periodKind: "ANNUAL",
    agentNames: ["FINANCIALS"],
  },
};

const fallbackSnapshot = withSnapshotIntegrity({
  ...snapshot,
  evidence: [...snapshot.evidence, specialistOnlyEvidence],
});

function specialistOutput(
  statement: string,
  evidenceId: string,
  category: "SUPPORTIVE" | "COUNTERPOINT" | "RISK" = "SUPPORTIVE",
): SpecialistModelOutput {
  return {
    rating: category === "RISK" ? "BEARISH" : "NEUTRAL",
    confidence: 0.78,
    summary: `${statement} The conclusion is limited to the cited public evidence.`,
    claims: [
      {
        category,
        statement,
        confidence: 0.8,
        evidenceIds: [evidenceId],
        counterEvidenceIds: [],
        assumptions: [],
      },
    ],
    warnings: [],
    missingData: [],
  };
}

const financialOutput = specialistOutput(
  "FY2025 public revenue was reported as USD 125 million.",
  revenueEvidence.id,
);
const competitorOutput = specialistOutput(
  "The configured public industry peer set contains two named peers.",
  peerEvidence.id,
  "COUNTERPOINT",
);
const riskOutput = specialistOutput(
  "FY2025 public liabilities were reported as USD 70 million.",
  liabilityEvidence.id,
  "RISK",
);
const synthesisOutput: SynthesisModelOutput = {
  rating: "MIXED",
  confidence: 0.76,
  summary:
    "The bounded public evidence supports a mixed research view with explicit financial, peer, and liability context.",
  claims: [
    {
      ...financialOutput.claims[0],
      counterEvidenceIds: [liabilityEvidence.id],
    },
    competitorOutput.claims[0],
    riskOutput.claims[0],
  ],
  warnings: [
    "Current licensed news and political-activity sources are absent.",
  ],
  missingData: ["Current licensed news", "Verified political activity"],
  disagreements: [
    "Revenue context and liability context point in different directions.",
  ],
};

function recordedProvider() {
  return new RecordedResearchModelProvider({
    model: "recorded-m18-integration-v1",
    fixtures: [
      financialOutput,
      competitorOutput,
      riskOutput,
      synthesisOutput,
    ].map((output, index) => ({
      result: {
        output,
        providerRequestId: `${prefix}-recording-${index + 1}`,
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    })),
  });
}

function zeroNetworkMeteredProvider(
  outputs: Array<SpecialistModelOutput | SynthesisModelOutput>,
) {
  let index = 0;
  const generate = vi.fn<ResearchModelProvider["generate"]>(async () => {
    const output = outputs[index];
    index += 1;
    if (!output) {
      throw new Error("The zero-network metered fixture was exhausted.");
    }
    return {
      output,
      provider: "openai",
      model: "gpt-5-mini-2025-08-07",
      providerRequestId: `${prefix}-metered-${index}`,
      responseId: `${prefix}-response-${index}`,
      usage: {
        inputTokens: 100,
        cachedInputTokens: 0,
        outputTokens: 50,
        reasoningTokens: 0,
        totalTokens: 150,
      },
    };
  });
  return {
    provider: "openai",
    model: "gpt-5-mini-2025-08-07",
    generate,
  } satisfies ResearchModelProvider;
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
        { researchJob: { userId: { in: fixtureUserIds } } },
      ],
    },
  });
  await db.aiBudgetPeriod.deleteMany({
    where: {
      OR: [
        { userId: { in: fixtureUserIds } },
        { periodStart: { in: budgetMonths } },
      ],
    },
  });
  await db.researchJob.deleteMany({
    where: { userId: { in: fixtureUserIds } },
  });
  await db.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
  await db.stock.deleteMany({ where: { id: ids.stock } });
}

beforeAll(async () => {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  ) {
    throw new Error("M18 integration tests must not run against production.");
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
  await db.portfolio.create({
    data: {
      id: ids.portfolio,
      userId: ids.user,
      name: privateMarker,
      holdings: {
        create: {
          stockId: ids.stock,
          shares: 123.456,
          averageCost: 987.6543,
          costBasis: 121_932.62,
        },
      },
    },
  });
  await db.watchlistItem.create({
    data: {
      userId: ids.user,
      stockId: ids.stock,
      targetPrice: 432.1,
      notes: `${privateMarker}-WATCHLIST`,
    },
  });
  await db.alert.create({
    data: {
      userId: ids.user,
      stockId: ids.stock,
      portfolioId: ids.portfolio,
      type: "CONCENTRATION",
      severity: "HIGH",
      title: `${privateMarker}-ALERT`,
      message: `${privateMarker}-MESSAGE`,
    },
  });
});

afterAll(cleanup);

describe("M18 recorded evidence-grounded research", () => {
  it("persists an external specialist-to-synthesis run with immutable public citations and no private prompt data", async () => {
    const provider = recordedProvider();
    const generate = vi.spyOn(provider, "generate");
    const config = getAiResearchConfig(environment);
    const queued = await runResearch(ids.user, ticker, {
      publisher,
      environment,
      prepareSnapshot: async () => snapshot,
    });
    if (!queued || !("jobId" in queued)) {
      throw new Error("The external research job was not queued.");
    }

    expect(queued).toMatchObject({
      generationMode: ResearchGenerationMode.EXTERNAL,
      reused: false,
      status: ResearchStatus.PENDING,
    });
    const stableCreatedAt = new Date(Date.now() - 86_400_000);
    stableCreatedAt.setUTCHours(23, 59, 0, 0);
    await db.researchJob.update({
      where: { id: queued.jobId },
      data: { createdAt: stableCreatedAt },
    });
    const stableAsOfDate = stableCreatedAt.toISOString().slice(0, 10);
    await expect(buildResearchEvidenceSnapshot(queued.jobId)).resolves.toEqual(
      snapshot,
    );

    for (const agentName of SPECIALIST_AGENT_NAMES) {
      await executeResearchAgent(
        {
          researchJobId: queued.jobId,
          agentName,
          userId: ids.user,
          correlationId: queued.correlationId!,
        },
        {
          provider,
          config,
          environment,
          publisher,
        },
      );
    }
    await executeResearchSynthesis(
      { researchJobId: queued.jobId, userId: ids.user },
      {
        provider,
        config,
        environment,
      },
    );

    expect(generate).toHaveBeenCalledTimes(4);
    expect(provider.remainingFixtures).toBe(0);
    const serializedRequests = JSON.stringify(generate.mock.calls);
    expect(serializedRequests).toContain(revenueEvidence.id);
    expect(serializedRequests).toContain(peerEvidence.id);
    expect(serializedRequests).not.toContain(privateMarker);
    expect(serializedRequests).not.toContain("123.456");
    expect(serializedRequests).not.toContain("987.6543");
    expect(serializedRequests).not.toContain("432.1");
    expect(
      generate.mock.calls.map(
        ([request]) =>
          (JSON.parse(String(request.input)) as { asOfDate: string }).asOfDate,
      ),
    ).toEqual(Array.from({ length: 4 }, () => stableAsOfDate));

    const stored = await db.researchJob.findUniqueOrThrow({
      where: { id: queued.jobId },
      include: {
        agentRuns: { orderBy: { agentName: "asc" } },
        report: {
          include: {
            claims: {
              orderBy: { ordinal: "asc" },
              include: { evidence: { orderBy: { ordinal: "asc" } } },
            },
          },
        },
      },
    });
    expect(stored).toMatchObject({
      status: ResearchStatus.COMPLETED,
      generationMode: ResearchGenerationMode.EXTERNAL,
      sourceDataVersion: snapshot.sourceDataVersion,
      inputDataVersion: snapshot.inputDataVersion,
      retrievalVersion: snapshot.retrievalVersion,
      sourceSnapshotSha256: snapshot.sourceSnapshotSha256,
    });
    expect(stored.sourceSnapshotJson).toEqual(snapshot);
    expect(stored.report).toMatchObject({
      provider: "recorded",
      model: "recorded-m18-integration-v1",
      sourceSnapshotSha256: snapshot.sourceSnapshotSha256,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: expect.objectContaining({}),
    });
    expect(stored.report?.estimatedCostUsd?.toNumber()).toBe(0);
    expect(stored.report?.claims).toHaveLength(3);
    expect(
      stored.report?.claims.every(
        (claim) =>
          claim.asOfDate.toISOString().slice(0, 10) === stableAsOfDate,
      ),
    ).toBe(true);

    const revenueClaim = stored.report?.claims.find(
      (claim) => claim.statement === financialOutput.claims[0].statement,
    );
    expect(revenueClaim?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          referenceKey: revenueEvidence.id,
          role: "SUPPORTING",
          sourceReference: revenueEvidence.sourceReference,
          excerpt: revenueEvidence.excerpt,
          sha256: revenueEvidence.sha256,
        }),
        expect.objectContaining({
          referenceKey: liabilityEvidence.id,
          role: "COUNTER",
          sourceReference: liabilityEvidence.sourceReference,
          excerpt: liabilityEvidence.excerpt,
          sha256: liabilityEvidence.sha256,
        }),
      ]),
    );
    expect(
      stored.agentRuns.filter((run) => run.provider === "recorded"),
    ).toHaveLength(4);
    expect(
      stored.agentRuns.filter((run) => run.provider === "bounded-missing-data"),
    ).toHaveLength(2);

    await expect(
      getOwnedResearchJob(ids.otherUser, queued.jobId),
    ).resolves.toBeNull();
    await expect(
      getLatestResearchForUser(ids.otherUser, ticker),
    ).resolves.toBeNull();

    const reused = await runResearch(ids.user, ticker, {
      publisher,
      environment,
      prepareSnapshot: async () => snapshot,
    });
    expect(reused).toMatchObject({ jobId: queued.jobId, reused: true });

    const regenerated = await runResearch(ids.user, ticker, {
      publisher,
      environment,
      regenerate: true,
      prepareSnapshot: async () => snapshot,
    });
    expect(regenerated).toMatchObject({ reused: false });
    if (!regenerated || !("jobId" in regenerated)) {
      throw new Error("Explicit regeneration was not queued.");
    }
    expect(regenerated.jobId).not.toBe(queued.jobId);
    await expect(
      db.researchJob.findUnique({ where: { id: regenerated.jobId } }),
    ).resolves.toMatchObject({
      requestedRegeneration: true,
      generationMode: ResearchGenerationMode.EXTERNAL,
      sourceSnapshotSha256: snapshot.sourceSnapshotSha256,
    });
  });

  it("preserves specialist citations when synthesis falls back outside its retrieved subset", async () => {
    const fallbackFinancialOutput = specialistOutput(
      "FY2025 specialist-only revenue was reported as USD 130 million.",
      specialistOnlyEvidence.id,
    );
    const provider = new RecordedResearchModelProvider({
      model: "recorded-m18-partial-v1",
      fixtures: [
        ...[fallbackFinancialOutput, competitorOutput, riskOutput].map(
          (output, index) => ({
            result: {
              output,
              providerRequestId: `${prefix}-partial-recording-${index + 1}`,
              usage: { inputTokens: 100, outputTokens: 50 },
            },
          }),
        ),
        {
          error: new ModelProviderError(
            ModelProviderErrorCode.REQUEST_REJECTED,
            { provider: "recorded" },
          ),
        },
      ],
    });
    const config = getAiResearchConfig(environment);
    const queued = await runResearch(ids.otherUser, ticker, {
      publisher,
      environment,
      prepareSnapshot: async () => fallbackSnapshot,
    });
    if (!queued || !("jobId" in queued)) {
      throw new Error("The partial external research job was not queued.");
    }

    for (const agentName of SPECIALIST_AGENT_NAMES) {
      await executeResearchAgent(
        {
          researchJobId: queued.jobId,
          agentName,
          userId: ids.otherUser,
          correlationId: queued.correlationId!,
        },
        { provider, config, environment, publisher },
      );
    }
    await expect(
      executeResearchSynthesis(
        { researchJobId: queued.jobId, userId: ids.otherUser },
        { provider, config, environment },
      ),
    ).resolves.toMatchObject({ partial: true });

    const report = await db.researchReport.findUniqueOrThrow({
      where: { researchJobId: queued.jobId },
      include: {
        claims: { include: { evidence: true } },
      },
    });
    const retained = report.claims.find(
      (claim) =>
        claim.statement === fallbackFinancialOutput.claims[0].statement,
    );
    expect(report.provider).toBe("partial-fallback");
    expect(retained?.evidence).toEqual([
      expect.objectContaining({
        referenceKey: specialistOnlyEvidence.id,
        role: "SUPPORTING",
      }),
    ]);
    expect(report.claims.every((claim) => claim.evidence.length > 0)).toBe(
      true,
    );
    await expect(
      getOwnedResearchJob(ids.otherUser, queued.jobId),
    ).resolves.toMatchObject({
      research: {
        evidenceRegistry: expect.arrayContaining([
          expect.objectContaining({
            id: specialistOnlyEvidence.id,
            title: specialistOnlyEvidence.title,
          }),
        ]),
      },
    });
  });

  it("atomically settles zero-network metered usage into job, user, global, and report totals", async () => {
    const provider = zeroNetworkMeteredProvider([
      financialOutput,
      competitorOutput,
      riskOutput,
      synthesisOutput,
    ]);
    const config = getAiResearchConfig(environment);
    const queued = await runResearch(ids.meteredUser, ticker, {
      publisher,
      environment,
      now: () => meteredBudgetMonth,
      prepareSnapshot: async () => snapshot,
    });
    if (!queued || !("jobId" in queued)) {
      throw new Error("The metered external research job was not queued.");
    }

    for (const agentName of SPECIALIST_AGENT_NAMES) {
      await executeResearchAgent(
        {
          researchJobId: queued.jobId,
          agentName,
          userId: ids.meteredUser,
          correlationId: queued.correlationId!,
        },
        {
          provider,
          config,
          environment,
          publisher,
          now: () => meteredBudgetMonth,
        },
      );
    }
    await executeResearchSynthesis(
      { researchJobId: queued.jobId, userId: ids.meteredUser },
      { provider, config, environment, now: () => meteredBudgetMonth },
    );

    expect(provider.generate).toHaveBeenCalledTimes(4);
    const periodStart = utcMonthStart(meteredBudgetMonth);
    const [job, usages, report, userBudget, globalBudget] = await Promise.all([
      db.researchJob.findUniqueOrThrow({ where: { id: queued.jobId } }),
      db.aiUsage.findMany({
        where: { researchJobId: queued.jobId },
        orderBy: { createdAt: "asc" },
      }),
      db.researchReport.findUniqueOrThrow({
        where: { researchJobId: queued.jobId },
      }),
      db.aiBudgetPeriod.findUniqueOrThrow({
        where: {
          scopeKey_periodStart: {
            scopeKey: ids.meteredUser,
            periodStart,
          },
        },
      }),
      db.aiBudgetPeriod.findUniqueOrThrow({
        where: {
          scopeKey_periodStart: {
            scopeKey: "GLOBAL",
            periodStart,
          },
        },
      }),
    ]);
    expect(usages).toHaveLength(4);
    expect(usages.every((usage) => usage.status === "SETTLED")).toBe(true);
    expect(job.aiReservedTokens).toBe(0);
    expect(job.aiReservedCostUsd.toNumber()).toBe(0);
    expect(job.aiUsedTokens).toBe(600);
    expect(job.aiUsedCostUsd.toNumber()).toBe(0.0005);
    expect(report.inputTokens).toBe(400);
    expect(report.outputTokens).toBe(200);
    expect(report.estimatedCostUsd?.toNumber()).toBe(0.0005);
    expect(userBudget.reservedUsd.toNumber()).toBe(0);
    expect(userBudget.usedUsd.toNumber()).toBe(0.0005);
    expect(globalBudget.reservedUsd.toNumber()).toBe(0);
    expect(globalBudget.usedUsd.toNumber()).toBeGreaterThanOrEqual(0.0005);
  });

  it("deduplicates concurrent active requests before specialist fan-out", async () => {
    const [first, second] = await Promise.all([
      runResearch(ids.dedupeUser, ticker, {
        publisher,
        environment,
        prepareSnapshot: async () => snapshot,
      }),
      runResearch(ids.dedupeUser, ticker, {
        publisher,
        environment,
        prepareSnapshot: async () => snapshot,
      }),
    ]);
    if (!first || !("jobId" in first) || !second || !("jobId" in second)) {
      throw new Error("Concurrent external research did not return job ids.");
    }

    expect(first.jobId).toBe(second.jobId);
    await expect(
      db.researchJob.count({
        where: {
          userId: ids.dedupeUser,
          stockId: ids.stock,
          status: {
            in: [
              ResearchStatus.PENDING,
              ResearchStatus.RUNNING,
              ResearchStatus.PARTIALLY_COMPLETED,
            ],
          },
        },
      }),
    ).resolves.toBe(1);
    await expect(
      db.backgroundJob.count({
        where: {
          researchJobId: first.jobId,
          type: "RESEARCH_AGENT_RUN",
        },
      }),
    ).resolves.toBe(SPECIALIST_AGENT_NAMES.length);
  });
});

function budgetConfig(input: { global: number; user: number; job: number }) {
  return getAiResearchConfig({
    ...environment,
    AI_MONTHLY_BUDGET_USD: String(input.global),
    AI_USER_MONTHLY_BUDGET_USD: String(input.user),
    AI_MAX_COST_PER_JOB_USD: String(input.job),
    AI_MAX_TOKENS_PER_JOB: "100",
    AI_MAX_OUTPUT_TOKENS_PER_CALL: "1",
  });
}

async function createBudgetJob(
  userId: string,
  label: string,
  limits: { cost: number; tokens?: number },
) {
  return db.researchJob.create({
    data: {
      userId,
      stockId: ids.stock,
      // Budget accounting is independent of workflow state. COMPLETE avoids
      // the production partial-unique guard for concurrent active stock jobs,
      // letting this fixture isolate the budget lock under test.
      status: ResearchStatus.COMPLETED,
      generationMode: ResearchGenerationMode.EXTERNAL,
      requestedAgents: [AgentName.FINANCIALS],
      aiCostLimitUsd: limits.cost,
      aiTokenLimit: limits.tokens ?? 100,
      correlationId: `${prefix}-${label}`,
    },
  });
}

function reserve(
  userId: string,
  researchJobId: string,
  label: string,
  now: Date,
  config: ReturnType<typeof getAiResearchConfig>,
) {
  return reserveAiUsage({
    idempotencyKey: `${prefix}:${label}`,
    userId,
    researchJobId,
    operation: "INTEGRATION_BUDGET",
    promptVersion: AI_PROMPT_VERSION,
    attemptNumber: 1,
    reservedInputTokens: 1,
    reservedOutputTokens: 1,
    config,
    now,
  });
}

function assertOneReservation(
  results: PromiseSettledResult<Awaited<ReturnType<typeof reserve>>>[],
  expectedCode: AiBudgetError["code"],
) {
  const fulfilled = results.filter(
    (
      result,
    ): result is PromiseFulfilledResult<Awaited<ReturnType<typeof reserve>>> =>
      result.status === "fulfilled",
  );
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(rejected[0].reason).toBeInstanceOf(AiBudgetError);
  expect((rejected[0].reason as AiBudgetError).code).toBe(expectedCode);
  return fulfilled[0].value;
}

describe("M18 atomic AI budget enforcement", () => {
  it("allows only one concurrent reservation within a per-job cost cap", async () => {
    const now = budgetMonths[0];
    const config = budgetConfig({ global: 0.01, user: 0.01, job: 0.000003 });
    const job = await createBudgetJob(ids.budgetUserA, "job-cap", {
      cost: 0.000003,
    });
    const results = await Promise.allSettled([
      reserve(ids.budgetUserA, job.id, "job-cap-a", now, config),
      reserve(ids.budgetUserA, job.id, "job-cap-b", now, config),
    ]);

    const accepted = assertOneReservation(results, "AI_JOB_BUDGET_EXHAUSTED");
    expect(accepted.reservedCostUsd).toBe(0.000003);
    await expect(
      db.researchJob.findUnique({ where: { id: job.id } }),
    ).resolves.toMatchObject({ aiReservedTokens: 2 });
    const stored = await db.researchJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(stored.aiReservedCostUsd.toNumber()).toBe(0.000003);
  });

  it("allows only one concurrent reservation across a user's jobs", async () => {
    const now = budgetMonths[1];
    const config = budgetConfig({
      global: 0.01,
      user: 0.000003,
      job: 0.000003,
    });
    const [jobA, jobB] = await Promise.all([
      createBudgetJob(ids.budgetUserA, "user-cap-a", { cost: 0.000003 }),
      createBudgetJob(ids.budgetUserA, "user-cap-b", { cost: 0.000003 }),
    ]);
    const results = await Promise.allSettled([
      reserve(ids.budgetUserA, jobA.id, "user-cap-a", now, config),
      reserve(ids.budgetUserA, jobB.id, "user-cap-b", now, config),
    ]);

    assertOneReservation(results, "AI_USER_BUDGET_EXHAUSTED");
    const period = await db.aiBudgetPeriod.findUniqueOrThrow({
      where: {
        scopeKey_periodStart: { scopeKey: ids.budgetUserA, periodStart: now },
      },
    });
    expect(period.reservedUsd.toNumber()).toBe(0.000003);
    expect(period.usedUsd.toNumber()).toBe(0);
  });

  it("allows only one concurrent reservation across users at the global cap", async () => {
    const now = budgetMonths[2];
    const config = budgetConfig({
      global: 0.000003,
      user: 0.000003,
      job: 0.000003,
    });
    const [jobA, jobB] = await Promise.all([
      createBudgetJob(ids.budgetUserA, "global-cap-a", { cost: 0.000003 }),
      createBudgetJob(ids.budgetUserB, "global-cap-b", { cost: 0.000003 }),
    ]);
    const results = await Promise.allSettled([
      reserve(ids.budgetUserA, jobA.id, "global-cap-a", now, config),
      reserve(ids.budgetUserB, jobB.id, "global-cap-b", now, config),
    ]);

    assertOneReservation(results, "AI_GLOBAL_BUDGET_EXHAUSTED");
    const period = await db.aiBudgetPeriod.findUniqueOrThrow({
      where: {
        scopeKey_periodStart: { scopeKey: "GLOBAL", periodStart: now },
      },
    });
    expect(period.reservedUsd.toNumber()).toBe(0.000003);
    expect(period.usedUsd.toNumber()).toBe(0);
  });

  it("commits reconciliation state on overage and releases known uncharged attempts", async () => {
    const config = budgetConfig({
      global: 0.01,
      user: 0.01,
      job: 0.01,
    });
    const [overageJob, releaseJob] = await Promise.all([
      createBudgetJob(ids.budgetUserA, "overage", { cost: 0.01 }),
      createBudgetJob(ids.budgetUserB, "release", { cost: 0.01 }),
    ]);
    const overage = await reserve(
      ids.budgetUserA,
      overageJob.id,
      "overage",
      budgetMonths[4],
      config,
    );
    await expect(
      settleAiUsage(overage.usageId, {
        inputTokens: 2,
        cachedInputTokens: 0,
        outputTokens: 1,
        providerRequestId: `${prefix}-overage`,
      }),
    ).rejects.toMatchObject({ code: "AI_USAGE_RECONCILIATION_REQUIRED" });
    const unconfirmed = await db.aiUsage.findUniqueOrThrow({
      where: { id: overage.usageId },
    });
    expect(unconfirmed).toMatchObject({
      status: "UNCONFIRMED",
      errorCode: "AI_USAGE_EXCEEDED_RESERVATION",
      inputTokens: 2,
      cachedInputTokens: 0,
      outputTokens: 1,
      providerRequestId: `${prefix}-overage`,
    });
    expect(unconfirmed.estimatedCostUsd?.toNumber()).toBe(0.000003);

    const released = await reserve(
      ids.budgetUserB,
      releaseJob.id,
      "release",
      budgetMonths[5],
      config,
    );
    await releaseAiUsage(released.usageId, "AI_MODEL_PROVIDER_CONFIGURATION");
    await expect(
      db.aiUsage.findUniqueOrThrow({ where: { id: released.usageId } }),
    ).resolves.toMatchObject({
      status: "RELEASED",
      errorCode: "AI_MODEL_PROVIDER_CONFIGURATION",
    });
    await expect(
      db.researchJob.findUniqueOrThrow({ where: { id: releaseJob.id } }),
    ).resolves.toMatchObject({
      aiReservedTokens: 0,
    });
  });
});
