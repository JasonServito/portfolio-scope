import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureM27QstashReplayRequest: vi.fn(),
  verifyQstashRequest: vi.fn(),
  executeBackgroundJob: vi.fn(),
  prepareM27QstashReplayCapture: vi.fn(),
}));

vi.mock("@/lib/jobs/m27-qstash-replay-proof", () => ({
  captureM27QstashReplayRequest: mocks.captureM27QstashReplayRequest,
  prepareM27QstashReplayCapture: mocks.prepareM27QstashReplayCapture,
}));
vi.mock("@/lib/jobs/qstash", () => ({
  verifyQstashRequest: mocks.verifyQstashRequest,
}));
vi.mock("@/lib/jobs/service", () => ({
  executeBackgroundJob: mocks.executeBackgroundJob,
}));

import { JobErrorCode, JobRequestError } from "@/lib/jobs/errors";
import { POST } from "./route";

describe("signed background worker route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.captureM27QstashReplayRequest.mockResolvedValue(undefined);
    mocks.prepareM27QstashReplayCapture.mockReturnValue(null);
    mocks.verifyQstashRequest.mockResolvedValue({ jobId: "job-a" });
    mocks.executeBackgroundJob.mockResolvedValue({
      jobId: "job-a",
      status: "COMPLETED",
      duplicate: false,
      retrying: false,
    });
  });

  it("verifies QStash before claiming work", async () => {
    const request = new Request(
      "https://portfolioscope.dev/api/internal/jobs/worker",
      { method: "POST", body: JSON.stringify({ jobId: "job-a" }) },
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.verifyQstashRequest).toHaveBeenCalledWith(request);
    expect(mocks.executeBackgroundJob).toHaveBeenCalledWith("job-a");
  });

  it("rejects unsigned delivery before job access", async () => {
    mocks.verifyQstashRequest.mockRejectedValue(
      new JobRequestError(
        JobErrorCode.WORKER_SIGNATURE_MISSING,
        401,
        "A valid worker signature is required.",
      ),
    );

    const response = await POST(
      new Request("https://portfolioscope.dev/api/internal/jobs/worker", {
        method: "POST",
        body: JSON.stringify({ jobId: "job-a" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.executeBackgroundJob).not.toHaveBeenCalled();
    expect(mocks.captureM27QstashReplayRequest).not.toHaveBeenCalled();
  });

  it("does not capture an invalid signed request", async () => {
    mocks.prepareM27QstashReplayCapture.mockReturnValue(
      new Request("https://portfolioscope.dev/api/internal/jobs/worker"),
    );
    mocks.verifyQstashRequest.mockRejectedValue(
      new JobRequestError(
        JobErrorCode.WORKER_AUTH_FAILED,
        401,
        "The worker signature is invalid.",
      ),
    );

    const response = await POST(
      new Request("https://portfolioscope.dev/api/internal/jobs/worker", {
        method: "POST",
        body: JSON.stringify({ jobId: "job-a" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.executeBackgroundJob).not.toHaveBeenCalled();
    expect(mocks.captureM27QstashReplayRequest).not.toHaveBeenCalled();
  });

  it("captures only a completed duplicate after execution", async () => {
    const captureRequest = new Request(
      "https://portfolioscope.dev/api/internal/jobs/worker",
    );
    mocks.prepareM27QstashReplayCapture.mockReturnValue(captureRequest);
    mocks.executeBackgroundJob.mockResolvedValue({
      jobId: "job-a",
      status: "COMPLETED",
      duplicate: true,
      retrying: false,
    });

    const response = await POST(
      new Request("https://portfolioscope.dev/api/internal/jobs/worker", {
        method: "POST",
        body: JSON.stringify({ jobId: "job-a" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.captureM27QstashReplayRequest).toHaveBeenCalledWith(
      captureRequest,
      expect.objectContaining({ status: "COMPLETED", duplicate: true }),
    );
  });

  it("keeps the completed duplicate response when capture fails", async () => {
    mocks.prepareM27QstashReplayCapture.mockReturnValue(
      new Request("https://portfolioscope.dev/api/internal/jobs/worker"),
    );
    mocks.executeBackgroundJob.mockResolvedValue({
      jobId: "job-a",
      status: "COMPLETED",
      duplicate: true,
      retrying: false,
    });
    mocks.captureM27QstashReplayRequest.mockRejectedValue(
      new Error("capture unavailable"),
    );

    const response = await POST(
      new Request("https://portfolioscope.dev/api/internal/jobs/worker", {
        method: "POST",
        body: JSON.stringify({ jobId: "job-a" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId: "job-a",
      status: "COMPLETED",
      duplicate: true,
    });
  });

  it("asks QStash to redeliver retryable failures", async () => {
    mocks.executeBackgroundJob.mockResolvedValue({
      jobId: "job-a",
      status: "RETRYING",
      duplicate: false,
      retrying: true,
    });

    const response = await POST(
      new Request("https://portfolioscope.dev/api/internal/jobs/worker", {
        method: "POST",
        body: JSON.stringify({ jobId: "job-a" }),
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("15");
  });
});
