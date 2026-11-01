import { describe, expect, it } from "vitest";

import { getValueAxis } from "./portfolio-performance-chart";

describe("performance chart value axis", () => {
  it("keeps a small move in proportion on round dollar ticks", () => {
    const axis = getValueAxis([50_597.32, 52_042.1, 51_277.9], 50_597.32);

    expect(axis.domain).toEqual([50_000, 53_000]);
    expect(axis.ticks).toEqual([50_000, 51_000, 52_000, 53_000]);
  });

  it("widens to the data when the move exceeds the minimum span", () => {
    const axis = getValueAxis([40_000, 60_000], 40_000);

    expect(axis.domain).toEqual([40_000, 60_000]);
    expect(axis.ticks).toEqual([40_000, 45_000, 50_000, 55_000, 60_000]);
  });
});
