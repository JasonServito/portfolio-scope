import type { z } from "zod";

export type ResearchModelRequest = {
  instructions: string;
  input: unknown;
  outputSchema: z.ZodType;
  outputSchemaName: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
};

export type ResearchModelTokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export type ResearchModelResult = {
  output: unknown;
  provider: string;
  model: string;
  providerRequestId: string | null;
  responseId: string | null;
  usage: ResearchModelTokenUsage;
};

export interface ResearchModelProvider {
  readonly provider: string;
  readonly model: string;

  generate(request: ResearchModelRequest): Promise<ResearchModelResult>;
}

export const ModelProviderErrorCode = {
  CONFIGURATION: "AI_MODEL_PROVIDER_CONFIGURATION",
  AUTHENTICATION: "AI_MODEL_PROVIDER_AUTHENTICATION",
  QUOTA_EXCEEDED: "AI_MODEL_PROVIDER_QUOTA_EXCEEDED",
  RATE_LIMITED: "AI_MODEL_PROVIDER_RATE_LIMITED",
  TIMEOUT: "AI_MODEL_PROVIDER_TIMEOUT",
  ABORTED: "AI_MODEL_PROVIDER_ABORTED",
  NETWORK_ERROR: "AI_MODEL_PROVIDER_NETWORK_ERROR",
  UNAVAILABLE: "AI_MODEL_PROVIDER_UNAVAILABLE",
  REQUEST_REJECTED: "AI_MODEL_PROVIDER_REQUEST_REJECTED",
  INVALID_RESPONSE: "AI_MODEL_PROVIDER_INVALID_RESPONSE",
  INCOMPLETE_RESPONSE: "AI_MODEL_PROVIDER_INCOMPLETE_RESPONSE",
  REFUSAL: "AI_MODEL_PROVIDER_REFUSAL",
  RECORDED_FIXTURES_EXHAUSTED: "AI_MODEL_RECORDED_FIXTURES_EXHAUSTED",
} as const;

export type ModelProviderErrorCode =
  (typeof ModelProviderErrorCode)[keyof typeof ModelProviderErrorCode];

const errorPolicy: Record<
  ModelProviderErrorCode,
  { message: string; retryable: boolean; chargeUncertain: boolean }
> = {
  [ModelProviderErrorCode.CONFIGURATION]: {
    message: "The research model provider is not configured correctly.",
    retryable: false,
    chargeUncertain: false,
  },
  [ModelProviderErrorCode.AUTHENTICATION]: {
    message: "The research model provider rejected its credentials.",
    retryable: false,
    chargeUncertain: false,
  },
  [ModelProviderErrorCode.QUOTA_EXCEEDED]: {
    message: "The research model provider quota is exhausted.",
    retryable: false,
    chargeUncertain: false,
  },
  [ModelProviderErrorCode.RATE_LIMITED]: {
    message: "The research model provider rate limit was reached.",
    retryable: true,
    chargeUncertain: false,
  },
  [ModelProviderErrorCode.TIMEOUT]: {
    message: "The research model request timed out.",
    retryable: true,
    chargeUncertain: true,
  },
  [ModelProviderErrorCode.ABORTED]: {
    message: "The research model request was cancelled.",
    retryable: false,
    chargeUncertain: true,
  },
  [ModelProviderErrorCode.NETWORK_ERROR]: {
    message: "The research model request could not reach the provider.",
    retryable: true,
    chargeUncertain: true,
  },
  [ModelProviderErrorCode.UNAVAILABLE]: {
    message: "The research model provider is temporarily unavailable.",
    retryable: true,
    chargeUncertain: false,
  },
  [ModelProviderErrorCode.REQUEST_REJECTED]: {
    message: "The research model provider rejected the request.",
    retryable: false,
    chargeUncertain: false,
  },
  [ModelProviderErrorCode.INVALID_RESPONSE]: {
    message: "The research model provider returned an invalid response.",
    retryable: false,
    chargeUncertain: true,
  },
  [ModelProviderErrorCode.INCOMPLETE_RESPONSE]: {
    message: "The research model provider returned an incomplete response.",
    retryable: false,
    chargeUncertain: true,
  },
  [ModelProviderErrorCode.REFUSAL]: {
    message: "The research model provider refused the request.",
    retryable: false,
    chargeUncertain: true,
  },
  [ModelProviderErrorCode.RECORDED_FIXTURES_EXHAUSTED]: {
    message: "No recorded research model fixture remains.",
    retryable: false,
    chargeUncertain: false,
  },
};

export type ModelProviderErrorOptions = {
  provider?: string;
  providerRequestId?: string | null;
  httpStatus?: number;
  retryAfterMs?: number;
  usage?: ResearchModelTokenUsage;
  retryable?: boolean;
  chargeUncertain?: boolean;
};

export class ModelProviderError extends Error {
  readonly name = "ModelProviderError";
  readonly retryable: boolean;
  readonly chargeUncertain: boolean;
  readonly provider: string | undefined;
  readonly providerRequestId: string | null | undefined;
  readonly httpStatus: number | undefined;
  readonly retryAfterMs: number | undefined;
  readonly usage: ResearchModelTokenUsage | undefined;

  constructor(
    readonly code: ModelProviderErrorCode,
    options: ModelProviderErrorOptions = {},
  ) {
    const policy = errorPolicy[code];
    super(policy.message);
    this.retryable = options.retryable ?? policy.retryable;
    this.chargeUncertain = options.chargeUncertain ?? policy.chargeUncertain;
    this.provider = options.provider;
    this.providerRequestId = options.providerRequestId;
    this.httpStatus = options.httpStatus;
    this.retryAfterMs = options.retryAfterMs;
    this.usage = options.usage;
  }
}

export const EMPTY_RESEARCH_MODEL_USAGE: ResearchModelTokenUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
};

export function normalizeResearchModelUsage(
  usage: Partial<ResearchModelTokenUsage> = {},
): ResearchModelTokenUsage {
  const inputTokens = normalizeTokenCount(usage.inputTokens);
  const cachedInputTokens = Math.min(
    inputTokens,
    normalizeTokenCount(usage.cachedInputTokens),
  );
  const outputTokens = normalizeTokenCount(usage.outputTokens);
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens: Math.min(
      outputTokens,
      normalizeTokenCount(usage.reasoningTokens),
    ),
    totalTokens: Math.max(
      inputTokens + outputTokens,
      normalizeTokenCount(usage.totalTokens),
    ),
  };
}

function normalizeTokenCount(value: number | undefined) {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0 ? value! : 0;
}
