import { SortDirection } from "../models/sort.model";
import { ASCENDING, DESCENDING } from "../models/table-filtering.model";

export function sortDirectionParam(direction: string): SortDirection {
  return direction === ASCENDING ? SortDirection.ASC : SortDirection.DESC;
}

export function sortDirectionFromParam(param: string, defaultDirection: string): string {
  return param === SortDirection.ASC ? ASCENDING : param === SortDirection.DESC ? DESCENDING : defaultDirection;
}
