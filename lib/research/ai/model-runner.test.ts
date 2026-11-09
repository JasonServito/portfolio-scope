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
import { AAPL_FIXTURE_CURRENT_REPORTS } from "./fixtures/aapl-evidence-snapshot";
import { CURATED_AAPL_SNAPSHOT } from "./fixtures/curated-evaluation";
import { selectSpecialistEvidence } from "./retrieval";
import {
  ModelOutputConsistencyError,
  specialistModelOutputSchema,
  validateGroundedOutput,
  withDistinctClaimReferences,
  type ResearchEvidence,
} from "./schemas";

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
    // The single repair names the failed check, the claim, and the exact
    // unsupported number token.
    expect(prompt.mock.calls[1][0]).toContain(
      "The prior response failed the consistency check:",
    );
    expect(prompt.mock.calls[1][0]).toContain(
      "Failing claims: claim 1 states 250, which its cited supporting excerpts do not contain.",
    );
    expect(provider.remainingFixtures).toBe(0);
  });

  it("names the safety rule that tripped in the repair request", async () => {
    const pricePrediction = {
      ...validOutput,
      claims: [
        {
          ...validOutput.claims[0],
          category: "RISK" as const,
          statement: "Weaker demand means the stock price could fall.",
        },
      ],
    };
    const provider = new RecordedResearchModelProvider({
      fixtures: [
        { result: { output: pricePrediction } },
        { result: { output: validOutput } },
      ],
    });
    const prompt = vi.fn((feedback?: string) => ({
      instructions: "Grounded only.",
      input: JSON.stringify({ feedback: feedback ?? null }),
    }));

    const result = await runGroundedModelCall({
      provider,
      config,
      schema: specialistModelOutputSchema,
      schemaName: "specialist_result",
      evidence: [evidence],
      prompt,
      userId: "user-a",
      researchJobId: "job-a",
      operation: "SPECIALIST_RISK",
      idempotencyKey: "job-a:risk-safety",
    });

    expect(result.attemptNumber).toBe(2);
    expect(prompt.mock.calls[1][0]).toContain(
      "The prior response failed the safety check: The generated output contained a prohibited stock-price target or prediction.",
    );
    // The repair request quotes the flagged phrase so the model can reword it.
    expect(prompt.mock.calls[1][0]).toContain(
      'Flagged text: "stock price could fall"',
    );
  });

  it("logs why each output was rejected without model text", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const inconsistent = {
      ...validOutput,
      claims: [
        { ...validOutput.claims[0], statement: "Revenue was USD 250 in FY2025." },
      ],
    };
    const provider = new RecordedResearchModelProvider({
      fixtures: [
        { result: { output: inconsistent } },
        { result: { output: { rating: "NEUTRAL" } } },
      ],
    });

    await expect(
      runGroundedModelCall({
        provider,
        config,
        schema: specialistModelOutputSchema,
        schemaName: "specialist_result",
        evidence: [evidence],
        prompt: () => ({ instructions: "Grounded only.", input: "{}" }),
        userId: "user-a",
        researchJobId: "job-a",
        operation: "SPECIALIST_RISK",
        idempotencyKey: "job-a:risk-rejected",
      }),
    ).rejects.toMatchObject({ code: "AI_MODEL_OUTPUT_INVALID" });

    const lines = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("ai.model.output.rejected"));
    warn.mockRestore();
    expect(lines).toHaveLength(2);
    const [first, second] = lines.map((line) => JSON.parse(line));
    expect(first).toMatchObject({
      errorCode: "AI_INCONSISTENT_OUTPUT",
      details: {
        researchJobId: "job-a",
        operation: "SPECIALIST_RISK",
        attempt: 1,
        maxAttempts: 2,
        reason: expect.stringMatching(/does not appear with the same unit/),
      },
    });
    expect(second).toMatchObject({
      errorCode: "AI_MODEL_OUTPUT_INVALID",
      details: { attempt: 2, reason: expect.stringContaining("invalid_type") },
    });
    // The repair request names the unsupported number; the log never does.
    for (const line of lines) {
      expect(line).not.toContain("USD 250");
      const { timestamp, ...logged } = JSON.parse(line);
      expect(typeof timestamp).toBe("string");
      expect(JSON.stringify(logged)).not.toContain("250");
      expect(JSON.stringify(logged)).not.toContain("Failing claims");
    }
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

