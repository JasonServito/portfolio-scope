import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyQstashRequest: vi.fn(),
  executeBackgroundJob: vi.fn(),
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
