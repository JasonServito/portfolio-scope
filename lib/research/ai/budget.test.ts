import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  calculateAiCostUsd,
  estimateInputTokenReservation,
  INPUT_TOKEN_RESERVATION_MARGIN,
  reserveAiUsage,
  utcMonthStart,
} from "./budget";
import { getAiResearchConfig } from "./config";

const pricing = {
  inputUsdPerMillion: 0.25,
  cachedInputUsdPerMillion: 0.025,
  outputUsdPerMillion: 2,
};

describe("AI usage calculations", () => {
  it("reserves counted input tokens with a margin, capped by the byte count", () => {
    const text =
      "Revenue growth (year over year), annual period 2024-09-29 to 2025-09-27: 6.4 percent.";
    const reserved = estimateInputTokenReservation(text);
    expect(reserved).toBeLessThan(Buffer.byteLength(text, "utf8") / 2);
    expect(reserved).toBeGreaterThan(10);
    expect(INPUT_TOKEN_RESERVATION_MARGIN).toBeGreaterThan(1);
    // A one-token string reserves at most its bytes.
    expect(estimateInputTokenReservation("a")).toBe(1);
    expect(estimateInputTokenReservation("ðŸ“ˆ")).toBeLessThanOrEqual(
      Buffer.byteLength("ðŸ“ˆ", "utf8"),
    );
  });

  it("calculates uncached, cached, and output usage with upward rounding", () => {
    expect(
      calculateAiCostUsd(
        { inputTokens: 1_000, cachedInputTokens: 250, outputTokens: 500 },
        pricing,
      ),
    ).toBe(0.001194);
  });

  it("retries a serialization conflict with backoff and gives up after five attempts", async () => {
    const conflict = () =>
      new Prisma.PrismaClientKnownRequestError("serialization failure", {
        code: "P2034",
        clientVersion: "test",
      });
    const input = {
      idempotencyKey: "job-a:risk:model-attempt:1",
      userId: "user-a",
      researchJobId: "job-a",
      operation: "SPECIALIST_RISK",
      promptVersion: "test",
      attemptNumber: 1,
      reservedInputTokens: 100,
      reservedOutputTokens: 100,
      config: getAiResearchConfig({
        OPENAI_API_KEY: "test-only",
      } as unknown as NodeJS.ProcessEnv),
    };

    // Three concurrent specialists contend on the same budget rows; four
    // conflicts in a row must no longer fail the reservation.
    const recovering = vi
      .fn()
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce({ usageId: "usage-a" });
    await expect(
      reserveAiUsage(input, { $transaction: recovering } as never),
    ).resolves.toEqual({ usageId: "usage-a" });
    expect(recovering).toHaveBeenCalledTimes(5);

    const exhausted = vi.fn().mockImplementation(async () => {
      throw conflict();
    });
    await expect(
      reserveAiUsage(input, { $transaction: exhausted } as never),
    ).rejects.toMatchObject({ code: "P2034" });
    expect(exhausted).toHaveBeenCalledTimes(5);
  });

  it("uses a UTC calendar-month boundary", () => {
    expect(utcMonthStart(new Date("2026-08-31T23:59:59-06:00"))).toEqual(
      new Date("2026-09-01T00:00:00.000Z"),
    );
  });
});
