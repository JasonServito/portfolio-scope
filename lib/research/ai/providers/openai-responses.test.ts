import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  ModelProviderError,
  ModelProviderErrorCode,
  OpenAIResponsesResearchModelProvider,
  type ResearchModelRequest,
} from "@/lib/research/ai/providers";

const outputSchema = z.object({ summary: z.string() }).strict();

function request(
  overrides: Partial<ResearchModelRequest> = {},
): ResearchModelRequest {
  return {
    instructions: "Return grounded research JSON.",
    input: { ticker: "AAPL", evidenceIds: ["ev_123"] },
    outputSchema,
    outputSchemaName: "specialist_research",
    ...overrides,
  };
}

function successfulResponse(
  output: unknown = { summary: "Grounded summary" },
  options: { requestId?: string; responseId?: string } = {},
) {
  return new Response(
    JSON.stringify({
      id: options.responseId ?? "resp_body_123",
      object: "response",
      status: "completed",
      model: "gpt-5-mini-2025-08-07",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(output) }],
        },
      ],
      usage: {
        input_tokens: 120,
        input_tokens_details: { cached_tokens: 20 },
        output_tokens: 35,
        output_tokens_details: { reasoning_tokens: 5 },
        total_tokens: 155,
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "x-request-id": options.requestId ?? "req_header_123",
      },
    },
  );
}

function createProvider(
  fetchImplementation: typeof fetch,
  options: { timeoutMs?: number; maxOutputTokens?: number } = {},
) {
  return new OpenAIResponsesResearchModelProvider({
    apiKey: "test-api-key",
    model: "gpt-5-mini-2025-08-07",
    maxOutputTokens: options.maxOutputTokens ?? 1_500,
    timeoutMs: options.timeoutMs ?? 1_000,
    fetch: fetchImplementation,
  });
}

