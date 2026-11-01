import { z } from "zod";

import type { AiResearchConfig } from "@/lib/research/ai/config";
import {
  ModelProviderError,
  ModelProviderErrorCode,
  type ResearchModelProvider,
  type ResearchModelRequest,
  type ResearchModelResult,
  type ResearchModelTokenUsage,
} from "@/lib/research/ai/providers/types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const ABSOLUTE_MAX_OUTPUT_TOKENS = 8_000;
const ABSOLUTE_MAX_TIMEOUT_MS = 25_000;
const MAX_RESPONSE_CHARACTERS = 2_000_000;

const quotaErrorCodes = new Set([
  "billing_hard_limit_reached",
  "credit_balance_exhausted",
  "insufficient_quota",
  "organization_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "project_spend_limit_exceeded",
]);

const authenticationErrorCodes = new Set([
  "invalid_api_key",
  "invalid_authentication",
  "organization_not_found",
  "project_not_found",
]);

type FetchImplementation = typeof fetch;

export type OpenAIResponsesResearchModelProviderOptions = {
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
  fetch?: FetchImplementation;
};

export class OpenAIResponsesResearchModelProvider implements ResearchModelProvider {
  readonly provider = "openai";
  readonly model: string;
  private readonly apiKey: string;
  private readonly maxOutputTokens: number;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FetchImplementation;

  constructor(options: OpenAIResponsesResearchModelProviderOptions) {
    if (
      !options.apiKey.trim() ||
      !options.model.trim() ||
      !isBoundedInteger(
        options.maxOutputTokens,
        1,
        ABSOLUTE_MAX_OUTPUT_TOKENS,
      ) ||
      !isBoundedInteger(options.timeoutMs, 1, ABSOLUTE_MAX_TIMEOUT_MS)
    ) {
      throw new ModelProviderError(ModelProviderErrorCode.CONFIGURATION, {
        provider: this.provider,
      });
    }

    this.apiKey = options.apiKey.trim();
    this.model = options.model.trim();
    this.maxOutputTokens = options.maxOutputTokens;
    this.timeoutMs = options.timeoutMs;
    this.fetchImplementation = options.fetch ?? fetch;
  }

  static fromConfig(
    config: AiResearchConfig,
    options: { fetch?: FetchImplementation } = {},
  ) {
    return new OpenAIResponsesResearchModelProvider({
      apiKey: config.apiKey,
      model: config.model,
      maxOutputTokens: config.maxOutputTokensPerCall,
      timeoutMs: config.providerTimeoutMs,
      fetch: options.fetch,
    });
  }

