import { describe, expect, it } from "vitest";
import { agmStatsPercentageChange, summaryRowChange } from "./agm-stats-change";

describe("agmStatsPercentageChange", () => {
  it("formats a rise, a fall, no change from zero, and a missing previous period", () => {
    expect(agmStatsPercentageChange(24, 20)).toEqual("+20.0%");
    expect(agmStatsPercentageChange(15, 20)).toEqual("-25.0%");
    expect(agmStatsPercentageChange(0, 0)).toEqual("0.0%");
    expect(agmStatsPercentageChange(24, 0)).toEqual("N/A");
  });
});

describe("summaryRowChange", () => {
  it("uses the last two period values when changeDisplay is not stored", () => {
    expect(summaryRowChange({metric: "Total Walks on Programme", values: [20, 24]})).toEqual({
      previous: 20,
      current: 24,
      display: "+20.0%"
    });
  });
});