describe("claim reference normalization before validation (2026-11-05 Production AAPL report)", () => {
  const news = selectSpecialistEvidence(CURATED_AAPL_SNAPSHOT, "NEWS");
  const newsEvidence = [...news.evidence];
  const datedResultsItem = newsEvidence.find(
    (item) =>
      item.metadata.evidenceType === "SEC_CURRENT_REPORT" &&
      item.accessionNumber === AAPL_FIXTURE_CURRENT_REPORTS.results.accessionNumber,
  )!;
  const pressReleaseOpening = newsEvidence.find(
    (item) =>
      item.metadata.evidenceType === "SEC_FILING_PASSAGE" &&
      item.metadata.sectionKind === "PRESS_RELEASE",
  )!;
  const newsOutput = (statement: string, evidenceIds: string[]) => ({
    rating: "NEUTRAL" as const,
    confidence: 0.7,
    availability: "COMPLETE" as const,
    summary: "The newest current report announced quarterly results.",
    claims: [
      {
        category: "SUPPORTIVE" as const,
        kind: "FACT" as const,
        statement,
        confidence: 0.8,
        evidenceIds,
        counterEvidenceIds: [] as string[],
        assumptions: [],
      },
    ],
    warnings: [],
    missingData: [],
  });
  // The filing date and item code come from the dated 8-K item; the figures
  // come from the press-release passage, which states neither.
  const eventStatement =
    "In a Form 8-K filed 2026-07-30 under Item 2.02, the Company reported quarterly revenue of $94.0 billion, up 10 percent year over year.";
  const run = (outputs: unknown[]) =>
    runGroundedModelCall({
      provider: new RecordedResearchModelProvider({
        fixtures: outputs.map((output) => ({ result: { output } })),
      }),
      config,
      schema: specialistModelOutputSchema,
      schemaName: "research_news_v1",
      evidence: newsEvidence,
      prompt: () => ({ instructions: "Grounded only.", input: "{}" }),
      userId: "user-a",
      researchJobId: "job-a",
      operation: "SPECIALIST_NEWS",
      idempotencyKey: "job-a:news",
    });

  it("reproduces the News rejection: a passage-only citation cannot support the 8-K filing date and item code", () => {
    expect(() =>
      validateGroundedOutput(newsOutput(eventStatement, [pressReleaseOpening.id]), newsEvidence),
    ).toThrow(ModelOutputConsistencyError);
  });

  it("adds the same filing's dated 8-K item to a claim that cites only its passage, then checks every number", async () => {
    const result = await run([newsOutput(eventStatement, [pressReleaseOpening.id])]);
    expect(result.attemptNumber).toBe(1);
    expect(result.output.claims[0].evidenceIds).toEqual([
      pressReleaseOpening.id,
      datedResultsItem.id,
    ]);

    // The gate stays strict: a figure neither excerpt states still fails both attempts.
    const wrong = newsOutput(
      eventStatement.replace("$94.0 billion", "$95.0 billion"),
      [pressReleaseOpening.id],
    );
    await expect(run([wrong, wrong])).rejects.toMatchObject({
      code: "AI_INCONSISTENT_OUTPUT",
    });
  });

  it("accepts a claim that repeats an evidence id instead of rejecting it as unsafe", async () => {
    const repeated = newsOutput(eventStatement, [
      pressReleaseOpening.id,
      datedResultsItem.id,
      pressReleaseOpening.id,
    ]);
    repeated.claims[0].counterEvidenceIds = [datedResultsItem.id, datedResultsItem.id];
    expect(() => validateGroundedOutput(repeated, newsEvidence)).toThrow(
      "A claim repeated the same evidence reference.",
    );

    const result = await run([repeated]);
    expect(result.attemptNumber).toBe(1);
    expect(result.output.claims[0]).toMatchObject({
      evidenceIds: [pressReleaseOpening.id, datedResultsItem.id],
      counterEvidenceIds: [],
    });
    expect(withDistinctClaimReferences(result.output)).toEqual(result.output);
  });
});
