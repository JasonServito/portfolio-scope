import { describe, expect, it, vi } from "vitest";

import { JobErrorCode } from "@/lib/jobs/errors";
import {
  createQstashDeduplicationId,
  formatQstashPublishFailureDiagnostic,
  getQstashClient,
  getPreviewQstashPublishFailureDiagnostic,
  publishJobMessage,
  verifyQstashRequest,
  type JobPublisher,
  type SignatureReceiver,
} from "@/lib/jobs/qstash";

const qstashMocks = vi.hoisted(() => ({
  client: vi.fn(function QstashClient() {
    return { publishJSON: vi.fn() };
  }),
  receiver: vi.fn(function QstashReceiver() {
    return { verify: vi.fn() };
  }),
}));

vi.mock("@upstash/qstash", () => ({
  Client: qstashMocks.client,
  Receiver: qstashMocks.receiver,
}));

describe("QStash transport", () => {
  it("passes the configured regional API origin to the QStash client", () => {
    getQstashClient({
      NODE_ENV: "test",
      QSTASH_TOKEN: "preview-token",
      QSTASH_URL: "https://qstash-us-east-1.upstash.io/",
    } as NodeJS.ProcessEnv);

    expect(qstashMocks.client).toHaveBeenCalledWith({
      token: "preview-token",
      baseUrl: "https://qstash-us-east-1.upstash.io",
    });
  });

  it("preserves the SDK default when no QStash API origin is configured", async () => {
    vi.resetModules();
    qstashMocks.client.mockClear();
    const { getQstashClient: getFreshQstashClient } =
      await import("@/lib/jobs/qstash");

    getFreshQstashClient({
      NODE_ENV: "test",
      QSTASH_TOKEN: "production-token",
    } as NodeJS.ProcessEnv);

    expect(qstashMocks.client).toHaveBeenCalledWith({
      token: "production-token",
    });
  });

  it.each([
    "not-a-url",
    "http://qstash-us-east-1.upstash.io",
    "https://token@qstash-us-east-1.upstash.io",
    "https://qstash-us-east-1.upstash.io/v2/publish",
  ])("fails closed for malformed QStash API origin %s", (baseUrl) => {
    expect(() =>
      getQstashClient({
        NODE_ENV: "test",
        QSTASH_TOKEN: "preview-token",
        QSTASH_URL: baseUrl,
      } as NodeJS.ProcessEnv),
    ).toThrow(
      expect.objectContaining({
        code: JobErrorCode.CONFIGURATION_ERROR,
        status: 503,
      }),
    );
  });

  it("publishes a redacted, deduplicated message with bounded delivery retries", async () => {
    const publisher = {
      publishJSON: vi.fn().mockResolvedValue({ messageId: "message-a" }),
    } as JobPublisher;

    await expect(
      publishJobMessage({
        jobId: "job-a",
        type: "RESEARCH_AGENT_RUN",
        maxAttempts: 3,
        timeoutMs: 30_000,
        correlationId: "correlation-a",
        publisher,
        environment: {
          NODE_ENV: "test",
          NEXT_PUBLIC_APP_URL: "https://portfolioscope.dev",
        } as NodeJS.ProcessEnv,
      }),
    ).resolves.toEqual({ messageId: "message-a" });
    expect(publisher.publishJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://portfolioscope.dev/api/internal/jobs/worker",
        body: { jobId: "job-a" },
        retries: 2,
        timeout: 30,
        deduplicationId:
          "ba724b9dde76059df442e1a584d01ebc768895734ec4573a56384d8e05721292",
        headers: { "x-correlation-id": "correlation-a" },
        redact: { body: true },
      }),
    );
  });

  it("forwards and redacts the Vercel automation bypass secret in Preview", async () => {
    const publisher = {
      publishJSON: vi.fn().mockResolvedValue({ messageId: "message-preview" }),
    } as JobPublisher;

    await publishJobMessage({
      jobId: "job-preview",
      type: "RESEARCH_AGENT_RUN",
      maxAttempts: 3,
      timeoutMs: 30_000,
      correlationId: "correlation-preview",
      publisher,
      environment: {
        NODE_ENV: "test",
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_APP_URL: "https://preview.portfolioscope.dev",
        VERCEL_AUTOMATION_BYPASS_SECRET: "preview-bypass-secret",
      } as NodeJS.ProcessEnv,
    });

    expect(publisher.publishJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          "x-correlation-id": "correlation-preview",
          "x-vercel-protection-bypass": "preview-bypass-secret",
        },
        redact: {
          body: true,
          header: ["x-vercel-protection-bypass"],
        },
      }),
    );
  });

  it.each([undefined, "   ", "invalid\nsecret"])(
    "fails closed for an invalid Preview automation bypass secret",
    async (bypassSecret) => {
      const publisher = {
        publishJSON: vi.fn().mockResolvedValue({ messageId: "unexpected" }),
      } as JobPublisher;

      await expect(
        publishJobMessage({
          jobId: "job-preview",
          type: "RESEARCH_AGENT_RUN",
          maxAttempts: 3,
          timeoutMs: 30_000,
          correlationId: "correlation-preview",
          publisher,
          environment: {
            NODE_ENV: "test",
            VERCEL_ENV: "preview",
            NEXT_PUBLIC_APP_URL: "https://preview.portfolioscope.dev",
            VERCEL_AUTOMATION_BYPASS_SECRET: bypassSecret,
          } as NodeJS.ProcessEnv,
        }),
      ).rejects.toMatchObject({
        code: JobErrorCode.CONFIGURATION_ERROR,
        status: 503,
        message: "Protected Preview job delivery is not configured.",
      });
      expect(publisher.publishJSON).not.toHaveBeenCalled();
    },
  );

  it("does not forward a configured Preview bypass secret in Production", async () => {
    const publishJSON = vi
      .fn()
      .mockResolvedValue({ messageId: "message-production" });
    const publisher = { publishJSON } satisfies JobPublisher;

    await publishJobMessage({
      jobId: "job-production",
      type: "RESEARCH_AGENT_RUN",
      maxAttempts: 3,
      timeoutMs: 30_000,
      correlationId: "correlation-production",
      publisher,
      environment: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        NEXT_PUBLIC_APP_URL: "https://portfolioscope.dev",
        VERCEL_AUTOMATION_BYPASS_SECRET: "must-not-be-forwarded",
      } as NodeJS.ProcessEnv,
    });

    expect(publisher.publishJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { "x-correlation-id": "correlation-production" },
        redact: { body: true },
      }),
    );
    expect(JSON.stringify(publishJSON.mock.calls)).not.toContain(
      "must-not-be-forwarded",
    );
  });

  it.each([
    [
      "research:cmtjd3d8d0001ju04sxjp4plb:agent:NEWS",
      "3b6f814cf21656f44411660030cbb5c41b27103179542ce37dc7a148cb8b2c51",
    ],
    [
      "maintenance:RECOVER_STALE_JOBS:2026-09-02T15:00:00.000Z",
      "b56f0c8a7c0078adebbfa2085ddbc78b80c044d754b023beee33d9d4489f5c7c",
    ],
  ])(
    "creates a stable QStash-safe deduplication ID for %s",
    (applicationKey, expectedProviderId) => {
      const first = createQstashDeduplicationId(applicationKey);
      const second = createQstashDeduplicationId(applicationKey);

      expect(first).toBe(expectedProviderId);
      expect(second).toBe(first);
      expect(first).toMatch(/^[a-f0-9]+$/);
      expect(first.length).toBeLessThanOrEqual(64);
      expect(first).not.toContain(":");
      expect(first).not.toContain(applicationKey);
    },
  );

  it("keeps distinct application keys distinct at the provider boundary", () => {
    const news = createQstashDeduplicationId(
      "research:cmtjd3d8d0001ju04sxjp4plb:agent:NEWS",
    );
    const financials = createQstashDeduplicationId(
      "research:cmtjd3d8d0001ju04sxjp4plb:agent:FINANCIALS",
    );

    expect(news).not.toBe(financials);
  });

  it("extracts only redacted Preview publish diagnostics", () => {
    const error = Object.assign(
      new Error(
        '{"error":"unauthorized Bearer leaked-bearer QSTASH_TOKEN=preview-token signing_key=current-signing-key raw=next-signing-key bypass=preview-bypass-secret"}',
      ),
      { name: "QstashError", status: 401, code: "AUTH_FAILED" },
    );
    const environment = {
      NODE_ENV: "test",
      VERCEL_ENV: "preview",
      QSTASH_URL: "https://qstash-us-east-1.upstash.io",
      QSTASH_TOKEN: "preview-token",
      QSTASH_CURRENT_SIGNING_KEY: "current-signing-key",
      QSTASH_NEXT_SIGNING_KEY: "next-signing-key",
      VERCEL_AUTOMATION_BYPASS_SECRET: "preview-bypass-secret",
    } as NodeJS.ProcessEnv;

    const diagnostic = getPreviewQstashPublishFailureDiagnostic(
      error,
      environment,
    );
    const serialized = JSON.stringify(diagnostic);

    expect(diagnostic).toEqual({
      qstashHost: "qstash-us-east-1.upstash.io",
      errorName: "QstashError",
      httpStatus: 401,
      errorCode: "AUTH_FAILED",
      providerMessage:
        "unauthorized Bearer [REDACTED] QSTASH_TOKEN=[REDACTED] signing_key=[REDACTED] raw=[REDACTED] bypass=[REDACTED]",
    });
    expect(serialized).not.toContain("preview-token");
    expect(serialized).not.toContain("current-signing-key");
    expect(serialized).not.toContain("next-signing-key");
    expect(serialized).not.toContain("preview-bypass-secret");
    expect(formatQstashPublishFailureDiagnostic(diagnostic!)).toContain(
      "status=401",
    );
  });

  it.each([
    'Invalid request body was {"private":"value"}',
    '{"error":"Invalid payload: [private-value]"}',
    '{"error":{"message":"private-value"}}',
    '[{"error":"private-value"}]',
  ])(
    "omits body-bearing provider details from Preview diagnostics",
    (message) => {
      const diagnostic = getPreviewQstashPublishFailureDiagnostic(
        Object.assign(new Error(message), {
          name: "QstashError",
          status: 400,
        }),
        {
          NODE_ENV: "test",
          VERCEL_ENV: "preview",
        } as NodeJS.ProcessEnv,
      );

      expect(diagnostic).toEqual({
        qstashHost: "qstash.upstash.io",
        errorName: "QstashError",
        httpStatus: 400,
      });
      expect(JSON.stringify(diagnostic)).not.toContain("private-value");
    },
  );

  it("captures a nested network code only in Preview", () => {
    const cause = Object.assign(new Error("DNS lookup failed"), {
      code: "ENOTFOUND",
    });
    const error = new TypeError("fetch failed", { cause });
    const previewEnvironment = {
      NODE_ENV: "test",
      VERCEL_ENV: "preview",
    } as NodeJS.ProcessEnv;

    expect(
      getPreviewQstashPublishFailureDiagnostic(error, previewEnvironment),
    ).toEqual({
      qstashHost: "qstash.upstash.io",
      errorName: "TypeError",
      errorCode: "ENOTFOUND",
      providerMessage: "fetch failed",
    });
    expect(
      getPreviewQstashPublishFailureDiagnostic(error, {
        NODE_ENV: "test",
        VERCEL_ENV: "production",
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it("rejects unsigned requests before parsing the body", async () => {
    const request = new Request(
      "https://portfolioscope.dev/api/internal/jobs/worker",
      { method: "POST", body: "{invalid" },
    );

    await expect(verifyQstashRequest(request)).rejects.toMatchObject({
      code: JobErrorCode.WORKER_SIGNATURE_MISSING,
      status: 401,
    });
  });

  it("verifies the exact raw body and URL before accepting a strict payload", async () => {
    const receiver = {
      verify: vi.fn().mockResolvedValue(true),
    } as SignatureReceiver;
    const body = JSON.stringify({ jobId: "job-a" });
    const request = new Request(
      "https://portfolioscope.dev/api/internal/jobs/worker",
      {
        method: "POST",
        headers: { "upstash-signature": "signed" },
        body,
      },
    );

    await expect(verifyQstashRequest(request, { receiver })).resolves.toEqual({
      jobId: "job-a",
    });
    expect(receiver.verify).toHaveBeenCalledWith({
      signature: "signed",
      body,
      url: request.url,
      clockTolerance: 5,
    });
  });

  it("rejects an invalid signature without exposing verifier details", async () => {
    const receiver = {
      verify: vi.fn().mockRejectedValue(new Error("key details")),
    } as SignatureReceiver;
    const request = new Request(
      "https://portfolioscope.dev/api/internal/jobs/worker",
      {
        method: "POST",
        headers: { "upstash-signature": "bad" },
        body: JSON.stringify({ jobId: "job-a" }),
      },
    );

    await expect(
      verifyQstashRequest(request, { receiver }),
    ).rejects.toMatchObject({
      code: JobErrorCode.WORKER_AUTH_FAILED,
      status: 401,
      message: "The worker signature is invalid.",
    });
  });
});