async function capturedError(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ModelProviderError);
    return error as ModelProviderError;
  }
  throw new Error("Expected the provider request to fail.");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("OpenAI Responses research model provider", () => {
  it("sends a non-stored bounded request with a strict Zod JSON schema", async () => {
    const fetchImplementation = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        void input;
        void init;
        return successfulResponse();
      },
    );
    const provider = createProvider(
      fetchImplementation as unknown as typeof fetch,
      { maxOutputTokens: 1_200 },
    );

    await provider.generate(request({ maxOutputTokens: 7_000 }));

    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer test-api-key",
        "Content-Type": "application/json",
      },
      signal: expect.any(AbortSignal),
    });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "gpt-5-mini-2025-08-07",
      store: false,
      instructions: "Return grounded research JSON.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                ticker: "AAPL",
                evidenceIds: ["ev_123"],
              }),
            },
          ],
        },
      ],
      max_output_tokens: 1_200,
      text: {
        format: {
          type: "json_schema",
          name: "specialist_research",
          strict: true,
          schema: {
            type: "object",
            properties: { summary: { type: "string" } },
            required: ["summary"],
            additionalProperties: false,
          },
        },
      },
    });
    expect(body.text.format.schema.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
  });

  it("passes an already-shaped string input without JSON double encoding", async () => {
    const fetchImplementation = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        void input;
        void init;
        return successfulResponse();
      },
    );
    const provider = createProvider(
      fetchImplementation as unknown as typeof fetch,
    );
    const shapedInput = '{"ticker":"AAPL","evidence":[]}';

    await provider.generate(request({ input: shapedInput }));

    const init = fetchImplementation.mock.calls[0]![1];
    const body = JSON.parse(String(init?.body));
    expect(body.input[0].content[0].text).toBe(shapedInput);
  });

  it("parses structured output, token details, response id, and request id", async () => {
    const fetchImplementation = vi.fn(async () =>
      successfulResponse(
        { summary: "Revenue rose with cited evidence." },
        { requestId: "req_abc", responseId: "resp_xyz" },
      ),
    ) as unknown as typeof fetch;
    const provider = createProvider(fetchImplementation);

    await expect(provider.generate(request())).resolves.toEqual({
      output: { summary: "Revenue rose with cited evidence." },
      provider: "openai",
      model: "gpt-5-mini-2025-08-07",
      providerRequestId: "req_abc",
      responseId: "resp_xyz",
      usage: {
        inputTokens: 120,
        cachedInputTokens: 20,
        outputTokens: 35,
        reasoningTokens: 5,
        totalTokens: 155,
      },
    });
  });

  it("uses the response id as the provider request id when no header is present", async () => {
    const raw = successfulResponse();
    const withoutRequestHeader = new Response(await raw.text(), {
      headers: { "Content-Type": "application/json" },
    });
    const provider = createProvider(
      vi.fn(async () => withoutRequestHeader) as unknown as typeof fetch,
    );

    const result = await provider.generate(request());

    expect(result.providerRequestId).toBe("resp_body_123");
    expect(result.responseId).toBe("resp_body_123");
  });

  it("classifies a provider refusal without exposing refusal or prompt text", async () => {
    const response = new Response(
      JSON.stringify({
        id: "resp_refusal",
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "refusal",
                refusal: "sensitive provider refusal detail",
              },
            ],
          },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          total_tokens: 12,
        },
      }),
      { headers: { "x-request-id": "req_refusal" } },
    );
    const provider = createProvider(
      vi.fn(async () => response) as unknown as typeof fetch,
    );

    const error = await capturedError(
      provider.generate(
        request({ instructions: "private portfolio prompt content" }),
      ),
    );

    expect(error).toMatchObject({
      code: ModelProviderErrorCode.REFUSAL,
      retryable: false,
      chargeUncertain: false,
      providerRequestId: "req_refusal",
      usage: {
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
      },
    });
    expect(error.message).not.toContain("sensitive provider refusal detail");
    expect(error.message).not.toContain("private portfolio prompt content");
  });

  it.each([
    {
      name: "authentication failure",
      status: 401,
      providerCode: "invalid_api_key",
      expectedCode: ModelProviderErrorCode.AUTHENTICATION,
      retryable: false,
      chargeUncertain: false,
    },
    {
      name: "exhausted quota",
      status: 429,
      providerCode: "insufficient_quota",
      expectedCode: ModelProviderErrorCode.QUOTA_EXCEEDED,
      retryable: false,
      chargeUncertain: false,
    },
    {
      name: "rate limit",
      status: 429,
      providerCode: "rate_limit_exceeded",
      expectedCode: ModelProviderErrorCode.RATE_LIMITED,
      retryable: true,
      chargeUncertain: false,
    },
    {
      name: "invalid model configuration",
      status: 400,
      providerCode: "model_not_found",
      expectedCode: ModelProviderErrorCode.CONFIGURATION,
      retryable: false,
      chargeUncertain: false,
    },
    {
      name: "temporary provider failure",
      status: 503,
      providerCode: "server_error",
      expectedCode: ModelProviderErrorCode.UNAVAILABLE,
      retryable: true,
      chargeUncertain: false,
    },
  ])(
    "maps $name to a sanitized typed error",
    async ({
      status,
      providerCode,
      expectedCode,
      retryable,
      chargeUncertain,
    }) => {
      const fetchImplementation = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: providerCode,
                message: "sensitive raw provider response",
              },
            }),
            {
              status,
              headers: {
                "Retry-After": "2",
                "x-request-id": "req_error",
              },
            },
          ),
      ) as unknown as typeof fetch;
      const provider = createProvider(fetchImplementation);

      const error = await capturedError(
        provider.generate(
          request({ instructions: "sensitive private prompt" }),
        ),
      );

      expect(error).toMatchObject({
        code: expectedCode,
        retryable,
        chargeUncertain,
        httpStatus: status,
        providerRequestId: "req_error",
      });
      if (expectedCode === ModelProviderErrorCode.RATE_LIMITED) {
        expect(error.retryAfterMs).toBe(2_000);
      }
      expect(error.message).not.toContain("sensitive raw provider response");
      expect(error.message).not.toContain("sensitive private prompt");
    },
  );

  it("classifies network failures as retryable with uncertain usage", async () => {
    const provider = createProvider(
      vi.fn(async () => {
        throw new TypeError("network failure with sensitive diagnostics");
      }) as unknown as typeof fetch,
    );

    const error = await capturedError(provider.generate(request()));

    expect(error).toMatchObject({
      code: ModelProviderErrorCode.NETWORK_ERROR,
      retryable: true,
      chargeUncertain: true,
    });
    expect(error.message).not.toContain("sensitive diagnostics");
  });

  it("combines a parent AbortSignal with the provider request", async () => {
    const fetchImplementation = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    ) as unknown as typeof fetch;
    const provider = createProvider(fetchImplementation);
    const controller = new AbortController();
    const errorPromise = capturedError(
      provider.generate(request({ signal: controller.signal })),
    );

    controller.abort();
    const error = await errorPromise;

    expect(error).toMatchObject({
      code: ModelProviderErrorCode.ABORTED,
      retryable: false,
      chargeUncertain: true,
    });
  });

  it("aborts at the configured timeout and preserves the usage reservation", async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    ) as unknown as typeof fetch;
    const provider = createProvider(fetchImplementation, { timeoutMs: 5 });
    const errorPromise = capturedError(provider.generate(request()));

    await vi.advanceTimersByTimeAsync(5);
    const error = await errorPromise;

    expect(error).toMatchObject({
      code: ModelProviderErrorCode.TIMEOUT,
      retryable: true,
      chargeUncertain: true,
    });
  });

  it("rejects malformed output text without validating it against the caller schema", async () => {
    const response = successfulResponse();
    const payload = JSON.parse(await response.text());
    payload.output[0].content[0].text = "not-json private response text";
    const provider = createProvider(
      vi.fn(
        async () =>
          new Response(JSON.stringify(payload), {
            headers: { "x-request-id": "req_invalid_json" },
          }),
      ) as unknown as typeof fetch,
    );

    const error = await capturedError(provider.generate(request()));

    expect(error).toMatchObject({
      code: ModelProviderErrorCode.INVALID_RESPONSE,
      chargeUncertain: false,
      providerRequestId: "req_invalid_json",
      usage: { inputTokens: 120, outputTokens: 35 },
    });
    expect(error.message).not.toContain("private response text");
  });

  it("returns schema-invalid structured JSON as unknown for caller validation", async () => {
    const provider = createProvider(
      vi.fn(async () =>
        successfulResponse({ unexpected: true }),
      ) as unknown as typeof fetch,
    );

    const result = await provider.generate(request());

    expect(result.output).toEqual({ unexpected: true });
    expect(outputSchema.safeParse(result.output).success).toBe(false);
  });

  it("rejects a declared response body above the bounded byte limit", async () => {
    const provider = createProvider(
      vi.fn(
        async () =>
          new Response("{}", {
            headers: {
              "content-length": "2000001",
              "x-request-id": "req_too_large",
            },
          }),
      ) as unknown as typeof fetch,
    );

    await expect(provider.generate(request())).rejects.toMatchObject({
      code: ModelProviderErrorCode.INVALID_RESPONSE,
      providerRequestId: "req_too_large",
    });
  });
});
