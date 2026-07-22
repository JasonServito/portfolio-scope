import { describe, expect, it, vi } from "vitest";

import { waitForDistributedSecPermit } from "@/lib/sec/distributed-rate";

describe("distributed SEC fair-access permit", () => {
  it("waits for the Redis-assigned global request slot", async () => {
    const store = {
      acquireIntervalPermit: vi.fn().mockResolvedValue({
        delayMs: 125,
        unavailable: false,
      }),
    };
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      waitForDistributedSecPermit({ store, sleep }),
    ).resolves.toEqual({ coordinated: true, delayMs: 125 });
    expect(store.acquireIntervalPermit).toHaveBeenCalledWith({
      category: "sec-provider",
      identifier: "global",
      intervalMs: 125,
    });
    expect(sleep).toHaveBeenCalledWith(125);
  });

  it("falls back to the in-process SEC gate when Redis is unavailable", async () => {
    const store = {
      acquireIntervalPermit: vi.fn().mockResolvedValue({
        delayMs: 0,
        unavailable: true,
      }),
    };
    const sleep = vi.fn();

    await expect(
      waitForDistributedSecPermit({ store, sleep }),
    ).resolves.toEqual({ coordinated: false, delayMs: 0 });
    expect(sleep).not.toHaveBeenCalled();
  });
});
