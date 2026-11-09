import { DateDirection, RelativeDateRange, SelectablePreset } from "./search.model";

export interface DateValue {
  value: number;
  date: Date;
}

export interface DateRangeSliderPreset extends SelectablePreset {
  id?: string;
  recent?: boolean;
  relativeDateRange?: RelativeDateRange;
}

export enum DateRangeSliderUnit {
  DAYS = "days",
  HOURS = "hours"
}

export interface DateRangeSliderAxisTick {
  value: number;
  percent: number;
  label: string;
  start: boolean;
  end: boolean;
}

export const DATE_RANGE_SLIDER_PRESETS: DateRangeSliderPreset[] = [
  {label: "Next 7 days", relativeDateRange: {direction: DateDirection.FUTURE, duration: {days: 7}}},
  {label: "Next month", relativeDateRange: {direction: DateDirection.FUTURE, duration: {months: 1}}},
  {label: "Next 3 months", relativeDateRange: {direction: DateDirection.FUTURE, duration: {months: 3}}},
  {label: "Next 6 months", relativeDateRange: {direction: DateDirection.FUTURE, duration: {months: 6}}},
  {label: "Next year", relativeDateRange: {direction: DateDirection.FUTURE, duration: {years: 1}}},
  {label: "Last hour", recent: true, relativeDateRange: {direction: DateDirection.PAST, duration: {hours: 1}}},
  {label: "Last day", recent: true, relativeDateRange: {direction: DateDirection.PAST, duration: {hours: 24}}},
  {label: "Last 7 days", recent: true, relativeDateRange: {direction: DateDirection.PAST, duration: {days: 7}}},
  {label: "Last month", relativeDateRange: {direction: DateDirection.PAST, duration: {months: 1}}},
  {label: "Last 3 months", relativeDateRange: {direction: DateDirection.PAST, duration: {months: 3}}},
  {label: "Last year", relativeDateRange: {direction: DateDirection.PAST, duration: {years: 1}}}
];

export function dateRangeSliderPresets(options: { direction?: DateDirection; recent?: boolean } = {}): DateRangeSliderPreset[] {
  return DATE_RANGE_SLIDER_PRESETS.filter(preset => {
    const directionOk = !options.direction || preset.relativeDateRange?.direction === options.direction;
    const recentOk = !options.recent || !!preset.recent;
    return directionOk && recentOk;
  });
}

export const DATE_RANGE_SLIDER_PAST_PRESETS: DateRangeSliderPreset[] = dateRangeSliderPresets({
  direction: DateDirection.PAST
});

export interface EventTimesProps {
  prefixes?: boolean,
  noDates?: boolean,
  noTimes?: boolean
}

