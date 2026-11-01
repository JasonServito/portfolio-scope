import { z } from "zod";

import type { SpecialistAgentName } from "@/lib/research/types";

export const AI_PRICING_VERSION = "openai-pricing-2026-08-24";
export const AI_PROMPT_VERSION = "m33-research-v6";
export const AI_RETRIEVAL_VERSION = "m32-structured-lexical-v3";
export const AI_OUTPUT_SCHEMA_VERSION = "m30-claims-v2";
export const AI_REPORT_VERSION = "m33-report-v4";
export const AI_SPECIALIST_AGENT_VERSION = "m30-specialist-v2";
export const AI_SYNTHESIS_AGENT_VERSION = "m30-synthesis-v2";
export const AI_CALCULATION_VERSION = "portfolio-v1";
export const AI_HARD_MAX_COST_PER_JOB_USD = 0.25;
export const AI_HARD_MAX_TOKENS_PER_JOB = 50_000;
export const AI_DEFAULT_MAX_OUTPUT_TOKENS_PER_CALL = 2_000;
export const AI_VERIFIER_MAX_OUTPUT_TOKENS = 1_200;

// Context budgets are characters of rendered evidence per provider call. They
// are sized so that three concurrent specialist reservations (which count
// every serialized input byte as a token) plus synthesis stay inside the
// 50,000-token job cap; see docs/ai-research.md for the envelope. M30 spends
// part of the specialist envelope on research questions and the claim
// contract, so the evidence context was lowered from 8,000 characters; the
// owned structured evidence still fits in full.
export const AI_SPECIALIST_CONTEXT_CHAR_BUDGET = 7_200;
// M31 rebalances the three first-stage model specialists so each can receive
// at least one filing passage after its owned structured evidence:
// Financials' owned tables (about 7,000 characters on the AAPL fixture)
// plus one MD&A passage need 8,400, Risk's owned items plus one Risk
// Factors passage need 5,900, and Competitors owns little structured
// evidence. M32 makes News a fourth model call that runs only after the
// three settle; its budget holds the coverage statement, the four newest
// current-report items, and one press-release passage. The settled usage
// of all four calls plus one repair, a synthesis repair, and verification
// must stay inside the unchanged 50,000-token cap under the model in
// prompt-budget.test.ts, with every call reserving the configured per-call
// output maximum.
export const AI_SPECIALIST_CONTEXT_CHAR_BUDGETS: Record<
  SpecialistAgentName,
  number
> = {
  FINANCIALS: 8_500,
  COMPETITORS: 4_600,
  RISK: 6_000,
  NEWS: 3_200,
  POLITICAL_ACTIVITY: AI_SPECIALIST_CONTEXT_CHAR_BUDGET,
};
export const AI_SPECIALIST_MAX_EVIDENCE_ITEMS = 16;
// Synthesis runs after the specialists settle, so its budget can carry the
// filing passages the specialists cited: its owned items (about 6,700
// characters on the fixture), the dated current-report items the News
// specialist cited, and one cited passage; the envelope test bounds it.
export const AI_SYNTHESIS_CONTEXT_CHAR_BUDGET = 8_600;
export const AI_SYNTHESIS_MAX_EVIDENCE_ITEMS = 16;
// Serialized specialist outputs forwarded to synthesis. All validated claims
// are forwarded unless the payload would push the job past its token cap; the
// prompt then states how many low-confidence claims were left out.
export const AI_SYNTHESIS_SPECIALIST_CHAR_BUDGET = 12_000;

const LEGACY_AI_PRICING_VERSION = "openai-pricing-2026-08-11";
const DEFAULT_RESEARCH_MODEL = "gpt-5.4-mini-2026-03-17";

const activeSupportedModels = {
  "gpt-5.4-mini-2026-03-17": {
    inputUsdPerMillion: 0.75,
    cachedInputUsdPerMillion: 0.075,
    outputUsdPerMillion: 4.5,
  },
} as const;

