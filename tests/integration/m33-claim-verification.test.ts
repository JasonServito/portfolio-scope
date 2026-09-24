import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { db } from "@/lib/db";
import { executeBackgroundJob } from "@/lib/jobs/service";
import type {
  PrismaBackgroundJobRepository,
  ClaimedBackgroundJob,
} from "@/lib/jobs/repository";
import { calculateAiCostUsd, reserveAiUsage } from "@/lib/research/ai/budget";
import {
  AI_PROMPT_VERSION,
  AI_REPORT_VERSION,
  createQueuedAiGenerationConfig,
  getAiResearchConfig,
} from "@/lib/research/ai/config";
import {
  AAPL_GROUNDED_SYNTHESIS,
  AAPL_RECORDED_SPECIALIST_OUTPUTS,
  CURATED_AAPL_SNAPSHOT,
} from "@/lib/research/ai/fixtures/curated-evaluation";
import {
  ModelProviderError,
  ModelProviderErrorCode,
  RecordedResearchModelProvider,
  type ResearchModelProvider,
} from "@/lib/research/ai/providers";
import { claimKey } from "@/lib/research/ai/schemas";
import type { ClaimVerification } from "@/lib/research/ai/verification";
import { executeResearchSynthesis } from "@/lib/research/background";
import { getOwnedResearchJob } from "@/lib/research/orchestrator";
import { EXTERNAL_SPECIALIST_AGENT_NAMES } from "@/lib/research/types";

const prefix = `m33-${randomUUID()}`;
const userId = `${prefix}-user`;
const stockId = `${prefix}-stock`;
const budgetDate = new Date(
  Date.UTC(2500 + Math.floor(Math.random() * 4000), 0, 1),
);
const baseEnvironment = {
  NODE_ENV: "test",
  OPENAI_API_KEY: "recorded-only",
  AI_RESEARCH_ENABLED: "true",
} as NodeJS.ProcessEnv;
const config = getAiResearchConfig(baseEnvironment);
const snapshot = {
  ...CURATED_AAPL_SNAPSHOT,
  stock: { ...CURATED_AAPL_SNAPSHOT.stock, stockId },
  evidence: CURATED_AAPL_SNAPSHOT.evidence.map((item) => ({
    ...item,
    secFilingId: null,
    secRawSourceId: null,
    secFinancialFactId: null,
  })),
};
const output = AAPL_GROUNDED_SYNTHESIS;
const supported: ClaimVerification = {
  results: output.claims.map((claim) => ({
    claimKey: claimKey(claim),
    status: "SUPPORTED",
    contradictingEvidenceIds: [],
  })),
};

async function createJob(aiUsedTokens = 0) {
  return db.researchJob.create({
    data: {
      userId,
      stockId,
      status: "RUNNING",
      generationMode: "EXTERNAL",
      requestedAgents: [...EXTERNAL_SPECIALIST_AGENT_NAMES],
      generationConfigJson: createQueuedAiGenerationConfig(config),
      sourceSnapshotSha256: snapshot.sourceSnapshotSha256,
      sourceSnapshotJson: JSON.parse(JSON.stringify(snapshot)),
      retrievalVersion: snapshot.retrievalVersion,
      inputDataVersion: snapshot.inputDataVersion,
      aiTokenLimit: config.maxTokensPerJob,
      aiCostLimitUsd: config.maxCostPerJobUsd,
      aiUsedTokens,
      agentRuns: {
        create: EXTERNAL_SPECIALIST_AGENT_NAMES.map((agentName) => {
          const specialist = AAPL_RECORDED_SPECIALIST_OUTPUTS[agentName];
          return {
            agentName,
            status: "COMPLETED",
            rating: specialist.rating,
            confidence: specialist.confidence,
            availability: specialist.availability,
            summary: specialist.summary,
            findingsJson: [],
            sourcesJson: [],
            warningsJson: specialist.warnings,
            claimsJson: specialist.claims,
            missingDataJson: specialist.missingData,
          };
        }),
      },
    },
  });
}

