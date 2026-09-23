import { randomUUID } from "node:crypto";

import { ResearchGenerationMode, ResearchStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import type { JobPublisher } from "@/lib/jobs/qstash";
import {
  AI_PROMPT_VERSION,
  AI_RETRIEVAL_VERSION,
  getAiResearchConfig,
} from "@/lib/research/ai/config";
import {
  AAPL_FIXTURE_PEERS,
  AAPL_FIXTURE_STOCK,
  AAPL_FIXTURE_UPCOMING_EARNINGS,
  aaplFixtureFactCandidates,
  aaplFixturePeerFactCandidates,
  findFixtureEvidence,
} from "@/lib/research/ai/fixtures/aapl-evidence-snapshot";
import {
  AAPL_GROUNDED_SYNTHESIS,
  AAPL_RECORDED_SPECIALIST_OUTPUTS,
  CURATED_AAPL_SNAPSHOT,
} from "@/lib/research/ai/fixtures/curated-evaluation";
import type { GroundedModelOutput } from "@/lib/research/ai/schemas";
import { RecordedResearchModelProvider } from "@/lib/research/ai/providers";
import {
  assembleResearchEvidenceSnapshot,
  buildResearchEvidenceSnapshot,
  createPrismaResearchEvidenceRepository,
  RESEARCH_EVIDENCE_SNAPSHOT_VERSION,
} from "@/lib/research/ai/retrieval";
import {
  executeResearchAgent,
  executeResearchSynthesis,
} from "@/lib/research/background";
import { getOwnedResearchJob, runResearch } from "@/lib/research/orchestrator";

const runId = randomUUID().replaceAll("-", "");
const prefix = `m29-${runId}`;
const ticker = `Y${runId.slice(0, 8).toUpperCase()}`;
const privateMarker = `PRIVATE-${runId}-DO-NOT-SEND`;
const ids = {
  user: `${prefix}-user`,
  otherUser: `${prefix}-other-user`,
  stock: `${prefix}-stock`,
  portfolio: `${prefix}-portfolio`,
  peerCompany: `${prefix}-peer-company`,
  peerEntity: `${prefix}-peer-entity`,
  peerRawSource: `${prefix}-peer-raw`,
};
const peerCik = String(Number.parseInt(runId.slice(0, 8), 16) % 1_000_000_000)
  .padStart(10, "0");
const peerRetrievedAt = new Date("2026-09-21T12:00:00.000Z");

function peerFact(input: {
  metric: string;
  periodKind: "ANNUAL" | "INSTANT" | "QUARTERLY";
  periodStart: string | null;
  periodEnd: string;
  value: number;
}) {
  return {
    secEntityId: ids.peerEntity,
    rawSourceId: ids.peerRawSource,
    externalKey: `${prefix}-${input.metric}-${input.periodKind}-${input.periodEnd}`,
    canonicalMetric: input.metric,
    taxonomy: "us-gaap",
    concept: input.metric,
    label: input.metric,
    originalValue: input.value,
    originalUnit: "USD",
    normalizedValue: input.value,
    normalizedUnit: "USD",
    periodStart:
      input.periodStart === null
        ? null
        : new Date(`${input.periodStart}T00:00:00.000Z`),
    periodEnd: new Date(`${input.periodEnd}T00:00:00.000Z`),
    periodType: input.periodKind === "INSTANT" ? ("INSTANT" as const) : ("DURATION" as const),
    periodKind: input.periodKind,
    formType: "10-K",
    filedAt: new Date("2025-08-01T00:00:00.000Z"),
    accessionNumber: `0000000000-25-${input.periodEnd.replaceAll("-", "").slice(-6)}`,
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/0/",
    observedAt: peerRetrievedAt,
    normalizationVersion: "sec-xbrl-v1",
    selection: "SELECTED" as const,
  };
}
const fixtureUserIds = [ids.user, ids.otherUser];

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
});

