export enum KeepUnitKind {
  FLOW = "flow",
  KEEP = "keep",
  BREAK = "break",
  TABLE_ROW = "table-row"
}

export interface KeepUnit {
  kind: KeepUnitKind;
  nodes: HTMLElement[];
  table?: HTMLTableElement;
  header?: HTMLTableSectionElement | null;
  row?: HTMLTableRowElement;
}

export function headingLevel(element: HTMLElement): number | null {
  const match = /^H([1-6])$/.exec(element.tagName);
  return match ? Number(match[1]) : null;
}

export function blockHasContent(block: HTMLElement): boolean {
  if (block.classList?.contains("committee-document-page-break")) {
    return true;
  } else if (block.querySelector("img, table, svg, video")) {
    return true;
  } else {
    return (block.textContent || "").trim().length > 0;
  }
}

export function keepTogetherUnits(blocks: HTMLElement[]): KeepUnit[] {
  return blocks.filter(blockHasContent).reduce((units: KeepUnit[], block) => {
    if (block.classList?.contains("committee-document-page-break")) {
      return [...units, {kind: KeepUnitKind.BREAK, nodes: [block]}];
    } else if (block.tagName === "TABLE") {
      if ((block.getAttribute("role") || "").toLowerCase() === "presentation") {
        return [...units, {kind: KeepUnitKind.KEEP, nodes: [block]}];
      } else {
        return [...units, ...tableRowUnits(block as HTMLTableElement)];
      }
    } else if (block.classList?.contains("committee-document-keep")) {
      const children = (Array.from(block.children) as HTMLElement[]).filter(blockHasContent);
      if (children.length > 0) {
        return [...units, {kind: KeepUnitKind.KEEP, nodes: children}];
      } else {
        return units;
      }
    } else if (block.classList?.contains("committee-document-title-block")) {
      return [...units, {kind: KeepUnitKind.KEEP, nodes: [block]}];
    } else if (headingLevel(block) !== null) {
      return [...units, {kind: KeepUnitKind.KEEP, nodes: [block]}];
    } else {
      const previous = units[units.length - 1];
      if (previous?.kind === KeepUnitKind.KEEP && headingLevel(previous.nodes[0]) !== null) {
        return [...units.slice(0, -1), {kind: KeepUnitKind.KEEP, nodes: [...previous.nodes, block]}];
      } else {
        return [...units, {kind: KeepUnitKind.FLOW, nodes: [block]}];
      }
    }
  }, []);
}

function tableRowUnits(table: HTMLTableElement): KeepUnit[] {
  const header = table.tHead;
  const rows = Array.from(table.tBodies.length ? table.tBodies[0].rows : table.rows)
    .filter(row => !header || !header.contains(row));
  if (rows.length === 0) {
    return [{kind: KeepUnitKind.KEEP, nodes: [table]}];
  } else {
    return rows.map(row => ({kind: KeepUnitKind.TABLE_ROW, nodes: [row], table, header, row}));
  }
}

export function paginateKeepTogether(units: KeepUnit[], availableHeight: number, heightOf: (nodes: HTMLElement[]) => number): KeepUnit[][] {
  return units.reduce((pages: KeepUnit[][], unit) => {
    if (unit.kind === KeepUnitKind.BREAK) {
      if (pages[pages.length - 1].length > 0) {
        return [...pages, []];
      } else {
        return pages;
      }
    } else {
      const current = pages[pages.length - 1];
      const height = heightOf(unit.nodes);
      const combined = heightOf([...current.flatMap(item => item.nodes), ...unit.nodes]);
      if (height > availableHeight) {
        const parts = splitOversizedUnit(unit, availableHeight, heightOf);
        const start = current.length === 0 ? pages : [...pages, []];
        return parts.reduce((acc, part) => {
          const last = acc[acc.length - 1];
          const partHeight = heightOf(part.nodes);
          const partUsed = heightOf(last.flatMap(item => item.nodes));
          if (last.length === 0 || partUsed + partHeight <= availableHeight) {
            last.push(part);
            return acc;
          } else {
            return [...acc, [part]];
          }
        }, start);
      } else if (current.length === 0 || combined <= availableHeight) {
        current.push(unit);
        return pages;
      } else {
        return [...pages, [unit]];
      }
    }
  }, [[]] as KeepUnit[][]).filter(page => page.length > 0);
}

