import { SummaryRow } from "../models/agm-stats.model";

export const AGM_STATS_CHANGE_COLUMN = "Change (Current vs Previous)";

export function agmStatsPercentageChange(current: number, previous: number): string {
  if (previous === 0 && current === 0) {
    return "0.0%";
  } else if (previous === 0) {
    return "N/A";
  } else {
    const change = ((current - previous) / previous) * 100;
    return change > 0 ? `+${change.toFixed(1)}%` : `${change.toFixed(1)}%`;
  }
}

export function summaryRowChange(row: SummaryRow): {previous: number; current: number; display: string} {
  const previous = row.previous ?? row.values[row.values.length - 2] ?? 0;
  const current = row.current ?? row.values[row.values.length - 1] ?? 0;
  return {
    previous,
    current,
    display: row.changeDisplay || agmStatsPercentageChange(current, previous)
  };
}