// Evidence ids hash the source reference, which embeds the ticker, so the
// recorded AAPL outputs are re-keyed to this run's snapshot by reference.
const evidenceIdByReference = new Map(
  snapshot.evidence.map((item) => [item.sourceReference, item.id]),
);
const fixtureReferenceById = new Map(
  CURATED_AAPL_SNAPSHOT.evidence.map((item) => [item.id, item.sourceReference]),
);
function rekey(id: string) {
  const reference = fixtureReferenceById.get(id)!.replaceAll("AAPL", ticker);
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

function recordedProvider() {
  return new RecordedResearchModelProvider({
    model: "recorded-m29-integration-v1",
    fixtures: [
      rekeyOutput(AAPL_RECORDED_SPECIALIST_OUTPUTS.FINANCIALS),
      rekeyOutput(AAPL_RECORDED_SPECIALIST_OUTPUTS.COMPETITORS),
      rekeyOutput(AAPL_RECORDED_SPECIALIST_OUTPUTS.RISK),
      rekeyOutput(AAPL_GROUNDED_SYNTHESIS),
    ].map((output, index) => ({
      result: {
        output,
        providerRequestId: `${prefix}-recording-${index + 1}`,
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    })),
  });
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
  await db.secFinancialFact.deleteMany({
    where: { secEntityId: ids.peerEntity },
  });
  await db.company.deleteMany({ where: { id: ids.peerCompany } });
}

beforeAll(async () => {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  ) {
    throw new Error("M29 integration tests must not run against production.");
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
      upcomingEarnings: {
        create: {
          eventDate: AAPL_FIXTURE_UPCOMING_EARNINGS.eventDate as Date,
          marketSession: "AFTER_MARKET",
          source: AAPL_FIXTURE_UPCOMING_EARNINGS.source,
          fetchedAt: AAPL_FIXTURE_UPCOMING_EARNINGS.fetchedAt as Date,
        },
      },
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
          shares: 321.654,
          averageCost: 111.222,
          costBasis: 35_775.29,
        },
      },
    },
  });
  await db.watchlistItem.create({
    data: {
      userId: ids.user,
      stockId: ids.stock,
      targetPrice: 543.21,
      notes: `${privateMarker}-WATCHLIST`,
    },
  });
  await db.company.create({
    data: {
      id: ids.peerCompany,
      slug: `${prefix}-peer`,
      name: "M29 Peer Fixture",
      isSupported: true,
      secEntity: {
        create: {
          id: ids.peerEntity,
          cik: peerCik,
          legalName: "M29 Peer Fixture Inc.",
          rawSources: {
            create: {
              id: ids.peerRawSource,
              kind: "COMPANY_FACTS",
              sourceUrl: `https://data.sec.gov/api/xbrl/companyfacts/CIK${peerCik}.json`,
              objectKey: `sec/${prefix}/company-facts.json`,
              sha256: "3".repeat(64),
              contentType: "application/json",
              byteLength: 10,
              firstRetrievedAt: peerRetrievedAt,
              lastRetrievedAt: peerRetrievedAt,
            },
          },
        },
      },
    },
  });
  await db.secFinancialFact.createMany({
    data: [
      peerFact({ metric: "REVENUE", periodKind: "ANNUAL", periodStart: "2024-07-01", periodEnd: "2025-06-30", value: 1_000 }),
      peerFact({ metric: "REVENUE", periodKind: "ANNUAL", periodStart: "2023-07-01", periodEnd: "2024-06-30", value: 800 }),
      peerFact({ metric: "REVENUE", periodKind: "ANNUAL", periodStart: "2022-07-01", periodEnd: "2023-06-30", value: 700 }),
      peerFact({ metric: "REVENUE", periodKind: "QUARTERLY", periodStart: "2025-04-01", periodEnd: "2025-06-30", value: 300 }),
      peerFact({ metric: "STOCKHOLDERS_EQUITY", periodKind: "INSTANT", periodStart: null, periodEnd: "2025-06-30", value: 500 }),
      peerFact({ metric: "STOCKHOLDERS_EQUITY", periodKind: "INSTANT", periodStart: null, periodEnd: "2024-06-30", value: 400 }),
    ],
  });
});

afterAll(cleanup);