  async generate(request: ResearchModelRequest): Promise<ResearchModelResult> {
    const body = this.createRequestBody(request);
    const abort = createAbortContext(request.signal, this.timeoutMs);
    let responseRequestId: string | null = null;

    try {
      const response = await this.fetchImplementation(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      responseRequestId = providerRequestId(response.headers);

      return await this.parseResponse(response);
    } catch (error) {
      if (error instanceof ModelProviderError) throw error;

      if (abort.didTimeout()) {
        throw new ModelProviderError(ModelProviderErrorCode.TIMEOUT, {
          provider: this.provider,
          providerRequestId: responseRequestId,
        });
      }
      if (request.signal?.aborted) {
        throw new ModelProviderError(ModelProviderErrorCode.ABORTED, {
          provider: this.provider,
          providerRequestId: responseRequestId,
        });
      }
      throw new ModelProviderError(ModelProviderErrorCode.NETWORK_ERROR, {
        provider: this.provider,
        providerRequestId: responseRequestId,
      });
    } finally {
      abort.cleanup();
    }
  }

  private createRequestBody(request: ResearchModelRequest) {
    if (
      !request.instructions.trim() ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(request.outputSchemaName)
    ) {
      throw new ModelProviderError(ModelProviderErrorCode.CONFIGURATION, {
        provider: this.provider,
      });
    }
    if (
      request.maxOutputTokens !== undefined &&
      !isBoundedInteger(request.maxOutputTokens, 1, ABSOLUTE_MAX_OUTPUT_TOKENS)
    ) {
      throw new ModelProviderError(ModelProviderErrorCode.CONFIGURATION, {
        provider: this.provider,
      });
    }

    let serializedInput: string | undefined;
    let outputJsonSchema: Record<string, unknown>;
    try {
      serializedInput =
        typeof request.input === "string"
          ? request.input
          : JSON.stringify(request.input);
      outputJsonSchema = z.toJSONSchema(request.outputSchema) as Record<
        string,
        unknown
      >;
    } catch {
      throw new ModelProviderError(ModelProviderErrorCode.CONFIGURATION, {
        provider: this.provider,
      });
    }
    if (serializedInput === undefined) {
      throw new ModelProviderError(ModelProviderErrorCode.CONFIGURATION, {
        provider: this.provider,
      });
    }

    return {
      model: this.model,
      store: false,
      instructions: request.instructions,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: serializedInput }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: request.outputSchemaName,
          schema: outputJsonSchema,
          strict: true,
        },
      },
      max_output_tokens: Math.min(
        request.maxOutputTokens ?? this.maxOutputTokens,
        this.maxOutputTokens,
      ),
    };
  }

  private async parseResponse(
    response: Response,
  ): Promise<ResearchModelResult> {
    const headerRequestId = providerRequestId(response.headers);
    const responseText = await boundedResponseText(
      response,
      MAX_RESPONSE_CHARACTERS,
    );
    if (responseText === null) {
      throw invalidResponseError(this.provider, headerRequestId);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      if (!response.ok) {
        throw mapHttpError({
          status: response.status,
          provider: this.provider,
          providerRequestId: headerRequestId,
          retryAfterMs: retryAfterMilliseconds(response.headers),
        });
      }
      throw invalidResponseError(this.provider, headerRequestId);
    }

    const errorCode = rawErrorCode(payload);
    const requestId = headerRequestId ?? rawString(payload, "id");
    if (!response.ok) {
      throw mapHttpError({
        status: response.status,
        errorCode,
        provider: this.provider,
        providerRequestId: requestId,
        retryAfterMs: retryAfterMilliseconds(response.headers),
      });
    }
    if (!isRecord(payload)) {
      throw invalidResponseError(this.provider, requestId);
    }
    if (payload.error) {
      throw mapHttpError({
        status: response.status,
        errorCode,
        provider: this.provider,
        providerRequestId: requestId,
      });
    }

    const usage = parseUsage(payload.usage);
    const errorOptions = {
      provider: this.provider,
      providerRequestId: requestId,
      usage,
      chargeUncertain: usage === undefined,
    };
    const responseModel = rawString(payload, "model");
    if (responseModel !== this.model) {
      throw new ModelProviderError(ModelProviderErrorCode.INVALID_RESPONSE, {
        ...errorOptions,
        chargeUncertain: true,
      });
    }
    const responseStatus = rawString(payload, "status");
    if (responseStatus === "incomplete") {
      throw new ModelProviderError(
        ModelProviderErrorCode.INCOMPLETE_RESPONSE,
        errorOptions,
      );
    }
    if (responseStatus === "failed" || responseStatus === "cancelled") {
      throw new ModelProviderError(
        ModelProviderErrorCode.REQUEST_REJECTED,
        errorOptions,
      );
    }
    if (responseStatus !== "completed") {
      throw new ModelProviderError(
        responseStatus === "queued" || responseStatus === "in_progress"
          ? ModelProviderErrorCode.INCOMPLETE_RESPONSE
          : ModelProviderErrorCode.INVALID_RESPONSE,
        {
          ...errorOptions,
          // A non-terminal or unknown response may continue accruing usage.
          chargeUncertain: true,
        },
      );
    }

    const content = outputContent(payload);
    if (content.some(isRefusalContent)) {
      throw new ModelProviderError(
        ModelProviderErrorCode.REFUSAL,
        errorOptions,
      );
    }
    const outputText = content
      .filter(isOutputTextContent)
      .map((item) => item.text)
      .join("");
    if (!outputText || !usage) {
      throw invalidResponseError(this.provider, requestId, usage);
    }

    let output: unknown;
    try {
      output = JSON.parse(outputText);
    } catch {
      throw invalidResponseError(this.provider, requestId, usage);
    }

    return {
      output,
      provider: this.provider,
      model: responseModel,
      providerRequestId: requestId,
      responseId: rawString(payload, "id"),
      usage,
    };
  }
}

/** The M18 external provider currently uses OpenAI's Responses API. */
export const ExternalResearchModelProvider =
  OpenAIResponsesResearchModelProvider;

function createAbortContext(
  parent: AbortSignal | undefined,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(parent?.reason);
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener("abort", abortFromParent, { once: true });

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Timed out", "TimeoutError"));
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}

function outputContent(payload: Record<string, unknown>) {
  const content: unknown[] = [];
  if (typeof payload.output_text === "string") {
    content.push({ type: "output_text", text: payload.output_text });
  }
  if (!Array.isArray(payload.output)) return content;

  for (const output of payload.output) {
    if (!isRecord(output) || !Array.isArray(output.content)) continue;
    content.push(...output.content);
  }
  return content;
}

