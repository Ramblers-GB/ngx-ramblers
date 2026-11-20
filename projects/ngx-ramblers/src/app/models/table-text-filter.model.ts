export interface TableTextFilterTerm {
  text: string;
  field: string | null;
  exact: boolean;
  negated: boolean;
}

export interface TableTextFilterField {
  names: string[];
  text: string;
}

export interface TableTextFilterColumnValues {
  heading: string;
  values: string[];
  partial: boolean;
}

export interface TableTextFilterOption {
  label: string;
  group: string;
  count: number;
  partial: boolean;
}

export enum TableFilterOperator {
  EQUALS = "equals",
  NOT_EQUALS = "not-equals",
  CONTAINS = "contains",
  NOT_CONTAINS = "not-contains"
}

export interface TableFilterChip {
  heading: string | null;
  operator: TableFilterOperator;
  value: string;
}

export interface TableFilterHeading {
  heading: string;
  suggestValues: boolean;
}

export enum TableFilterSuggestionKind {
  HEADING = "heading",
  OPERATOR = "operator",
  VALUE = "value",
  TEXT = "text"
}

export interface TableFilterSuggestion {
  kind: TableFilterSuggestionKind;
  group: string;
  label: string;
  detail: string;
  count: number;
  heading: string | null;
  operator: TableFilterOperator | null;
  value: string;
}
