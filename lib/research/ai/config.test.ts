import { describe, expect, it } from "vitest";

import {
  AiConfigurationError,
  createQueuedAiGenerationConfig,
  getAiResearchConfig,
  getQueuedAiResearchConfig,
} from "@/lib/research/ai/config";

const baseEnvironment = {
  OPENAI_API_KEY: "test-only",
} as unknown as NodeJS.ProcessEnv;

describe("AI research configuration", () => {
  it("uses bounded defaults and never accepts a global budget above five dollars", () => {
    expect(getAiResearchConfig(baseEnvironment)).toMatchObject({
      model: "gpt-5-mini-2025-08-07",
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
    });
  });
});