function isOutputTextContent(
  value: unknown,
): value is { type: "output_text"; text: string } {
  return (
    isRecord(value) &&
    value.type === "output_text" &&
    typeof value.text === "string"
  );
}

function isRefusalContent(
  value: unknown,
): value is { type: "refusal"; refusal: string } {
  return (
    isRecord(value) &&
    value.type === "refusal" &&
    typeof value.refusal === "string"
  );
}

function parseUsage(value: unknown): ResearchModelTokenUsage | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens = nonnegativeInteger(value.input_tokens);
  const outputTokens = nonnegativeInteger(value.output_tokens);
  const totalTokens = nonnegativeInteger(value.total_tokens);
  if (
    inputTokens === undefined ||
    outputTokens === undefined ||
    totalTokens === undefined
  ) {
    return undefined;
  }

  const inputDetails = isRecord(value.input_tokens_details)
    ? value.input_tokens_details
    : undefined;
  const outputDetails = isRecord(value.output_tokens_details)
    ? value.output_tokens_details
    : undefined;
  const cachedInputTokens = nonnegativeInteger(inputDetails?.cached_tokens);
  const reasoningTokens = nonnegativeInteger(outputDetails?.reasoning_tokens);
  if (cachedInputTokens === undefined || reasoningTokens === undefined) {
    return undefined;
  }
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
  };
}

function invalidResponseError(
  provider: string,
  providerRequestId: string | null,
  usage?: ResearchModelTokenUsage,
) {
  return new ModelProviderError(ModelProviderErrorCode.INVALID_RESPONSE, {
    provider,
    providerRequestId,
    usage,
    chargeUncertain: usage === undefined,
  });
}

function rawErrorCode(value: unknown) {
  if (!isRecord(value) || !isRecord(value.error)) return undefined;
  return typeof value.error.code === "string" ? value.error.code : undefined;
}

function mapHttpError(input: {
  status: number;
  errorCode?: string;
  provider: string;
  providerRequestId: string | null;
  retryAfterMs?: number;
}) {
  const normalizedCode = input.errorCode?.toLowerCase();
  const common = {
    provider: input.provider,
    providerRequestId: input.providerRequestId,
    httpStatus: input.status,
  };
  if (normalizedCode && quotaErrorCodes.has(normalizedCode)) {
    return new ModelProviderError(
      ModelProviderErrorCode.QUOTA_EXCEEDED,
      common,
    );
  }
  if (
    input.status === 401 ||
    input.status === 403 ||
    (normalizedCode && authenticationErrorCodes.has(normalizedCode))
  ) {
    return new ModelProviderError(
      ModelProviderErrorCode.AUTHENTICATION,
      common,
    );
  }
  if (input.status === 429 || normalizedCode === "rate_limit_exceeded") {
    return new ModelProviderError(ModelProviderErrorCode.RATE_LIMITED, {
      ...common,
      retryAfterMs: input.retryAfterMs,
    });
  }
  if (input.status === 408 || input.status === 504) {
    return new ModelProviderError(ModelProviderErrorCode.TIMEOUT, common);
  }
  if (input.status === 409 || input.status >= 500) {
    return new ModelProviderError(ModelProviderErrorCode.UNAVAILABLE, common);
  }
  if ([400, 404, 422].includes(input.status)) {
    return new ModelProviderError(ModelProviderErrorCode.CONFIGURATION, common);
  }
  return new ModelProviderError(
    ModelProviderErrorCode.REQUEST_REJECTED,
    common,
  );
}

function providerRequestId(headers: Headers) {
  return (
    headers.get("x-request-id") ?? headers.get("openai-request-id") ?? null
  );
}

function retryAfterMilliseconds(headers: Headers) {
  const retryAfter = headers.get("retry-after");
  if (!retryAfter) return undefined;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) {
    return Math.min(60_000, Math.max(0, Math.round(seconds * 1_000)));
  }
  const date = Date.parse(retryAfter);
  if (Number.isNaN(date)) return undefined;
  return Math.min(60_000, Math.max(0, date - Date.now()));
}

function nonnegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : undefined;
}

function rawString(value: unknown, key: string) {
  if (!isRecord(value)) return null;
  return typeof value[key] === "string" ? value[key] : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedInteger(value: number, minimum: number, maximum: number) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

async function boundedResponseText(response: Response, maximumBytes: number) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maximumBytes) {
      return null;
    }
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
