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
  availability: "COMPLETE" as const,
  summary: "Reported revenue is available for the stated period.",
  claims: [
    {
      category: "SUPPORTIVE" as const,
      kind: "FACT" as const,
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

  it("repairs an inconsistent response once with the failed check, then fails safe", async () => {
    const inconsistent = {
      ...validOutput,
      claims: [
        { ...validOutput.claims[0], statement: "Revenue was USD 250 in FY2025." },
      ],
    };
    const provider = new RecordedResearchModelProvider({
      fixtures: [
        { result: { output: inconsistent } },
        { result: { output: inconsistent } },
      ],
    });
    const prompt = vi.fn((feedback?: string) => ({
      instructions: "Grounded only.",
      input: JSON.stringify({ feedback: feedback ?? null }),
    }));

    await expect(
      runGroundedModelCall({
        provider,
        config,
        schema: specialistModelOutputSchema,
        schemaName: "specialist_result",
        evidence: [evidence],
        prompt,
        userId: "user-a",
        researchJobId: "job-a",
        operation: "FINANCIALS",
        idempotencyKey: "job-a:financials-inconsistent",
      }),
    ).rejects.toMatchObject({
      name: "GroundedModelCallError",
      code: "AI_INCONSISTENT_OUTPUT",
      retryable: false,
      partialResultAllowed: true,
    });
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompt.mock.calls[0][0]).toBeUndefined();
    expect(prompt.mock.calls[1][0]).toMatch(/does not appear with the same unit/);
    expect(provider.remainingFixtures).toBe(0);
  });

  it("stops before the first metered attempt when the kill switch is off", async () => {
    const provider = {
      provider: "openai",
      model: config.model,
      generate: vi.fn(),
    } satisfies ResearchModelProvider;
    const reserve = vi.fn();

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
          idempotencyKey: "disabled",
        },
        {
          environment: {
            AI_RESEARCH_ENABLED: "false",
          } as unknown as NodeJS.ProcessEnv,
          reserve,
        },
      ),
    ).rejects.toMatchObject({ code: "AI_RESEARCH_DISABLED" });
    expect(reserve).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("rechecks the kill switch before a charged repair attempt", async () => {
    const environment = {
      AI_RESEARCH_ENABLED: "true",
    } as unknown as NodeJS.ProcessEnv;
    const provider = {
      provider: "openai",
      model: config.model,
      generate: vi.fn(async () => {
        environment.AI_RESEARCH_ENABLED = "false";
        return {
          output: {
            ...validOutput,
            claims: [
              {
                ...validOutput.claims[0],
                evidenceIds: ["ev_deadbeefdeadbeef"],
              },
            ],
          },
          provider: "openai" as const,
          model: config.model,
          providerRequestId: "request-invalid",
          responseId: "response-invalid",
          usage: {
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 5,
            reasoningTokens: 0,
            totalTokens: 15,
          },
        };
      }),
    } satisfies ResearchModelProvider;
    const reserve = vi.fn(async () => ({
      usageId: "usage-invalid",
      idempotencyKey: "repair:model-attempt:1",
      reservedInputTokens: 2_000,
      reservedOutputTokens: config.maxOutputTokensPerCall,
      reservedCostUsd: 0.01,
    }));
    const settle = vi.fn();

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
          idempotencyKey: "repair",
        },
        { environment, reserve, settle },
      ),
    ).rejects.toMatchObject({ code: "AI_RESEARCH_DISABLED" });
    expect(provider.generate).toHaveBeenCalledOnce();
    expect(reserve).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledWith("usage-invalid", {
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 5,
      reasoningTokens: 0,
      providerTotalTokens: 15,
      providerRequestId: "request-invalid",
    });
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

  it("settles the complete provider usage tuple returned with a charge-certain error", async () => {
    const provider = {
      provider: "openai",
      model: config.model,
      generate: vi.fn(async () => {
        throw new ModelProviderError(ModelProviderErrorCode.INVALID_RESPONSE, {
          provider: "openai",
          providerRequestId: "request-metered-error",
          chargeUncertain: false,
          usage: {
            inputTokens: 80,
            cachedInputTokens: 20,
            outputTokens: 30,
            reasoningTokens: 12,
            totalTokens: 110,
          },
        });
      }),
    } satisfies ResearchModelProvider;
    const reserve = vi.fn(async () => ({
      usageId: "usage-metered-error",
      idempotencyKey: "metered-error:model-attempt:1",
      reservedInputTokens: 2_000,
      reservedOutputTokens: config.maxOutputTokensPerCall,
      reservedCostUsd: 0.01,
    }));
    const settle = vi.fn();

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
          idempotencyKey: "metered-error",
        },
        {
          environment: {
            AI_RESEARCH_ENABLED: "true",
          } as unknown as NodeJS.ProcessEnv,
          reserve,
          settle,
        },
      ),
    ).rejects.toMatchObject({
      code: ModelProviderErrorCode.INVALID_RESPONSE,
    });
    expect(settle).toHaveBeenCalledWith("usage-metered-error", {
      inputTokens: 80,
      cachedInputTokens: 20,
      outputTokens: 30,
      reasoningTokens: 12,
      providerTotalTokens: 110,
      providerRequestId: "request-metered-error",
    });
  });

  it("retains the complete provider tuple as unconfirmed when cost is uncertain", async () => {
    const provider = {
      provider: "openai",
      model: config.model,
      generate: vi.fn(async () => {
        throw new ModelProviderError(ModelProviderErrorCode.INVALID_RESPONSE, {
          provider: "openai",
          providerRequestId: "request-model-mismatch",
          chargeUncertain: true,
          usage: {
            inputTokens: 80,
            cachedInputTokens: 20,
            outputTokens: 30,
            reasoningTokens: 12,
            totalTokens: 110,
          },
        });
      }),
    } satisfies ResearchModelProvider;
    const reserve = vi.fn(async () => ({
      usageId: "usage-model-mismatch",
      idempotencyKey: "model-mismatch:model-attempt:1",
      reservedInputTokens: 2_000,
      reservedOutputTokens: config.maxOutputTokensPerCall,
      reservedCostUsd: 0.01,
    }));
    const markUnconfirmed = vi.fn();
    const settle = vi.fn();

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
          idempotencyKey: "model-mismatch",
        },
        {
          environment: {
            AI_RESEARCH_ENABLED: "true",
          } as unknown as NodeJS.ProcessEnv,
          reserve,
          settle,
          markUnconfirmed,
        },
      ),
    ).rejects.toMatchObject({
      code: ModelProviderErrorCode.INVALID_RESPONSE,
    });
    expect(markUnconfirmed).toHaveBeenCalledWith(
      "usage-model-mismatch",
      ModelProviderErrorCode.INVALID_RESPONSE,
      {
        inputTokens: 80,
        cachedInputTokens: 20,
        outputTokens: 30,
        reasoningTokens: 12,
        providerTotalTokens: 110,
        providerRequestId: "request-model-mismatch",
      },
    );
    expect(settle).not.toHaveBeenCalled();
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
      expect(release).toHaveBeenCalledWith("usage-failure", code, {
        providerRequestId: "request-failure",
      });
      expect(markUnconfirmed).not.toHaveBeenCalled();
    } else {
      expect(markUnconfirmed).toHaveBeenCalledWith("usage-failure", code, {
        providerRequestId: "request-failure",
      });
      expect(release).not.toHaveBeenCalled();
    }
  });
});
