import { describe, expect, it } from "vitest";
import { M33_EVALUATION_CASES } from "./fixtures/m33-evaluation";
import { runVerificationEvaluation } from "./verification-evaluation";

describe("M33 recorded regression baseline", () => {
  it("meets every per-case threshold for the pinned version tuple", async () => {
    const result = await runVerificationEvaluation();
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.cases).toHaveLength(8);
    expect(result.cases.every((item) => item.passed)).toBe(true);
  });

  it("fails if a valid citation is used to retain a semantically unsupported claim", async () => {
    const cases = structuredClone(M33_EVALUATION_CASES);
    cases.find(
      (item) => item.id === "unsupported-competitive-claim",
    )!.recording.results[0].status = "SUPPORTED";
    const result = await runVerificationEvaluation(cases);
    expect(result.passed).toBe(false);
    expect(
      result.failures.some((issue) => issue.includes("Retained claims differ")),
    ).toBe(true);
  });

  it("fails if the amendment counterpoint or an entire case disappears", async () => {
    const cases = structuredClone(M33_EVALUATION_CASES);
    cases.find((item) => item.id === "amendment-scope")!.recording.results[0] =
      {
        ...cases.find((item) => item.id === "amendment-scope")!.recording
          .results[0],
        status: "UNSUPPORTED",
        contradictingEvidenceIds: [],
      };
    cases.pop();
    const result = await runVerificationEvaluation(cases);
    expect(result.passed).toBe(false);
    expect(
      result.failures.some((issue) => issue.includes("Verdict accuracy")),
    ).toBe(true);
    expect(result.failures.some((issue) => issue.includes("Case count"))).toBe(
      true,
    );
  });
});
