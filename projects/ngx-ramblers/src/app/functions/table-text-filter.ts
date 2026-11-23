import {
  TableFilterChip,
  TableFilterHeading,
  TableFilterOperator,
  TableFilterSuggestion,
  TableFilterSuggestionKind,
  TableTextFilterColumnValues,
  TableTextFilterField,
  TableTextFilterOption,
  TableTextFilterTerm
} from "../models/table-text-filter.model";
import { enumValues } from "./enums";
import { toKebabCase } from "./strings";

const TOKEN_PATTERN = /(-?)(?:([\w-]+):)?(=?)(?:"([^"]*)"|(\S+))/g;

function normalised(value: string): string {
  return (value || "").toLowerCase().replace(/[\s_-]+/g, "");
}

function searchable(value: string): string {
  return (value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function tableTextFilterQuery(tokens: string[]): string {
  return tokens.map(token => token.trim()).filter(Boolean).join(" ");
}

function headingField(heading: string): string {
  return toKebabCase(heading);
}

const MAX_OPTIONS_PER_COLUMN = 100;

export function tableTextFilterOptions(columnsPerRow: TableTextFilterColumnValues[][]): TableTextFilterOption[] {
  const counts = columnsPerRow.reduce((result, columns) => {
    columns.forEach(column => {
      const values = Array.from(new Set(column.values.map(value => (value || "").trim()).filter(Boolean)));
      values.forEach(value => {
        const key = `${column.heading}\u0000${value}`;
        const existing = result.get(key);
        result.set(key, {heading: column.heading, value, partial: column.partial, count: (existing?.count || 0) + 1});
      });
    });
    return result;
  }, new Map<string, {heading: string; value: string; partial: boolean; count: number}>());
  const byHeading = Array.from(counts.values()).reduce((result, entry) => {
    result.set(entry.heading, [...(result.get(entry.heading) || []), entry]);
    return result;
  }, new Map<string, {heading: string; value: string; partial: boolean; count: number}[]>());
  return Array.from(byHeading.values())
    .filter(entries => entries.length <= MAX_OPTIONS_PER_COLUMN)
    .flatMap(entries => entries
      .sort((left, right) => left.value.localeCompare(right.value, undefined, {numeric: true}))
      .map(entry => ({
        label: entry.value,
        group: entry.heading,
        count: entry.count,
        partial: entry.partial
      })));
}

export function parseTableTextFilter(query: string): TableTextFilterTerm[] {
  return Array.from((query || "").matchAll(TOKEN_PATTERN))
    .map(match => ({
      negated: match[1] === "-",
      field: match[2] ? normalised(match[2]) : null,
      exact: match[3] === "=",
      text: searchable(match[4] ?? match[5] ?? "")
    }))
    .filter(term => term.text.length > 0);
}

function headingWords(heading: string): string[] {
  return [normalised(heading), ...(heading || "").split(/[\s_-]+|(?=[A-Z])/).map(normalised)].filter(Boolean);
}

function fieldMatchesName(field: TableTextFilterField, name: string): boolean {
  return field.names.some(heading => headingWords(heading).some(word => word.startsWith(name)));
}

function textMatches(fieldText: string, term: TableTextFilterTerm): boolean {
  const text = searchable(fieldText);
  return term.exact
    ? text === term.text || toKebabCase(text) === term.text
    : text.includes(term.text) || toKebabCase(text).includes(term.text);
}

function termMatches(fields: TableTextFilterField[], term: TableTextFilterTerm): boolean {
  const candidates = term.field ? fields.filter(field => fieldMatchesName(field, term.field)) : fields;
  const found = candidates.some(field => textMatches(field.text, term));
  return term.negated ? !found : found;
}

export function tableTextFilterMatches(fields: TableTextFilterField[], terms: TableTextFilterTerm[]): boolean {
  const columnChoices = terms.filter(term => term.field && !term.negated);
  const otherTerms = terms.filter(term => !columnChoices.includes(term));
  const choiceFields = Array.from(new Set(columnChoices.map(term => term.field)));
  return otherTerms.every(term => termMatches(fields, term))
    && choiceFields.every(field => columnChoices.filter(term => term.field === field).some(term => termMatches(fields, term)));
}

export function filterRowsByText<T>(rows: T[], query: string, fieldsFor: (row: T) => TableTextFilterField[]): T[] {
  const terms = parseTableTextFilter(query);
  return terms.length ? rows.filter(row => tableTextFilterMatches(fieldsFor(row), terms)) : rows;
}

const OPERATOR_SYMBOLS: Record<TableFilterOperator, string> = {
  [TableFilterOperator.EQUALS]: "=",
  [TableFilterOperator.NOT_EQUALS]: "≠",
  [TableFilterOperator.CONTAINS]: "contains",
  [TableFilterOperator.NOT_CONTAINS]: "does not contain"
};

export function tableFilterOperatorLabel(operator: TableFilterOperator): string {
  return OPERATOR_SYMBOLS[operator];
}

export function tableFilterOperatorNegated(operator: TableFilterOperator): boolean {
  return operator === TableFilterOperator.NOT_EQUALS || operator === TableFilterOperator.NOT_CONTAINS;
}

export function tableFilterOperatorExact(operator: TableFilterOperator): boolean {
  return operator === TableFilterOperator.EQUALS || operator === TableFilterOperator.NOT_EQUALS;
}

export function tableFilterOperatorOpposite(operator: TableFilterOperator): TableFilterOperator {
  const opposites: Record<TableFilterOperator, TableFilterOperator> = {
    [TableFilterOperator.EQUALS]: TableFilterOperator.NOT_EQUALS,
    [TableFilterOperator.NOT_EQUALS]: TableFilterOperator.EQUALS,
    [TableFilterOperator.CONTAINS]: TableFilterOperator.NOT_CONTAINS,
    [TableFilterOperator.NOT_CONTAINS]: TableFilterOperator.CONTAINS
  };
  return opposites[operator];
}

function tableFilterOperatorFor(negated: boolean, exact: boolean): TableFilterOperator {
  if (exact) {
    return negated ? TableFilterOperator.NOT_EQUALS : TableFilterOperator.EQUALS;
  } else {
    return negated ? TableFilterOperator.NOT_CONTAINS : TableFilterOperator.CONTAINS;
  }
}

export function tableFilterToken(chip: TableFilterChip, valueAliasFor: (value: string) => string = value => value): string {
  const value = valueAliasFor(chip.value).replace(/"/g, "").trim();
  const quoted = `"${value}"`;
  const field = chip.heading ? `${headingField(chip.heading)}:` : "";
  const exact = chip.heading && tableFilterOperatorExact(chip.operator) ? "=" : "";
  return `${tableFilterOperatorNegated(chip.operator) ? "-" : ""}${field}${exact}${quoted}`;
}

export function tableFilterChips(query: string, headings: string[], options: TableTextFilterOption[] = []): TableFilterChip[] {
  return Array.from((query || "").matchAll(TOKEN_PATTERN))
    .map(match => {
      const field = match[2] ? normalised(match[2]) : null;
      const heading = field ? headings.find(candidate => normalised(candidate) === field) || headings.find(candidate => headingWords(candidate).some(word => word.startsWith(field))) || match[2] : null;
      const value = (match[4] ?? match[5] ?? "").trim();
      const option = options.find(candidate => (!heading || candidate.group === heading) && toKebabCase(candidate.label) === value);
      return {
        heading,
        operator: tableFilterOperatorFor(match[1] === "-", !!heading && match[3] === "="),
        value: option?.label || value
      };
    })
    .filter(chip => chip.value.length > 0);
}

export function tableFilterQueryFromChips(chips: TableFilterChip[], valueAliasFor: (value: string) => string = value => value): string {
  return tableTextFilterQuery(chips.map(chip => tableFilterToken(chip, valueAliasFor)));
}

function wordsMatch(text: string, typed: string): boolean {
  const haystack = (text || "").toLowerCase();
  return (typed || "").toLowerCase().split(/\s+/).filter(Boolean).every(word => haystack.includes(word));
}

const MAX_VALUE_SUGGESTIONS = 40;

function operatorForValue(operator: TableFilterOperator, option: TableTextFilterOption): TableFilterOperator {
  if (!option.partial) {
    return operator;
  } else if (operator === TableFilterOperator.EQUALS) {
    return TableFilterOperator.CONTAINS;
  } else if (operator === TableFilterOperator.NOT_EQUALS) {
    return TableFilterOperator.NOT_CONTAINS;
  } else {
    return operator;
  }
}

export function tableFilterSuggestions(input: {
  typed: string;
  heading: string | null;
  operator: TableFilterOperator | null;
  headings: TableFilterHeading[];
  options: TableTextFilterOption[];
}): TableFilterSuggestion[] {
  const typed = (input.typed || "").trim();
  const suggestion = (kind: TableFilterSuggestionKind, group: string, label: string, detail: string, count: number, heading: string | null, operator: TableFilterOperator | null, value: string): TableFilterSuggestion =>
    ({kind, group, label, detail, count, heading, operator, value});
  if (input.heading && !input.operator) {
    return enumValues(TableFilterOperator)
      .filter(operator => wordsMatch(tableFilterOperatorLabel(operator), typed))
      .map(operator => suggestion(TableFilterSuggestionKind.OPERATOR, "Operators", `${input.heading} ${tableFilterOperatorLabel(operator)}`, tableFilterOperatorExact(operator) ? "Whole value" : "Part of the value", 0, input.heading, operator, ""));
  } else if (input.heading && input.operator) {
    const values = input.options
      .filter(option => option.group === input.heading && wordsMatch(option.label, typed))
      .slice(0, MAX_VALUE_SUGGESTIONS)
      .map(option => suggestion(TableFilterSuggestionKind.VALUE, `${input.heading} values`, option.label, "", option.count, input.heading, operatorForValue(input.operator, option), option.label));
    const typedValue = typed ? [suggestion(TableFilterSuggestionKind.TEXT, "Use what you typed", `${input.heading} ${tableFilterOperatorLabel(input.operator)} "${typed}"`, "", 0, input.heading, input.operator, typed)] : [];
    return [...typedValue, ...values];
  } else {
    const headings = input.headings
      .filter(heading => !typed || wordsMatch(heading.heading, typed))
      .map(heading => suggestion(TableFilterSuggestionKind.HEADING, "Columns", heading.heading, "Choose how to compare", 0, heading.heading, null, ""));
    const values = typed ? input.options
      .filter(option => wordsMatch(option.label, typed))
      .slice(0, MAX_VALUE_SUGGESTIONS)
      .map(option => suggestion(TableFilterSuggestionKind.VALUE, "Values", option.label, option.group, option.count, option.group, operatorForValue(TableFilterOperator.EQUALS, option), option.label)) : [];
    const text = typed ? [suggestion(TableFilterSuggestionKind.TEXT, "Use what you typed", `Any column contains "${typed}"`, "", 0, null, TableFilterOperator.CONTAINS, typed)] : [];
    const startsColumn = typed && headings.some(heading => headingWords(heading.label).some(word => word.startsWith(normalised(typed))));
    return startsColumn ? [...headings, ...text, ...values] : [...text, ...values, ...headings];
  }
}