describe("M29 derived and structured research evidence", () => {
  it("persists a recorded AAPL-fixture report whose citations resolve to derived, table, trend, peer, and event evidence", async () => {
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
    });
    const yesterday = new Date(Date.now() - 86_400_000);
    yesterday.setUTCHours(23, 59, 0, 0);
    await db.researchJob.update({
      where: { id: queued.jobId },
      data: { createdAt: yesterday },
    });

    // Snapshot integrity for the new version: the persisted JSON restores
    // byte-for-byte and includes the additive evidence kinds.
    const restored = await buildResearchEvidenceSnapshot(queued.jobId);
    expect(restored).toEqual(snapshot);
    expect(restored?.schemaVersion).toBe(RESEARCH_EVIDENCE_SNAPSHOT_VERSION);
    expect(
      restored?.evidence.filter((item) => item.sourceKind === "DERIVED").length,
    ).toBe(20);

    for (const agentName of ["FINANCIALS", "COMPETITORS", "RISK", "NEWS"] as const) {
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
    await executeResearchSynthesis(
      { researchJobId: queued.jobId, userId: ids.user },
      { provider, config, environment },
    );

    expect(generate).toHaveBeenCalledTimes(4);
    expect(provider.remainingFixtures).toBe(0);
    const requests = generate.mock.calls.map(([request]) => ({
      instructions: request.instructions,
      input: String(request.input),
    }));
    const summaryTable = findFixtureEvidence(snapshot, {
      evidenceType: "FINANCIAL_SUMMARY_TABLE",
    });
    const peerTable = findFixtureEvidence(snapshot, {
      evidenceType: "PEER_COMPARISON_TABLE",
    });
    const debtToEquity = findFixtureEvidence(snapshot, {
      evidenceType: "DERIVED_METRIC",
      metricId: "DEBT_TO_EQUITY",
    });
    const escaped = (value: string) => JSON.stringify(value).slice(1, -1);
    expect(requests[0].input).toContain(escaped(summaryTable.excerpt));
    expect(requests[1].input).toContain(escaped(peerTable.excerpt));
    expect(requests[2].input).toContain(escaped(debtToEquity.excerpt));
    expect(requests[3].input).toContain(escaped(summaryTable.excerpt));
    expect(requests[3].input).toContain(escaped(peerTable.excerpt));
    for (const request of requests) {
      expect(request.instructions).toContain("never calculate");
      expect(request.input).not.toContain(privateMarker);
      expect(request.input).not.toContain("321.654");
      expect(request.input).not.toContain("111.222");
      expect(request.input).not.toContain("543.21");
      expect(request.input).not.toMatch(/userId|portfolio|holding|alert/i);
    }

    const stored = await db.researchJob.findUniqueOrThrow({
      where: { id: queued.jobId },
      include: {
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
      retrievalVersion: AI_RETRIEVAL_VERSION,
      sourceSnapshotSha256: snapshot.sourceSnapshotSha256,
    });
    expect(stored.report).toMatchObject({
      provider: "recorded",
      promptVersion: AI_PROMPT_VERSION,
      retrievalVersion: "m29-structured-lexical-v1",
    });
    expect(stored.report?.claims).toHaveLength(6);
    const evidenceRows = stored.report!.claims.flatMap((claim) => claim.evidence);
    expect(evidenceRows.filter((row) => row.sourceKind === "DERIVED").length).toBe(
      7,
    );
    const citedTypes = new Set(
      evidenceRows.map(
        (row) => (row.metadataJson as { evidenceType?: string }).evidenceType,
      ),
    );
    expect(citedTypes).toEqual(
      new Set([
        "DERIVED_METRIC",
        "FINANCIAL_SUMMARY_TABLE",
        "FINANCIAL_TREND_EXCERPT",
        "PEER_COMPARISON_TABLE",
        "UPCOMING_EARNINGS_EVENT",
      ]),
    );
    const snapshotIds = new Set(snapshot.evidence.map((item) => item.id));
    expect(evidenceRows.every((row) => snapshotIds.has(row.referenceKey))).toBe(
      true,
    );

    const owned = await getOwnedResearchJob(ids.user, queued.jobId);
    const registryIds = new Set(
      owned?.research?.evidenceRegistry?.map((item) => item.id) ?? [],
    );
    expect(registryIds.size).toBe(snapshot.evidence.length);
    expect(
      owned?.research?.claims?.every((claim) =>
        claim.evidence.every((reference) => registryIds.has(reference.id)),
      ),
    ).toBe(true);
    expect(
      owned?.research?.evidenceRegistry?.some(
        (item) => item.sourceKind === "DERIVED",
      ),
    ).toBe(true);
    await expect(
      getOwnedResearchJob(ids.otherUser, queued.jobId),
    ).resolves.toBeNull();

    // Fingerprint reuse and the same-day boundary are unchanged for the new
    // snapshot version.
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
    // Active duplicate work is deduplicated before any further generation.
    await expect(
      runResearch(ids.user, ticker, {
        publisher,
        environment,
        regenerate: true,
        prepareSnapshot: async () => snapshot,
      }),
    ).resolves.toMatchObject({ jobId: regenerated.jobId, reused: true });
  });

  it("reads the stored upcoming earnings event and peer SEC entities through the Prisma repository", async () => {
    const repository = createPrismaResearchEvidenceRepository(db);
    await expect(repository.findUpcomingEarnings(ids.stock)).resolves.toMatchObject(
      {
        eventDate: AAPL_FIXTURE_UPCOMING_EARNINGS.eventDate,
        marketSession: "AFTER_MARKET",
        source: AAPL_FIXTURE_UPCOMING_EARNINGS.source,
      },
    );
    await expect(
      repository.findUpcomingEarnings(`${prefix}-missing-stock`),
    ).resolves.toBeNull();
    await expect(
      repository.listPeerSecFactCandidates({
        secEntityIds: [`${prefix}-no-entity`],
        metrics: ["REVENUE"],
        annualPeriodEndFrom: new Date("2024-01-01T00:00:00.000Z"),
        instantPeriodEndFrom: new Date("2024-01-01T00:00:00.000Z"),
        take: 10,
      }),
    ).resolves.toEqual([]);

    // Annual facts inside the two-year lookback and reporting-date facts
    // inside the shorter lookback are returned; quarterly and older rows are
    // not, and ordering is deterministic.
    const rows = await repository.listPeerSecFactCandidates({
      secEntityIds: [ids.peerEntity],
      metrics: ["REVENUE", "STOCKHOLDERS_EQUITY"],
      annualPeriodEndFrom: new Date("2024-04-28T00:00:00.000Z"),
      instantPeriodEndFrom: new Date("2025-05-23T00:00:00.000Z"),
      take: 100,
    });
    expect(
      rows.map((row) => [
        row.canonicalMetric,
        row.periodKind,
        new Date(row.periodEnd).toISOString().slice(0, 10),
        row.normalizedValue.toString(),
      ]),
    ).toEqual([
      ["REVENUE", "ANNUAL", "2025-06-30", "1000"],
      ["REVENUE", "ANNUAL", "2024-06-30", "800"],
      ["STOCKHOLDERS_EQUITY", "INSTANT", "2025-06-30", "500"],
    ]);
  });
});