function splitOversizedUnit(unit: KeepUnit, availableHeight: number, heightOf: (nodes: HTMLElement[]) => number): KeepUnit[] {
  if (unit.nodes.length <= 1) {
    return splitOversizedBlock(unit.nodes[0], availableHeight, heightOf).map(node => ({...unit, nodes: [node], row: unit.row ? node as HTMLTableRowElement : null}));
  } else {
    return unit.nodes.flatMap(node => splitOversizedBlock(node, availableHeight, heightOf)).reduce((parts: KeepUnit[], node) => {
      const last = parts[parts.length - 1];
      const candidate = [...last.nodes, node];
      if (last.nodes.length === 0 || heightOf(candidate) <= availableHeight) {
        last.nodes.push(node);
        return parts;
      } else {
        return [...parts, {kind: KeepUnitKind.FLOW, nodes: [node]}];
      }
    }, [{kind: unit.kind, nodes: [] as HTMLElement[]}]).filter(part => part.nodes.length > 0);
  }
}

export function bookletSpreads<T>(pages: T[]): T[][] {
  const padded = pages.length % 2 === 0 ? pages : [...pages, null as T];
  return padded.reduce((spreads: T[][], page, index) => {
    if (index % 2 === 0) {
      return [...spreads, [page, padded[index + 1]]];
    } else {
      return spreads;
    }
  }, []);
}

function splitOversizedBlock(block: HTMLElement, availableHeight: number, heightOf: (nodes: HTMLElement[]) => number): HTMLElement[] {
  if (!block || heightOf([block]) <= availableHeight) {
    return block ? [block] : [];
  } else {
    const document = block.ownerDocument;
    const walker = document.createTreeWalker(block, 4);
    const textNodes: Node[] = [];
    const collect = (): void => {
      const node = walker.nextNode();
      if (node) {
        textNodes.push(node);
        collect();
      }
    };
    collect();
    const boundaries = textNodes.flatMap(node => [...(node.textContent || "").matchAll(/\S+\s*/g)].map(match => ({node, offset: match.index + match[0].length})));
    const state = {startNode: block as Node, startOffset: 0};
    const fragment = (end: number): HTMLElement => {
      const range = document.createRange();
      range.setStart(state.startNode, state.startOffset);
      if (end === boundaries.length - 1) {
        range.setEnd(block, block.childNodes.length);
      } else {
        range.setEnd(boundaries[end].node, boundaries[end].offset);
      }
      const clone = block.cloneNode(false) as HTMLElement;
      clone.appendChild(range.cloneContents());
      return clone;
    };
    const fittingEnd = (low: number, high: number): number => {
      if (low >= high) {
        return low;
      } else {
        const middle = Math.ceil((low + high) / 2);
        return heightOf([fragment(middle)]) <= availableHeight ? fittingEnd(middle, high) : fittingEnd(low, middle - 1);
      }
    };
    const appendParts = (start: number): HTMLElement[] => {
      const end = fittingEnd(start, boundaries.length - 1);
      const part = fitIndivisibleBlock(fragment(end), availableHeight, heightOf);
      if (end === boundaries.length - 1) {
        return [part];
      } else {
        state.startNode = boundaries[end].node;
        state.startOffset = boundaries[end].offset;
        return [part, ...appendParts(end + 1)];
      }
    };
    return boundaries.length ? appendParts(0) : [fitIndivisibleBlock(block, availableHeight, heightOf)];
  }
}

function fitIndivisibleBlock(block: HTMLElement, availableHeight: number, heightOf: (nodes: HTMLElement[]) => number): HTMLElement {
  const height = heightOf([block]);
  if (height > availableHeight) {
    const fitted = block.cloneNode(true) as HTMLElement;
    fitted.style.setProperty("zoom", String(availableHeight / height));
    return fitted;
  } else {
    return block;
  }
}
