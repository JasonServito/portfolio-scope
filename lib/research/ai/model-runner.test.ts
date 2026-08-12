import { describe, expect, it, vi } from "vitest";

import { reserveAiUsage } from "./budget";
import { getAiResearchConfig } from "./config";
import { runGroundedModelCall } from "./model-runner";
import {
  ModelProviderError,
  ModelProviderErrorCode,
  RecordedResearchModelProvider,
  type ResearchModelProvider,
} from "./providers";
import { specialistModelOutputSchema, type ResearchEvidence } from "./schemas";

const evidence: ResearchEvidence = {
  id: "ev_0123456789abcdef",
  sourceKind: "SEC_FACT",
  title: "Revenue",
  sourceReference: "sec://fact/revenue",
  sourceUrl: "https://www.sec.gov/example",
  accessionNumber: "0000000000-26-000001",
  section: "Revenue FY2025",
  objectKey: null,
  sha256: null,
  sourceDate: "2025-12-31",
  retrievedAt: "2026-01-02T00:00:00.000Z",
  excerpt: "Revenue was USD 100 in FY2025.",
  passageStart: null,
  passageEnd: null,
  secFilingId: null,
  secRawSourceId: null,
  secFinancialFactId: "fact-a",
  metadata: {},
};

const validOutput = {
  rating: "NEUTRAL" as const,
  confidence: 0.8,
  summary: "Reported revenue is available for the stated period.",
  claims: [
    {
      category: "SUPPORTIVE" as const,
      statement: "Revenue was reported for FY2025.",
      confidence: 0.9,
      evidenceIds: [evidence.id],
      counterEvidenceIds: [],
      assumptions: [],
    },
  ],
  warnings: [],
  missingData: [],
};

const config = getAiResearchConfig({
  OPENAI_API_KEY: "test-only",
} as unknown as NodeJS.ProcessEnv);

describe("grounded model runner", () => {
  it("validates a recorded response without reserving external spend", async () => {
    const provider = new RecordedResearchModelProvider({
      fixtures: [{ result: { output: validOutput } }],
    });
    const reserve = vi.fn();

    const result = await runGroundedModelCall(
      {
        provider,
        config,
        schema: specialistModelOutputSchema,
        schemaName: "specialist_result",
        evidence: [evidence],
        prompt: () => ({ instructions: "Grounded only.", input: "{}" }),
        userId: "user-a",
        researchJobId: "job-a",
        operation: "FINANCIALS",
        idempotencyKey: "job-a:financials",
      },
      { reserve },
    );

    expect(result.output).toEqual(validOutput);
    expect(result.reservation).toBeNull();
    expect(reserve).not.toHaveBeenCalled();
  });

  it("repairs one invalid recorded response and rejects unsafe evidence ids", async () => {
    const provider = new RecordedResearchModelProvider({
      fixtures: [
        {
          result: {
            output: {
              ...validOutput,
              claims: [
                {
                  ...validOutput.claims[0],
                  evidenceIds: ["ev_deadbeefdeadbeef"],
                },
              ],
            },
          },
        },
        { result: { output: validOutput } },
      ],
    });

    const result = await runGroundedModelCall({
      provider,
      config,
      schema: specialistModelOutputSchema,
      schemaName: "specialist_result",
      evidence: [evidence],
      prompt: (feedback) => ({
        instructions: "Grounded only.",
        input: JSON.stringify({ feedback: feedback ?? null }),
      }),
      userId: "user-a",
      researchJobId: "job-a",
      operation: "FINANCIALS",
      idempotencyKey: "job-a:financials",
    });

    expect(result.attemptNumber).toBe(2);
    expect(provider.remainingFixtures).toBe(0);
  });

  it("reserves the schema and provider envelope for a zero-network metered call", async () => {
    const provider = {
      provider: "openai",
      model: config.model,
      generate: vi.fn(async () => ({
        output: validOutput,
        provider: "openai",
        model: config.model,
        providerRequestId: "request-metered",
        responseId: "response-metered",
        usage: {
          inputTokens: 50,
          cachedInputTokens: 0,
          outputTokens: 20,
          reasoningTokens: 0,
          totalTokens: 70,
        },
      })),
    } satisfies ResearchModelProvider;
    const reserve = vi.fn(
      async (input: Parameters<typeof reserveAiUsage>[0]) => {
        void input;
        return {
          usageId: "usage-metered",
          idempotencyKey: "metered:model-attempt:1",
          reservedInputTokens: 2_000,
          reservedOutputTokens: config.maxOutputTokensPerCall,
          reservedCostUsd: 0.01,
        };
      },
    );

    const result = await runGroundedModelCall(
      {
        provider,
        config,
        schema: specialistModelOutputSchema,
        schemaName: "specialist_result",
        evidence: [evidence],
        prompt: () => ({ instructions: "Grounded only.", input: "{}" }),
        userId: "user-a",
        researchJobId: "job-a",
        operation: "FINANCIALS",
        idempotencyKey: "metered",
      },
      {
        environment: {
          AI_RESEARCH_ENABLED: "true",
        } as unknown as NodeJS.ProcessEnv,
        reserve,
      },
    );

    expect(result.reservation?.usageId).toBe("usage-metered");
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        reservedInputTokens: expect.any(Number),
        reservedOutputTokens: config.maxOutputTokensPerCall,
      }),
    );
    expect(reserve.mock.calls[0][0].reservedInputTokens).toBeGreaterThan(1_024);
  });

  it.each([
    {
      code: ModelProviderErrorCode.CONFIGURATION,
      expected: "release",
    },
    {
      code: ModelProviderErrorCode.TIMEOUT,
      expected: "unconfirmed",
    },
  ])("records $expected accounting for $code", async ({ code, expected }) => {
    const provider = {
      provider: "openai",
      model: config.model,
      generate: vi.fn(async () => {
        throw new ModelProviderError(code, {
          provider: "openai",
          providerRequestId: "request-failure",
        });
      }),
    } satisfies ResearchModelProvider;
    const reserve = vi.fn(
      async (input: Parameters<typeof reserveAiUsage>[0]) => {
        void input;
        return {
          usageId: "usage-failure",
          idempotencyKey: "failure:model-attempt:1",
          reservedInputTokens: 2_000,
          reservedOutputTokens: config.maxOutputTokensPerCall,
          reservedCostUsd: 0.01,
        };
      },
    );
    const release = vi.fn();
    const markUnconfirmed = vi.fn();

    await expect(
      runGroundedModelCall(
        {
          provider,
          config,
          schema: specialistModelOutputSchema,
          schemaName: "specialist_result",
          evidence: [evidence],
          prompt: () => ({ instructions: "Grounded only.", input: "{}" }),
          userId: "user-a",
          researchJobId: "job-a",
          operation: "FINANCIALS",
          idempotencyKey: "failure",
        },
        {
          environment: {
            AI_RESEARCH_ENABLED: "true",
          } as unknown as NodeJS.ProcessEnv,
          markUnconfirmed,
          release,
          reserve,
        },
      ),
    ).rejects.toMatchObject({ code });

    if (expected === "release") {
      expect(release).toHaveBeenCalledWith("usage-failure", code);
      expect(markUnconfirmed).not.toHaveBeenCalled();
    } else {
      expect(markUnconfirmed).toHaveBeenCalledWith("usage-failure", code, {
        providerRequestId: "request-failure",
      });
      expect(release).not.toHaveBeenCalled();
    }
  });
});
