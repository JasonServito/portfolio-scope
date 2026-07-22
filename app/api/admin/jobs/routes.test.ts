import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiAdmin: vi.fn(),
  listBackgroundJobsForAdmin: vi.fn(),
  getBackgroundJobForAdmin: vi.fn(),
  retryBackgroundJob: vi.fn(),
  cancelBackgroundJob: vi.fn(),
  enforceRateLimit: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/auth/authorization")>();
  return { ...original, requireApiAdmin: mocks.requireApiAdmin };
});
vi.mock("@/lib/jobs/service", () => ({
  listBackgroundJobsForAdmin: mocks.listBackgroundJobsForAdmin,
  getBackgroundJobForAdmin: mocks.getBackgroundJobForAdmin,
  retryBackgroundJob: mocks.retryBackgroundJob,
  cancelBackgroundJob: mocks.cancelBackgroundJob,
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...original,
    enforceRateLimit: mocks.enforceRateLimit,
    getRequestIp: () => "203.0.113.10",
  };
});

import {
  AuthorizationError,
  AuthorizationErrorCode,
} from "@/lib/auth/authorization";
import { GET as listJobs } from "./route";
import { GET as getJob } from "./[id]/route";
import { POST as retryJob } from "./[id]/retry/route";
import { POST as cancelJob } from "./[id]/cancel/route";

const context = { params: Promise.resolve({ id: "job-a" }) };

describe("administrator job routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiAdmin.mockResolvedValue({ id: "admin-a", role: "ADMIN" });
    mocks.listBackgroundJobsForAdmin.mockResolvedValue([]);
    mocks.getBackgroundJobForAdmin.mockResolvedValue({
      id: "job-a",
      status: "FAILED",
    });
    mocks.retryBackgroundJob.mockResolvedValue({
      jobId: "job-a",
      status: "QUEUED",
    });
    mocks.cancelBackgroundJob.mockResolvedValue({
      id: "job-a",
      status: "CANCELLED",
    });
    mocks.enforceRateLimit.mockResolvedValue({ success: true });
  });

  it("authorizes before returning job details", async () => {
    mocks.requireApiAdmin.mockRejectedValue(
      new AuthorizationError(AuthorizationErrorCode.ADMIN_REQUIRED),
    );

    const response = await getJob(
      new Request("https://portfolioscope.dev/api/admin/jobs/job-a"),
      context,
    );

    expect(response.status).toBe(403);
    expect(mocks.getBackgroundJobForAdmin).not.toHaveBeenCalled();
  });

  it("validates list filters after administrator authorization", async () => {
    const response = await listJobs(
      new Request("https://portfolioscope.dev/api/admin/jobs?status=FORGED"),
    );

    expect(response.status).toBe(400);
    expect(mocks.requireApiAdmin).toHaveBeenCalledOnce();
    expect(mocks.listBackgroundJobsForAdmin).not.toHaveBeenCalled();
  });

  it("rate-limits an administrator retry by both user and IP", async () => {
    const response = await retryJob(
      new Request("https://portfolioscope.dev/api/admin/jobs/job-a/retry", {
        method: "POST",
        headers: { Origin: "https://portfolioscope.dev" },
      }),
      context,
    );

    expect(response.status).toBe(202);
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      category: "adminIngestion",
      identifier: "user:admin-a",
    });
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      category: "adminIngestion",
      identifier: "ip:203.0.113.10",
    });
    expect(mocks.retryBackgroundJob).toHaveBeenCalledWith(
      "job-a",
      "admin-a",
    );
  });

  it("rejects cross-site cancellation before job state changes", async () => {
    const response = await cancelJob(
      new Request("https://portfolioscope.dev/api/admin/jobs/job-a/cancel", {
        method: "POST",
        headers: { Origin: "https://attacker.example" },
      }),
      context,
    );

    expect(response.status).toBe(403);
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
    expect(mocks.cancelBackgroundJob).not.toHaveBeenCalled();
  });
});
