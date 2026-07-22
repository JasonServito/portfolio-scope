import {
  AgentName,
  BackgroundJobStatus,
  BackgroundJobType,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import { executeBackgroundJobHandler } from "@/lib/jobs/handlers";
import type { ClaimedBackgroundJob } from "@/lib/jobs/repository";

function claimedJob(
  overrides: Partial<ClaimedBackgroundJob>,
): ClaimedBackgroundJob {
  return {
    id: "job-a",
    type: BackgroundJobType.RESEARCH_AGENT_RUN,
    status: BackgroundJobStatus.RUNNING,
    payloadJson: {
      researchJobId: "research-foreign",
      agentName: AgentName.NEWS,
    },
    correlationId: "correlation-a",
    attemptCount: 1,
    maxAttempts: 3,
    timeoutMs: 30_000,
    companyId: null,
    portfolioId: null,
    researchJobId: "research-owned",
    userId: "user-a",
    agentName: AgentName.NEWS,
    ...overrides,
  };
}

describe("background job handler bindings", () => {
  it("rejects a forged research identifier before data access", async () => {
    await expect(
      executeBackgroundJobHandler(
        claimedJob({}),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "JOB_INVALID_PAYLOAD",
      retryable: false,
    });
  });

  it("rejects work after its timeout signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      executeBackgroundJobHandler(claimedJob({}), controller.signal),
    ).rejects.toMatchObject({ code: "JOB_TIMEOUT", retryable: true });
  });
});