// Persisted jobs keep the immutable model/rate tuple they reserved when queued.
// These entries are compatibility data, not models accepted from current env.
const legacySupportedModels = {
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

type ActiveResearchModel = keyof typeof activeSupportedModels;
type LegacyResearchModel = keyof typeof legacySupportedModels;
export type SupportedResearchModel = ActiveResearchModel | LegacyResearchModel;

const activeModelNames = [DEFAULT_RESEARCH_MODEL] satisfies [
  ActiveResearchModel,
];
const legacyModelNames = Object.keys(legacySupportedModels) as [
  LegacyResearchModel,
  ...LegacyResearchModel[],
];

const queuedAiGenerationConfigFields = {
  provider: z.literal("openai"),
  maxOutputTokensPerCall: z.number().int().positive().max(8_000),
  providerTimeoutMs: z.number().int().min(1_000).max(25_000),
  promptVersion: z.literal(AI_PROMPT_VERSION),
  retrievalVersion: z.literal(AI_RETRIEVAL_VERSION),
  outputSchemaVersion: z.literal(AI_OUTPUT_SCHEMA_VERSION),
  reportVersion: z.literal(AI_REPORT_VERSION),
  calculationVersion: z.literal(AI_CALCULATION_VERSION),
};

export const queuedAiGenerationConfigSchema = z.discriminatedUnion(
  "pricingVersion",
  [
    z
      .object({
        ...queuedAiGenerationConfigFields,
        model: z.enum(activeModelNames),
        pricingVersion: z.literal(AI_PRICING_VERSION),
      })
      .strict(),
    z
      .object({
        ...queuedAiGenerationConfigFields,
        model: z.enum(legacyModelNames),
        pricingVersion: z.literal(LEGACY_AI_PRICING_VERSION),
      })
      .strict(),
  ],
);

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
      .enum(activeModelNames)
      .default(DEFAULT_RESEARCH_MODEL),
    AI_MONTHLY_BUDGET_USD: optionalNumber(5).pipe(z.number().max(5)),
    AI_USER_MONTHLY_BUDGET_USD: optionalNumber(1).pipe(z.number().max(1)),
    AI_MAX_COST_PER_JOB_USD: optionalNumber(AI_HARD_MAX_COST_PER_JOB_USD).pipe(
      z.number().max(AI_HARD_MAX_COST_PER_JOB_USD),
    ),
    AI_MAX_TOKENS_PER_JOB: optionalNumber(AI_HARD_MAX_TOKENS_PER_JOB).pipe(
      z.number().int().max(AI_HARD_MAX_TOKENS_PER_JOB),
    ),
    AI_MAX_OUTPUT_TOKENS_PER_CALL: optionalNumber(
      AI_DEFAULT_MAX_OUTPUT_TOKENS_PER_CALL,
    ).pipe(
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
    pricing: activeSupportedModels[model],
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

type CurrentAiResearchConfig = ReturnType<typeof getAiResearchConfig>;

export type AiResearchConfig = Omit<
  CurrentAiResearchConfig,
  "model" | "pricing" | "pricingVersion"
> & {
  model: SupportedResearchModel;
  pricing:
    | (typeof activeSupportedModels)[ActiveResearchModel]
    | (typeof legacySupportedModels)[LegacyResearchModel];
  pricingVersion: string;
};

export function getSupportedResearchModels() {
  return Object.entries(activeSupportedModels).map(([model, pricing]) => ({
    model: model as ActiveResearchModel,
    ...pricing,
  }));
}

export function createQueuedAiGenerationConfig(
  config: CurrentAiResearchConfig,
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

  const current = getAiResearchConfig({
    ...environment,
    OPENAI_RESEARCH_MODEL: DEFAULT_RESEARCH_MODEL,
    AI_MAX_OUTPUT_TOKENS_PER_CALL: String(
      requested.data.maxOutputTokensPerCall,
    ),
    AI_PROVIDER_TIMEOUT_MS: String(requested.data.providerTimeoutMs),
  });
  const pricing =
    requested.data.pricingVersion === AI_PRICING_VERSION
      ? activeSupportedModels[requested.data.model]
      : legacySupportedModels[requested.data.model];

  return {
    ...current,
    model: requested.data.model,
    pricing,
    pricingVersion: requested.data.pricingVersion,
  } satisfies AiResearchConfig;
}
