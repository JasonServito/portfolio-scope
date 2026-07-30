import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getHeartbeatUrl,
  sendOperationalHeartbeat,
} from "@/lib/operations/heartbeat";

describe("Better Stack operational heartbeats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires HTTPS in production and permits loopback HTTP locally", () => {
    expect(
      getHeartbeatUrl("worker", {
        NODE_ENV: "production",
        BETTER_STACK_WORKER_HEARTBEAT_URL:
          "http://heartbeat.example.test/worker",
      }),
    ).toBeNull();
    expect(
      getHeartbeatUrl("worker", {
        NODE_ENV: "development",
        BETTER_STACK_WORKER_HEARTBEAT_URL:
          "http://localhost:4000/worker",
      })?.origin,
    ).toBe("http://localhost:4000");
    expect(
      getHeartbeatUrl("backupFailure", {
        NODE_ENV: "production",
        BETTER_STACK_BACKUP_FAILURE_HEARTBEAT_URL:
          "https://heartbeat.example.test/failure",
      })?.protocol,
    ).toBe("https:");
  });

  it("sends a configured heartbeat without exposing its URL in logs", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(
      sendOperationalHeartbeat("backup", {
        environment: {
          NODE_ENV: "production",
          BETTER_STACK_BACKUP_HEARTBEAT_URL:
            "https://heartbeat.example.test/private-id",
        },
        fetcher,
      }),
    ).resolves.toEqual({ sent: true });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(info.mock.calls[0]?.[0])).not.toContain("private-id");
  });

  it("does not fail the primary operation when delivery fails", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 500 }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      sendOperationalHeartbeat("worker", {
        environment: {
          NODE_ENV: "production",
          BETTER_STACK_WORKER_HEARTBEAT_URL:
            "https://heartbeat.example.test/private-id",
        },
        fetcher,
      }),
    ).resolves.toEqual({ sent: false, reason: "delivery_failed" });
  });
});