beforeAll(async () => {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  )
    throw new Error("M33 integration tests must not use production.");
  await db.user.create({
    data: { id: userId, email: `${prefix}@example.test` },
  });
  await db.stock.create({
    data: {
      id: stockId,
      ticker: prefix.slice(-12).toUpperCase(),
      companyName: "M33 public fixture",
      sector: "Technology",
      industry: "Fixture",
      exchange: "TEST",
    },
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Delete only this test run's synthetic ledger; UNCONFIRMED usage cannot
  // be reconciled by the application settlement API.
  await db.aiUsage.deleteMany({ where: { userId } });
  await db.aiBudgetPeriod.deleteMany({
    where: { OR: [{ userId }, { periodStart: budgetDate }] },
  });
  await db.researchJob.deleteMany({ where: { userId } });
});

afterAll(async () => {
  await db.aiUsage.deleteMany({ where: { userId } });
  await db.aiBudgetPeriod.deleteMany({
    where: { OR: [{ userId }, { periodStart: budgetDate }] },
  });
  await db.user.deleteMany({ where: { id: userId } });
  await db.stock.deleteMany({ where: { id: stockId } });
});

describe("M33 persisted report and verifier accounting", () => {
  it("treats a supported claim becoming contradicted as a removed finding in report comparisons", async () => {
    const prior = await createJob();
    const deps = (verdicts: ClaimVerification) => ({
      provider: new RecordedResearchModelProvider({
        fixtures: [{ result: { output } }, { result: { output: verdicts } }],
      }),
      config,
      environment: baseEnvironment,
      buildSnapshot: async () => snapshot,
    });
    await executeResearchSynthesis(
      { researchJobId: prior.id, userId },
      deps(supported),
    );
    const current = await createJob();
    const verdicts = structuredClone(supported);
    verdicts.results[3] = {
      ...verdicts.results[3],
      status: "CONTRADICTED",
      contradictingEvidenceIds: output.claims[3].evidenceIds,
    };
    await executeResearchSynthesis(
      { researchJobId: current.id, userId },
      deps(verdicts),
    );
    const shaped = await getOwnedResearchJob(userId, current.id);
    expect(shaped?.comparison?.diff.removedClaims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claim: expect.objectContaining({
            statement: output.claims[3].statement,
          }),
        }),
      ]),
    );
  });

  it("bounds verification after a slow synthesis repair within the worker deadline and completes unverified", async () => {
    const researchJob = await createJob();
    let clockTime = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => clockTime);
    const verifierAbort = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(verifierAbort.signal);
    const recorded = new RecordedResearchModelProvider({
      fixtures: [{ result: { output: {} } }, { result: { output } }],
    });
    const generate = vi.fn(async (request) => {
      if (request.outputSchemaName === "research_synthesis_v1") {
        clockTime += 24_000;
        return recorded.generate(request);
      }
      expect(timeout).toHaveBeenCalledWith(7_000);
      clockTime += 7_000;
      verifierAbort.abort();
      expect(request.signal?.aborted).toBe(true);
      throw new ModelProviderError(ModelProviderErrorCode.TIMEOUT, {
        provider: "recorded",
      });
    });
    const worker = {
      id: `${prefix}-worker`,
      type: "RESEARCH_SYNTHESIS",
      status: "RUNNING",
      attemptCount: 1,
      maxAttempts: 3,
      timeoutMs: 60_000,
      userId,
      researchJobId: researchJob.id,
      correlationId: prefix,
    } as ClaimedBackgroundJob;
    const complete = vi.fn();
    const fail = vi.fn();
    const repository = {
      claim: vi.fn().mockResolvedValue(worker),
      complete,
      fail,
    } as unknown as PrismaBackgroundJobRepository;
    const result = await executeBackgroundJob(worker.id, {
      repository,
      handler: (_job, signal, deadlineAt) =>
        executeResearchSynthesis(
          { researchJobId: researchJob.id, userId, signal, deadlineAt },
          {
            provider: { provider: "recorded", model: config.model, generate },
            config,
            environment: baseEnvironment,
            buildSnapshot: async () => snapshot,
          },
        ),
    });
    expect(result.status).toBe("COMPLETED");
    expect(fail).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledTimes(3);
    expect(
      (
        await db.researchReport.findUniqueOrThrow({
          where: { researchJobId: researchJob.id },
        })
      ).verificationCompleted,
    ).toBe(false);
  });

  it("filters every outcome, preserves a contradiction's original claim and excerpts, settles both calls, and reuses the completed report", async () => {
    const job = await createJob();
    const verdicts = structuredClone(supported);
    verdicts.results[1].status = "PARTIALLY_SUPPORTED";
    verdicts.results[3] = {
      ...verdicts.results[3],
      status: "CONTRADICTED",
      contradictingEvidenceIds: output.claims[3].evidenceIds,
    };
    verdicts.results[7].status = "UNSUPPORTED"; // Must not reappear via News.
    const recorded = new RecordedResearchModelProvider({
      fixtures: [
        {
          result: {
            output,
            providerRequestId: `${job.id}-synthesis`,
            usage: { inputTokens: 500, outputTokens: 200 },
          },
        },
        {
          result: {
            output: verdicts,
            providerRequestId: `${job.id}-verifier`,
            usage: {
              inputTokens: 300,
              cachedInputTokens: 100,
              outputTokens: 80,
              reasoningTokens: 20,
              totalTokens: 380,
            },
          },
        },
      ],
    });
    const generate = vi.fn(async (request) => {
      if (request.outputSchemaName === "research_claim_verification_v1") {
        const checkpoint = await db.researchJob.findUniqueOrThrow({
          where: { id: job.id },
          include: { report: true },
        });
        expect(checkpoint.status).toBe("RUNNING");
        expect(checkpoint.report?.verificationCompleted).toBe(false);
        expect(checkpoint.aiUsedTokens).toBe(700);
        expect(
          (await getOwnedResearchJob(userId, job.id))?.research,
        ).toBeNull();
      }
      return recorded.generate(request);
    });
    const dependencies = {
      provider: {
        provider: "openai",
        model: config.model,
        generate,
      } satisfies ResearchModelProvider,
      config,
      environment: { ...baseEnvironment },
      now: () => budgetDate,
      buildSnapshot: async () => snapshot,
    };
    await executeResearchSynthesis(
      { researchJobId: job.id, userId },
      dependencies,
    );
    const stored = await db.researchJob.findUniqueOrThrow({
      where: { id: job.id },
      include: {
        report: {
          include: {
            claims: {
              include: { evidence: true },
              orderBy: { ordinal: "asc" },
            },
          },
        },
        aiUsage: true,
      },
    });
    expect(stored.status).toBe("COMPLETED");
    expect(stored.report?.verificationCompleted).toBe(true);
    expect(stored.report?.reportVersion).toBe(AI_REPORT_VERSION);
    expect(
      stored.report?.claims.map((claim) => claim.verificationStatus),
    ).toEqual([
      "SUPPORTED",
      "PARTIALLY_SUPPORTED",
      "SUPPORTED",
      "CONTRADICTED",
      "SUPPORTED",
      "SUPPORTED",
      "SUPPORTED",
    ]);
    expect(
      stored.report?.claims.some(
        (claim) => claim.statement === output.claims[7].statement,
      ),
    ).toBe(false);
    const contradicted = stored.report!.claims[3];
    expect(contradicted.statement).toBe(output.claims[3].statement);
    expect(contradicted.verificationEvidenceIdsJson).toEqual(
      output.claims[3].evidenceIds,
    );
    expect(contradicted.evidence[0].excerpt).toBe(
      snapshot.evidence.find(
        (item) => item.id === output.claims[3].evidenceIds[0],
      )!.excerpt,
    );
    expect(stored.aiUsage).toHaveLength(2);
    expect(stored.aiUsage.every((usage) => usage.status === "SETTLED")).toBe(
      true,
    );
    expect(stored.aiUsedTokens).toBe(1080);
    expect(stored.aiReservedTokens).toBe(0);
    const verifierUsage = stored.aiUsage.find(
      (usage) => usage.operation === "CLAIM_VERIFICATION",
    )!;
    expect(verifierUsage).toMatchObject({
      inputTokens: 300,
      cachedInputTokens: 100,
      outputTokens: 80,
      reasoningTokens: 20,
      providerTotalTokens: 380,
      providerRequestId: `${job.id}-verifier`,
    });
    expect(verifierUsage.estimatedCostUsd?.toNumber()).toBe(
      calculateAiCostUsd(
        { inputTokens: 300, cachedInputTokens: 100, outputTokens: 80 },
        config.pricing,
      ),
    );
    expect(stored.report?.estimatedCostUsd?.toNumber()).toBe(
      stored.aiUsedCostUsd.toNumber(),
    );
    expect(stored.aiUsedCostUsd.toNumber()).toBeLessThan(
      config.maxCostPerJobUsd,
    );
    const shaped = await getOwnedResearchJob(userId, job.id);
    expect(shaped?.research?.claims).toHaveLength(6);
    expect(shaped?.research?.report.contradictedClaims?.[0].statement).toBe(
      output.claims[3].statement,
    );
    expect(shaped?.research?.report.recentEvents).toEqual([]);
    expect(
      await getOwnedResearchJob(`${prefix}-other-owner`, job.id),
    ).toBeNull();
    await expect(
      executeResearchSynthesis({ researchJobId: job.id, userId }, dependencies),
    ).resolves.toMatchObject({ reused: true });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it.each([
    "timeout",
    "malformed",
    "kill switch",
    "job cap",
    "inconsistent usage",
  ])(
    "completes unverified and preserves the validated draft after %s",
    async (failure) => {
      // Synthesis reserves about 10,500 tokens and verification about 7,000
      // here: 37,000 prior tokens let synthesis fit and push verification
      // over the 50,000-token cap once synthesis settles.
      const job = await createJob(failure === "job cap" ? 37_000 : 0);
      const environment = { ...baseEnvironment };
      const recorded = new RecordedResearchModelProvider({
        fixtures: [
          {
            result: {
              output,
              usage: {
                inputTokens: failure === "job cap" ? 7_000 : 500,
                outputTokens: 200,
              },
            },
          },
          failure === "timeout"
            ? {
                error: new ModelProviderError(ModelProviderErrorCode.TIMEOUT, {
                  provider: "openai",
                  chargeUncertain: true,
                  providerRequestId: `${job.id}-timeout`,
                }),
              }
            : {
                result: {
                  output: failure === "malformed" ? { results: [] } : supported,
                  usage: {
                    inputTokens: 300,
                    outputTokens: 80,
                    totalTokens: failure === "inconsistent usage" ? 999 : 380,
                  },
                },
              },
        ],
      });
      const generate = vi.fn(async (request) => {
        const result = await recorded.generate(request);
        if (request.outputSchemaName === "research_synthesis_v1") {
          if (failure === "kill switch")
            environment.AI_RESEARCH_ENABLED = "false";
        }
        return result;
      });
      await executeResearchSynthesis(
        { researchJobId: job.id, userId },
        {
          provider: { provider: "openai", model: config.model, generate },
          config,
          environment,
          now: () => budgetDate,
          buildSnapshot: async () => snapshot,
        },
      );
      const stored = await db.researchJob.findUniqueOrThrow({
        where: { id: job.id },
        include: {
          report: { include: { claims: { orderBy: { ordinal: "asc" } } } },
          aiUsage: true,
        },
      });
      expect(stored.status).toBe("COMPLETED");
      expect(stored.report?.verificationCompleted).toBe(false);
      expect(stored.report?.overview).toBe(output.summary);
      expect(stored.report?.claims.map((claim) => claim.statement)).toEqual(
        output.claims.map((claim) => claim.statement),
      );
      expect(
        stored.report?.claims.every(
          (claim) => claim.verificationStatus === "UNVERIFIED",
        ),
      ).toBe(true);
      expect(generate).toHaveBeenCalledTimes(
        ["kill switch", "job cap"].includes(failure) ? 1 : 2,
      );
      const uncertain = stored.aiUsage.find(
        (usage) => usage.status === "UNCONFIRMED",
      );
      if (["timeout", "inconsistent usage"].includes(failure)) {
        expect(uncertain?.operation).toBe("CLAIM_VERIFICATION");
        expect(stored.aiReservedTokens).toBeGreaterThan(0);
      } else expect(uncertain).toBeUndefined();
    },
  );

  it("does not call either model again after a checkpoint and an interrupted verifier attempt", async () => {
    const job = await createJob();
    const recorded = new RecordedResearchModelProvider({
      fixtures: [
        { result: { output, usage: { inputTokens: 500, outputTokens: 200 } } },
      ],
    });
    const environment = { ...baseEnvironment };
    const generate = vi.fn(async (request) => {
      const result = await recorded.generate(request);
      environment.AI_RESEARCH_ENABLED = "false";
      return result;
    });
    await executeResearchSynthesis(
      { researchJobId: job.id, userId },
      {
        provider: { provider: "openai", model: config.model, generate },
        config,
        environment,
        now: () => budgetDate,
        buildSnapshot: async () => snapshot,
      },
    );
    // Recreate the durable state of an interrupted delivery after the draft checkpoint.
    await db.researchJob.update({
      where: { id: job.id },
      data: { status: "RUNNING", completedAt: null },
    });
    await reserveAiUsage({
      idempotencyKey: `research:${job.id}:verification:model-attempt:1`,
      userId,
      researchJobId: job.id,
      operation: "CLAIM_VERIFICATION",
      promptVersion: AI_PROMPT_VERSION,
      attemptNumber: 1,
      reservedInputTokens: 1000,
      reservedOutputTokens: 200,
      config,
      now: budgetDate,
    });
    const noCalls = vi.fn();
    await executeResearchSynthesis(
      { researchJobId: job.id, userId, attemptNumber: 2 },
      {
        provider: {
          provider: "openai",
          model: config.model,
          generate: noCalls,
        },
        config,
        environment: baseEnvironment,
        now: () => budgetDate,
        buildSnapshot: async () => snapshot,
      },
    );
    expect(noCalls).not.toHaveBeenCalled();
    const final = await db.researchJob.findUniqueOrThrow({
      where: { id: job.id },
      include: { report: true },
    });
    expect(final.status).toBe("COMPLETED");
    expect(final.report?.verificationCompleted).toBe(false);
  });
});
