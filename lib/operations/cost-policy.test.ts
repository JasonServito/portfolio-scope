import { describe, expect, it } from "vitest";

import { getCostReview } from "@/lib/operations/cost-policy";

describe("cost review policy", () => {
  it("keeps the expected range beneath the hard monthly budget", () => {
    const policy = getCostReview({
      LAST_COST_REVIEW_AT: "2026-07-27T18:00:00Z",
      LAST_COST_REVIEW_REFERENCE: "ops-review-2026-07",
    });

    expect(policy.expectedUsd.maximum).toBeLessThan(policy.budgetUsd);
    expect(policy.lastReviewedAt).toBe("2026-07-27T18:00:00.000Z");
    expect(policy.reference).toBe("ops-review-2026-07");
  });

  it("does not present invalid review evidence", () => {
    expect(
      getCostReview({ LAST_COST_REVIEW_AT: "not-a-date" }).lastReviewedAt,
    ).toBeNull();
  });
});
