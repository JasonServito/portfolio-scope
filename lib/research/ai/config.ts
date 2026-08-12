import { z } from "zod";

export const AI_PRICING_VERSION = "openai-pricing-2026-08-11";
export const AI_PROMPT_VERSION = "m18-research-v1";
export const AI_RETRIEVAL_VERSION = "m18-lexical-v1";
export const AI_OUTPUT_SCHEMA_VERSION = "m18-claims-v1";
export const AI_REPORT_VERSION = "m18-report-v1";
export const AI_CALCULATION_VERSION = "portfolio-v1";

const supportedModels = {
  "gpt-5-mini-2025-08-07": {
    inputUsdPerMillion: 0.25,
    cachedInputUsdPerMillion: 0.025,
    outputUsdPerMillion: 2,
  },
  "gpt-5.4-mini-2026-03-17": {
    inputUsdPerMillion: 0.75,
    cachedInputUsdPerMillion: 0.075,
    outputUsdPerMillion: 4.5,
  },
  "gpt-5.6-luna": {
    inputUsdPerMillion: 1,
    cachedInputUsdPerMillion: 0.1,
    outputUsdPerMillion: 6,
  },
} as const;

export type SupportedResearchModel = keyof typeof supportedModels;

export const queuedAiGenerationConfigSchema = z
  .object({
    provider: z.literal("openai"),
    model: z.enum(
      Object.keys(supportedModels) as [
        SupportedResearchModel,
        ...SupportedResearchModel[],
      ],
    ),
    maxOutputTokensPerCall: z.number().int().positive().max(8_000),
    providerTimeoutMs: z.number().int().min(1_000).max(25_000),
    pricingVersion: z.literal(AI_PRICING_VERSION),
    promptVersion: z.literal(AI_PROMPT_VERSION),
    retrievalVersion: z.literal(AI_RETRIEVAL_VERSION),
    outputSchemaVersion: z.literal(AI_OUTPUT_SCHEMA_VERSION),
    reportVersion: z.literal(AI_REPORT_VERSION),
    calculationVersion: z.literal(AI_CALCULATION_VERSION),
  })
  .strict();

export type QueuedAiGenerationConfig = z.infer<
  typeof queuedAiGenerationConfigSchema
>;

const optionalNumber = (fallback: number) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? fallback : value),
    z.coerce.number().finite().positive(),
  );

const aiEnvironmentSchema = z
  .object({
    OPENAI_API_KEY: z.string().trim().min(1),
    OPENAI_RESEARCH_MODEL: z
      .enum(
        Object.keys(supportedModels) as [
          SupportedResearchModel,
          ...SupportedResearchModel[],
        ],
      )
      .default("gpt-5-mini-2025-08-07"),
    AI_MONTHLY_BUDGET_USD: optionalNumber(5).pipe(z.number().max(5)),
    AI_USER_MONTHLY_BUDGET_USD: optionalNumber(1).pipe(z.number().max(5)),
    AI_MAX_COST_PER_JOB_USD: optionalNumber(0.25).pipe(z.number().max(5)),
    AI_MAX_TOKENS_PER_JOB: optionalNumber(50_000).pipe(
      z.number().int().max(200_000),
    ),
    AI_MAX_OUTPUT_TOKENS_PER_CALL: optionalNumber(1_500).pipe(
      z.number().int().max(8_000),
    ),
    AI_PROVIDER_TIMEOUT_MS: optionalNumber(20_000).pipe(
      z.number().int().min(1_000).max(25_000),
    ),
    AI_USER_MONTHLY_REPORT_LIMIT: optionalNumber(5).pipe(
      z.number().int().max(100),
    ),
  })
  .superRefine((value, context) => {
    if (value.AI_USER_MONTHLY_BUDGET_USD > value.AI_MONTHLY_BUDGET_USD) {
      context.addIssue({
        code: "custom",
        path: ["AI_USER_MONTHLY_BUDGET_USD"],
        message: "The per-user budget cannot exceed the global budget.",
      });
    }
    if (value.AI_MAX_COST_PER_JOB_USD > value.AI_USER_MONTHLY_BUDGET_USD) {
      context.addIssue({
        code: "custom",
        path: ["AI_MAX_COST_PER_JOB_USD"],
        message: "The per-job budget cannot exceed the per-user budget.",
      });
    }
  });

export class AiConfigurationError extends Error {
  readonly code = "AI_CONFIGURATION_ERROR";

  constructor(message = "AI research configuration is incomplete or invalid.") {
    super(message);
    this.name = "AiConfigurationError";
  }
}

export type AiResearchConfig = ReturnType<typeof getAiResearchConfig>;

export function getAiResearchConfig(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const parsed = aiEnvironmentSchema.safeParse(environment);
  if (!parsed.success) throw new AiConfigurationError();

  const model = parsed.data.OPENAI_RESEARCH_MODEL;
  return {
    provider: "openai" as const,
    apiKey: parsed.data.OPENAI_API_KEY,
    model,
    pricing: supportedModels[model],
    pricingVersion: AI_PRICING_VERSION,
    globalMonthlyBudgetUsd: parsed.data.AI_MONTHLY_BUDGET_USD,
    userMonthlyBudgetUsd: parsed.data.AI_USER_MONTHLY_BUDGET_USD,
    maxCostPerJobUsd: parsed.data.AI_MAX_COST_PER_JOB_USD,
    maxTokensPerJob: parsed.data.AI_MAX_TOKENS_PER_JOB,
    maxOutputTokensPerCall: parsed.data.AI_MAX_OUTPUT_TOKENS_PER_CALL,
    providerTimeoutMs: parsed.data.AI_PROVIDER_TIMEOUT_MS,
    userMonthlyReportLimit: parsed.data.AI_USER_MONTHLY_REPORT_LIMIT,
  };
}

export function getSupportedResearchModels() {
  return Object.entries(supportedModels).map(([model, pricing]) => ({
    model: model as SupportedResearchModel,
    ...pricing,
  }));
}

export function createQueuedAiGenerationConfig(
  config: AiResearchConfig,
): QueuedAiGenerationConfig {
  return {
    provider: config.provider,
    model: config.model,
    maxOutputTokensPerCall: config.maxOutputTokensPerCall,
    providerTimeoutMs: config.providerTimeoutMs,
    pricingVersion: AI_PRICING_VERSION,
    promptVersion: AI_PROMPT_VERSION,
    retrievalVersion: AI_RETRIEVAL_VERSION,
    outputSchemaVersion: AI_OUTPUT_SCHEMA_VERSION,
    reportVersion: AI_REPORT_VERSION,
    calculationVersion: AI_CALCULATION_VERSION,
  };
}

export function getQueuedAiResearchConfig(
  value: unknown,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const requested = queuedAiGenerationConfigSchema.safeParse(value);
  if (!requested.success) throw new AiConfigurationError();

  return getAiResearchConfig({
    ...environment,
    OPENAI_RESEARCH_MODEL: requested.data.model,
    AI_MAX_OUTPUT_TOKENS_PER_CALL: String(
      requested.data.maxOutputTokensPerCall,
    ),
    AI_PROVIDER_TIMEOUT_MS: String(requested.data.providerTimeoutMs),
  });
}
