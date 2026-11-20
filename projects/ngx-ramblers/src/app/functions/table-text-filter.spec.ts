import { filterRowsByText, parseTableTextFilter, tableFilterChips, tableFilterQueryFromChips, tableFilterSuggestions, tableTextFilterOptions } from "./table-text-filter";
import { TableFilterOperator, TableFilterSuggestionKind, TableTextFilterField } from "../models/table-text-filter.model";

interface Site {
  environment: string;
  cluster: string;
  status: string;
}

const sites: Site[] = [
  {environment: "windsor-district", cluster: "ngx-demo.kfj2qrc", status: "Moved"},
  {environment: "new-forest", cluster: "ngx-demo.kfj2qrc", status: "Not moved"},
  {environment: "craven", cluster: "ngx-shared-sites-01.vqprbox", status: "Moved"}
];

function fields(site: Site): TableTextFilterField[] {
  return [
    {names: ["Environment", "environment"], text: site.environment},
    {names: ["Cluster", "cluster"], text: site.cluster},
    {names: ["London move", "status"], text: site.status}
  ];
}

function names(query: string): string[] {
  return filterRowsByText(sites, query, fields).map(site => site.environment);
}

describe("table text filter", () => {
  it("keeps every row when the filter is empty", () => {
    expect(names("  ")).toEqual(["windsor-district", "new-forest", "craven"]);
  });

  it("matches any column, ignoring case", () => {
    expect(names("DEMO")).toEqual(["windsor-district", "new-forest"]);
  });

  it("needs every word to match", () => {
    expect(names("demo forest")).toEqual(["new-forest"]);
  });

  it("drops rows matching a word starting with a minus", () => {
    expect(names("-demo")).toEqual(["craven"]);
  });

  it("limits a word to one column by the start of its heading", () => {
    expect(names("env:forest")).toEqual(["new-forest"]);
    expect(names("londonmove:moved")).toEqual(["windsor-district", "new-forest", "craven"]);
    expect(names("move:not")).toEqual(["new-forest"]);
  });

  it("matches a whole value exactly with an equals sign", () => {
    expect(names("status:=moved")).toEqual(["windsor-district", "craven"]);
  });

  it("treats quoted text as one phrase", () => {
    expect(names("\"not moved\"")).toEqual(["new-forest"]);
  });

  it("reads the parts of each word", () => {
    expect(parseTableTextFilter("-status:=\"Not moved\" demo")).toEqual([
      {negated: true, field: "status", exact: true, text: "not moved"},
      {negated: false, field: null, exact: false, text: "demo"}
    ]);
  });
});

describe("table text filter suggestions", () => {
  const columns = sites.map(site => [
    {heading: "Cluster", values: [site.cluster], partial: false},
    {heading: "London move", values: [site.status], partial: false},
    {heading: "Sites", values: site.environment.split("-"), partial: true}
  ]);

  it("offers each value once per column with how many rows have it", () => {
    const options = tableTextFilterOptions(columns).filter(option => option.group === "London move");
    expect(options).toEqual([
      {label: "Moved", group: "London move", count: 2, partial: false},
      {label: "Not moved", group: "London move", count: 1, partial: false}
    ]);
  });

  it("matches a chosen value exactly, or as part of a list", () => {
    const options = tableTextFilterOptions(columns);
    const headings = [{heading: "London move", suggestValues: true}, {heading: "Sites", suggestValues: true}];
    const [moved] = tableFilterSuggestions({typed: "moved", heading: null, operator: null, headings, options}).filter(suggestion => suggestion.label === "Moved");
    const [forest] = tableFilterSuggestions({typed: "forest", heading: null, operator: null, headings, options}).filter(suggestion => suggestion.label === "forest");
    expect(names(tableFilterQueryFromChips([{heading: moved.heading, operator: moved.operator, value: moved.value}]))).toEqual(["windsor-district", "craven"]);
    expect(forest.operator).toEqual(TableFilterOperator.CONTAINS);
  });
});

describe("table filter chips", () => {
  const headings = ["Environment", "Cluster", "London move"];

  it("turns chips into a query the filter understands and back again", () => {
    const chips = [
      {heading: "London move", operator: TableFilterOperator.EQUALS, value: "Not moved"},
      {heading: "Cluster", operator: TableFilterOperator.NOT_CONTAINS, value: "shared"},
      {heading: null, operator: TableFilterOperator.CONTAINS, value: "forest"}
    ];
    const query = tableFilterQueryFromChips(chips);
    expect(query).toEqual("london-move:=\"Not moved\" -cluster:\"shared\" \"forest\"");
    expect(tableFilterChips(query, headings)).toEqual(chips);
    expect(names(query)).toEqual(["new-forest"]);
  });

  it("keeps typed text containing a colon, such as a web address, as text to find", () => {
    const query = tableFilterQueryFromChips([{heading: null, operator: TableFilterOperator.CONTAINS, value: "ngx-shared-sites-01.vqprbox"}]);
    expect(names(query)).toEqual(["craven"]);
    const address = tableFilterQueryFromChips([{heading: null, operator: TableFilterOperator.CONTAINS, value: "https://group.example.org.uk"}]);
    expect(tableFilterChips(address, headings)).toEqual([{heading: null, operator: TableFilterOperator.CONTAINS, value: "https://group.example.org.uk"}]);
    const fields = (text: string) => [{names: ["Environment"], text}];
    expect(filterRowsByText(["https://group.example.org.uk/admin", "https://other.example.org.uk"], address, fields)).toEqual(["https://group.example.org.uk/admin"]);
  });

  it("reads a typed column shortcut as the column it starts", () => {
    expect(tableFilterChips("move:london", headings)).toEqual([{heading: "London move", operator: TableFilterOperator.CONTAINS, value: "london"}]);
  });
});

describe("table filter suggestions as you type", () => {
  const options = tableTextFilterOptions(sites.map(site => [
    {heading: "Environment", values: [site.environment], partial: false},
    {heading: "Cluster", values: [site.cluster], partial: false}
  ]));
  const headings = [{heading: "Environment", suggestValues: true}, {heading: "Cluster", suggestValues: true}];

  it("offers matching values from any column and matching columns", () => {
    const suggestions = tableFilterSuggestions({typed: "clu", heading: null, operator: null, headings, options});
    expect(suggestions.map(suggestion => suggestion.kind)).toEqual([TableFilterSuggestionKind.HEADING, TableFilterSuggestionKind.TEXT]);
    const demo = tableFilterSuggestions({typed: "demo", heading: null, operator: null, headings, options});
    expect(demo.filter(suggestion => suggestion.kind === TableFilterSuggestionKind.VALUE).map(suggestion => [suggestion.label, suggestion.count])).toEqual([["ngx-demo.kfj2qrc", 2]]);
  });

  it("offers the ways to compare once a column is chosen, then that column's values", () => {
    expect(tableFilterSuggestions({typed: "", heading: "Cluster", operator: null, headings, options}).map(suggestion => suggestion.operator))
      .toEqual([TableFilterOperator.EQUALS, TableFilterOperator.NOT_EQUALS, TableFilterOperator.CONTAINS, TableFilterOperator.NOT_CONTAINS]);
    expect(tableFilterSuggestions({typed: "shared", heading: "Cluster", operator: TableFilterOperator.EQUALS, headings, options}).map(suggestion => suggestion.label))
      .toEqual(["Cluster = \"shared\"", "ngx-shared-sites-01.vqprbox"]);
  });
});
