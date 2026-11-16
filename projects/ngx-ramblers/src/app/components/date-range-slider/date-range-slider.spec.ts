import { DateTime } from "luxon";
import { dateRangeSliderAxisTicks, measuredTickLabelWidthPercent } from "./date-range-slider";
import { DateRangeSliderUnit } from "../../models/date.model";

describe("dateRangeSliderAxisTicks", () => {
  const start = DateTime.fromISO("2026-03-01", {zone: "Europe/London"}).startOf("day");
  const labelFor = (date: DateTime) => date.toFormat("dd MMM yyyy");

  it("returns no ticks when the span is empty", () => {
    expect(dateRangeSliderAxisTicks(null, 30, labelFor)).toEqual([]);
    expect(dateRangeSliderAxisTicks(start, 0, labelFor)).toEqual([]);
  });

  it("places whole-day ticks on a short range without overlapping date labels", () => {
    const ticks = dateRangeSliderAxisTicks(start, 7, labelFor);
    expect(ticks.every(tick => Number.isInteger(tick.value))).toBe(true);
    expect(ticks[0].start).toBe(true);
    expect(ticks[0].end).toBe(false);
    expect(ticks[ticks.length - 1].end).toBe(true);
    expect(ticks[0].label).toBe("01 Mar 2026");
    expect(ticks[ticks.length - 1].label).toBe("08 Mar 2026");
    const gaps = ticks.slice(1).map((tick, index) => tick.percent - ticks[index].percent);
    expect(gaps.every(gap => gap >= 16)).toBe(true);
  });

  it("places hour ticks on a 24-hour range without overlapping time labels", () => {
    const ticks = dateRangeSliderAxisTicks(start, 24, date => date.toFormat("HH:mm"), DateRangeSliderUnit.HOURS);
    expect(ticks.every(tick => tick.value % 3 === 0)).toBe(true);
    expect(ticks[0].label).toBe("00:00");
    expect(ticks[ticks.length - 1].value).toBe(24);
    expect(ticks[ticks.length - 1].label).toBe("00:00");
    const gaps = ticks.slice(1).map((tick, index) => tick.percent - ticks[index].percent);
    expect(gaps.every(gap => gap >= 8)).toBe(true);
  });

  it("keeps start and end on a year-long range and spaces ticks so date labels do not overlap", () => {
    const ticks = dateRangeSliderAxisTicks(start, 365, labelFor);
    expect(ticks[0].value).toBe(0);
    expect(ticks[ticks.length - 1].value).toBe(365);
    expect(ticks[0].label).toBe("01 Mar 2026");
    expect(ticks[ticks.length - 1].label).toBe("01 Mar 2027");
    const gaps = ticks.slice(1).map((tick, index) => tick.percent - ticks[index].percent);
    expect(gaps.every(gap => gap >= 16)).toBe(true);
  });

  it("drops crowded ticks on a three-month range so the start label has room", () => {
    const august = DateTime.fromISO("2026-08-19", {zone: "Europe/London"}).startOf("day");
    const ticks = dateRangeSliderAxisTicks(august, 89, labelFor);
    expect(ticks[0].label).toBe("19 Aug 2026");
    expect(ticks[ticks.length - 1].label).toBe("16 Nov 2026");
    const firstGap = ticks[1].percent - ticks[0].percent;
    expect(firstGap).toBeGreaterThanOrEqual(16);
    const gaps = ticks.slice(1).map((tick, index) => tick.percent - ticks[index].percent);
    expect(gaps.every(gap => gap >= 16)).toBe(true);
  });

  it("keeps measured date labels apart on a narrow slider", () => {
    const labelPx = 70;
    const widthPercent = measuredTickLabelWidthPercent(() => labelPx, 300);
    const ticks = dateRangeSliderAxisTicks(start, 42, labelFor, DateRangeSliderUnit.DAYS, widthPercent);
    const pixels = ticks.map(tick => tick.percent * 3);
    const bounds = ticks.map((tick, index) => tick.start ? [0, labelPx] : tick.end ? [300 - labelPx, 300] : [pixels[index] - labelPx / 2, pixels[index] + labelPx / 2]);
    expect(ticks[0].label).toBe("01 Mar 2026");
    expect(ticks[ticks.length - 1].label).toBe("12 Apr 2026");
    expect(bounds.slice(1).every((bound, index) => bound[0] >= bounds[index][1])).toBe(true);
    expect(ticks.length).toBeLessThan(dateRangeSliderAxisTicks(start, 42, labelFor).length);
  });

  it("falls back to fixed label widths until the slider has been measured", () => {
    expect(measuredTickLabelWidthPercent(() => 70, 0)).toBeNull();
  });
});
