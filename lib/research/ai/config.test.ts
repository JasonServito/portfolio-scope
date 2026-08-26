import { describe, expect, it } from "vitest";

import {
  AI_PRICING_VERSION,
  AiConfigurationError,
  createQueuedAiGenerationConfig,
  getAiResearchConfig,
  getQueuedAiResearchConfig,
  getSupportedResearchModels,
} from "@/lib/research/ai/config";

const baseEnvironment = {
  OPENAI_API_KEY: "test-only",
} as unknown as NodeJS.ProcessEnv;

describe("AI research configuration", () => {
  it("uses bounded defaults and never accepts a global budget above five dollars", () => {
    expect(getAiResearchConfig(baseEnvironment)).toMatchObject({
      model: "gpt-5.4-mini-2026-03-17",
      pricing: {
        inputUsdPerMillion: 0.75,
        cachedInputUsdPerMillion: 0.075,
        outputUsdPerMillion: 4.5,
      },
      pricingVersion: "openai-pricing-2026-08-24",
      globalMonthlyBudgetUsd: 5,
      userMonthlyBudgetUsd: 1,
      maxCostPerJobUsd: 0.25,
      maxTokensPerJob: 50_000,
      maxOutputTokensPerCall: 1_500,
      userMonthlyReportLimit: 5,
    });
    expect(() =>
      getAiResearchConfig({
        ...baseEnvironment,
        AI_MONTHLY_BUDGET_USD: "5.01",
      }),
    ).toThrow(AiConfigurationError);
  });

  it("rejects missing credentials, unsupported models, and inverted limits", () => {
    expect(() =>
      getAiResearchConfig({} as unknown as NodeJS.ProcessEnv),
    ).toThrow(AiConfigurationError);
    expect(() =>
      getAiResearchConfig({
        ...baseEnvironment,
        OPENAI_RESEARCH_MODEL: "gpt-5-mini-2025-08-07",
      }),
    ).toThrow(AiConfigurationError);
    expect(() =>
      getAiResearchConfig({
        ...baseEnvironment,
        OPENAI_RESEARCH_MODEL: "gpt-5.6-luna",
      }),
    ).toThrow(AiConfigurationError);
    expect(() =>
      getAiResearchConfig({
        ...baseEnvironment,
        OPENAI_RESEARCH_MODEL: "floating-latest",
      }),
    ).toThrow(AiConfigurationError);
    expect(() =>
      getAiResearchConfig({
        ...baseEnvironment,
        AI_MONTHLY_BUDGET_USD: "1",
        AI_USER_MONTHLY_BUDGET_USD: "2",
      }),
    ).toThrow(AiConfigurationError);
    expect(() =>
      getAiResearchConfig({
        ...baseEnvironment,
        AI_USER_MONTHLY_BUDGET_USD: "0.10",
        AI_MAX_COST_PER_JOB_USD: "0.20",
      }),
    ).toThrow(AiConfigurationError);
    expect(() =>
      getAiResearchConfig({
        ...baseEnvironment,
        AI_USER_MONTHLY_BUDGET_USD: "1.01",
      }),
    ).toThrow(AiConfigurationError);
    expect(() =>
      getAiResearchConfig({
        ...baseEnvironment,
        AI_MAX_COST_PER_JOB_USD: "0.251",
      }),
    ).toThrow(AiConfigurationError);
    expect(() =>
      getAiResearchConfig({
        ...baseEnvironment,
        AI_MAX_TOKENS_PER_JOB: "50001",
      }),
    ).toThrow(AiConfigurationError);
  });

  it("uses the current verified rates for every allowlisted model", () => {
    expect(AI_PRICING_VERSION).toBe("openai-pricing-2026-08-24");
    expect(getSupportedResearchModels()).toEqual([
      {
        model: "gpt-5.4-mini-2026-03-17",
        inputUsdPerMillion: 0.75,
        cachedInputUsdPerMillion: 0.075,
        outputUsdPerMillion: 4.5,
      },
    ]);
  });

  it("binds queued work to its requested model and output configuration", () => {
    const requested = getAiResearchConfig({
      ...baseEnvironment,
      OPENAI_RESEARCH_MODEL: "gpt-5.4-mini-2026-03-17",
      AI_MAX_OUTPUT_TOKENS_PER_CALL: "777",
      AI_PROVIDER_TIMEOUT_MS: "12345",
    });
    const queued = createQueuedAiGenerationConfig(requested);
    const resolved = getQueuedAiResearchConfig(queued, {
      ...baseEnvironment,
      OPENAI_RESEARCH_MODEL: "gpt-5-mini-2025-08-07",
      AI_MAX_OUTPUT_TOKENS_PER_CALL: "1500",
      AI_PROVIDER_TIMEOUT_MS: "20000",
    });

    expect(resolved).toMatchObject({
      model: "gpt-5.4-mini-2026-03-17",
      maxOutputTokensPerCall: 777,
      providerTimeoutMs: 12_345,
      pricingVersion: "openai-pricing-2026-08-24",
    });
  });

  it("resolves legacy queued work with the pricing snapshot it requested", () => {
    const current = createQueuedAiGenerationConfig(
      getAiResearchConfig(baseEnvironment),
    );
    const resolved = getQueuedAiResearchConfig(
      {
        ...current,
        model: "gpt-5.6-luna",
        pricingVersion: "openai-pricing-2026-08-11",
      },
      baseEnvironment,
    );

    expect(resolved).toMatchObject({
      model: "gpt-5.6-luna",
      pricing: {
        inputUsdPerMillion: 1,
        cachedInputUsdPerMillion: 0.1,
        outputUsdPerMillion: 6,
      },
      pricingVersion: "openai-pricing-2026-08-11",
    });
  });
});
