import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyQstashSignature: vi.fn(),
  enqueueBackgroundJob: vi.fn(),
}));

vi.mock("@/lib/jobs/qstash", () => ({
  verifyQstashSignature: mocks.verifyQstashSignature,
}));
vi.mock("@/lib/jobs/service", () => ({
  enqueueBackgroundJob: mocks.enqueueBackgroundJob,
}));

import { JobErrorCode, JobRequestError } from "@/lib/jobs/errors";
import { POST } from "./route";

describe("QStash maintenance schedule route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyQstashSignature.mockResolvedValue(
      JSON.stringify({ operation: "RECOVER_STALE_JOBS" }),
    );
    mocks.enqueueBackgroundJob.mockResolvedValue({
      jobId: "job-a",
      status: "QUEUED",
      reused: false,
    });
  });

  it("verifies the schedule before creating a durable maintenance job", async () => {
    const request = new Request(
      "https://portfolioscope.dev/api/internal/schedules/maintenance",
      { method: "POST", body: "signed-body" },
    );
    const response = await POST(request);

    expect(response.status).toBe(202);
    expect(mocks.verifyQstashSignature).toHaveBeenCalledWith(request);
    expect(mocks.enqueueBackgroundJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MAINTENANCE_CLEANUP",
        payload: { operation: "RECOVER_STALE_JOBS" },
        correlationId: response.headers.get("x-correlation-id"),
      }),
    );
  });

  it("does not enqueue an unsigned schedule delivery", async () => {
    mocks.verifyQstashSignature.mockRejectedValue(
      new JobRequestError(
        JobErrorCode.WORKER_SIGNATURE_MISSING,
        401,
        "A valid worker signature is required.",
      ),
    );

    const response = await POST(
      new Request("https://portfolioscope.dev/api/internal/schedules/maintenance", {
        method: "POST",
        body: "unsigned",
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.enqueueBackgroundJob).not.toHaveBeenCalled();
  });
});
