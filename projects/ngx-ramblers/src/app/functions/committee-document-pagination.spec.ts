/** @vitest-environment jsdom */
import {describe, expect, it} from "vitest";
import {bookletSpreads, keepTogetherUnits, KeepUnitKind, paginateKeepTogether} from "./committee-document-pagination";

function block(tag: string, height: number, className = "", text = tag): HTMLElement {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  element.textContent = text;
  Object.defineProperty(element, "offsetHeight", {value: height, configurable: true});
  return element;
}

function heightOf(nodes: HTMLElement[]): number {
  return nodes.reduce((sum, node) => sum + ((node as HTMLElement).offsetHeight || 0), 0);
}

describe("keep-together document pagination", () => {
  it("moves a walk that does not fit onto the next page and keeps its heading with its body", () => {
    const heading = block("H2", 40, "", "Hillside Park");
    const body = block("P", 80, "", "A riverside walk.");
    const nextHeading = block("H2", 40, "", "Woodland trail");
    const nextBody = block("P", 80, "", "Through the woods.");
    const units = keepTogetherUnits([heading, body, nextHeading, nextBody]);
    expect(units.map(unit => unit.kind)).toEqual([KeepUnitKind.KEEP, KeepUnitKind.KEEP]);
    expect(units[0].nodes).toEqual([heading, body]);
    const pages = paginateKeepTogether(units, 150, heightOf);
    expect(pages).toHaveLength(2);
    expect(pages[0][0].nodes.map(node => node.textContent)).toEqual(["Hillside Park", "A riverside walk."]);
    expect(pages[1][0].nodes.map(node => node.textContent)).toEqual(["Woodland trail", "Through the woods."]);
  });

  it("lets intro paragraphs flow while walks stay whole", () => {
    const intro = block("P", 50, "", "Welcome to the winter programme.");
    const heading = block("H2", 40, "", "Hillside Park");
    const body = block("P", 80, "", "Bring lunch.");
    const units = keepTogetherUnits([intro, heading, body]);
    expect(units[0].kind).toBe(KeepUnitKind.FLOW);
    expect(units[1].nodes.map(node => node.textContent)).toEqual(["Hillside Park", "Bring lunch."]);
  });

  it("continues a walk that is taller than one page onto the following page", () => {
    const heading = block("H2", 40, "", "Hillside Park");
    const first = block("P", 80, "", "First stretch.");
    const second = block("P", 80, "", "Second stretch.");
    const keep = document.createElement("div");
    keep.className = "committee-document-keep";
    keep.append(heading, first, second);
    const units = keepTogetherUnits([keep]);
    const pages = paginateKeepTogether(units, 150, heightOf);
    expect(pages).toHaveLength(2);
    expect(pages[0][0].nodes.map(node => node.textContent)).toEqual(["Hillside Park", "First stretch."]);
    expect(pages[1][0].nodes.map(node => node.textContent)).toEqual(["Second stretch."]);
  });

  it("keeps a print/post presentation table on one page", () => {
    const table = document.createElement("table");
    table.setAttribute("role", "presentation");
    const first = document.createElement("tr");
    first.appendChild(block("TD", 40, "", "Monday 10:30"));
    const second = document.createElement("tr");
    second.appendChild(block("TD", 80, "", "A riverside walk."));
    table.append(first, second);
    const units = keepTogetherUnits([table]);
    expect(units).toHaveLength(1);
    expect(units[0].kind).toBe(KeepUnitKind.KEEP);
    expect(units[0].nodes).toEqual([table]);
  });

  it("pairs A5 booklet pages into two-up spreads", () => {
    expect(bookletSpreads(["1", "2", "3"])).toEqual([["1", "2"], ["3", null]]);
  });

  it("ignores empty markdown paragraphs so they do not become blank pages", () => {
    const empty = block("P", 400, "", "   ");
    empty.textContent = "   ";
    const heading = block("H2", 40, "", "Hillside Park");
    const body = block("P", 80, "", "A riverside walk.");
    const keep = document.createElement("div");
    keep.className = "committee-document-keep";
    keep.append(empty.cloneNode(true) as HTMLElement, heading, body);
    const units = keepTogetherUnits([empty, keep, block("P", 400, "", "")]);
    expect(units).toHaveLength(1);
    expect(units[0].nodes.map(node => node.textContent)).toEqual(["Hillside Park", "A riverside walk."]);
    expect(paginateKeepTogether(units, 150, heightOf)).toHaveLength(1);
  });
});

describe("oversized paragraph continuation", () => {
  it("preserves formatted text across pages", () => {
    const paragraph = document.createElement("p");
    paragraph.innerHTML = "One two <strong>three four five six</strong> seven eight nine ten";
    const measure = (nodes: HTMLElement[]) => nodes.reduce((height, node) => height + (node.textContent || "").trim().split(/\s+/).length * 20, 0);
    const pages = paginateKeepTogether(keepTogetherUnits([paragraph]), 80, measure);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap(page => page.flatMap(unit => unit.nodes)).map(node => node.textContent).join("")).toBe(paragraph.textContent);
    expect(pages.every(page => measure(page.flatMap(unit => unit.nodes)) <= 80)).toBe(true);
    expect(pages.flatMap(page => page.flatMap(unit => unit.nodes)).some(node => node.querySelector("strong"))).toBe(true);
  });
});

describe("pagination measurement cost", () => {
  it("finds paragraph breaks without measuring every word", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "word ".repeat(1024).trim();
    const measurements = {count: 0};
    const measure = (nodes: HTMLElement[]) => {
      measurements.count += 1;
      return nodes.reduce((height, node) => height + (node.textContent || "").trim().split(/\s+/).length, 0);
    };
    const pages = paginateKeepTogether(keepTogetherUnits([paragraph]), 512, measure);
    expect(pages).toHaveLength(2);
    expect(measurements.count).toBeLessThan(80);
    expect(pages.flatMap(page => page.flatMap(unit => unit.nodes)).map(node => node.textContent).join("")).toBe(paragraph.textContent);
  });
});
