import { describe, expect, it, vi } from "vitest";

import { JobErrorCode } from "@/lib/jobs/errors";
import {
  publishJobMessage,
  verifyQstashRequest,
  type JobPublisher,
  type SignatureReceiver,
} from "@/lib/jobs/qstash";

describe("QStash transport", () => {
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
        deduplicationId: "job-a",
        redact: { body: true },
      }),
    );
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

    await expect(
      verifyQstashRequest(request, { receiver }),
    ).resolves.toEqual({ jobId: "job-a" });
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
