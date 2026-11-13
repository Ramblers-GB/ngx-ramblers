import { JSONContent, MarkdownParseHelpers, MarkdownRendererHelpers, MarkdownToken } from "@tiptap/core";
import {Table, TableCell, renderTableToMarkdown} from "@tiptap/extension-table";
import {isArray} from "es-toolkit/compat";

function cellNodes(node: JSONContent): JSONContent[] {
  return (node.content || []).flatMap(row => row.content || []);
}

function tableNeedsHtmlMarkdown(node: JSONContent): boolean {
  const role = node.attrs?.["role"];
  return role === "presentation" || cellNodes(node).some(cell => Number(cell.attrs?.["colspan"] || 1) > 1
    || !!cell.attrs?.["align"]
    || !!cell.attrs?.["textAlign"]
    || (cell.content || []).some(child => child.type === "horizontalRule"));
}

function cellInnerMarkdown(node: JSONContent, renderChildren: (child: JSONContent) => string): string {
  return (node.content || []).map(child => {
    if (child.type === "horizontalRule") {
      return "<hr>";
    } else {
      return renderChildren(child).trim().replace(/ *\n+/g, "<br>").replace(/<strong>\s*<\/strong>/g, "");
    }
  }).filter(value => value).join("");
}

function htmlAttribute(name: string, value: string | number | null | undefined): string {
  return value ? ` ${name}="${value}"` : "";
}

function htmlTableCellStyle(cell: JSONContent): string {
  const align = cell.attrs?.["textAlign"] || cell.attrs?.["align"];
  const existing = (cell.attrs?.["style"] || "").trim();
  const parts = [existing, align && !/text-align\s*:/i.test(existing) ? `text-align:${align}` : ""]
    .filter(part => part);
  return parts.length ? ` style="${parts.join(";")}"` : "";
}

function paragraphText(node: JSONContent): string {
  return (node.content || []).map(child => child.text || "").join("");
}

function cellIsRule(cell: JSONContent): boolean {
  const content = cell.content || [];
  return content.length > 0 && content.every(child => child.type === "horizontalRule"
    || (child.type === "paragraph" && isRuleText(paragraphText(child))));
}

function rowIsRule(row: JSONContent): boolean {
  const cells = row.content || [];
  return cells.length > 0 && cells.every(cell => cellIsRule(cell) || !(cell.content || []).length) && cells.some(cellIsRule);
}

function renderHtmlTable(node: JSONContent, renderChildren: (child: JSONContent) => string): string {
  const role = node.attrs?.["role"];
  const columnCount = Math.max(1, ...(node.content || []).map(row => (row.content || []).reduce((count, cell) => count + Math.max(Number(cell.attrs?.["colspan"] || 1), 1), 0)));
  const rows = (node.content || []).map(row => {
    if (rowIsRule(row)) {
      return `<tr><td colspan="${columnCount}"><hr></td></tr>`;
    } else {
      const cells = (row.content || []).map(cell => {
        const tag = cell.type === "tableHeader" ? "th" : "td";
        const span = Number(cell.attrs?.["colspan"] || 1);
        const style = htmlTableCellStyle(cell);
        const width = cell.attrs?.["width"];
        return `<${tag}${span > 1 ? htmlAttribute("colspan", span) : ""}${htmlAttribute("width", width)}${style}>${cellInnerMarkdown(cell, renderChildren)}</${tag}>`;
      }).join("");
      return `<tr>${cells}</tr>`;
    }
  }).join("");
  const tableStyle = node.attrs?.["style"];
  return `<table${htmlAttribute("role", role)} width="100%"${tableStyle ? htmlAttribute("style", tableStyle) : ""}>${rows}</table>`;
}

function withMarks(nodes: JSONContent[], marks: JSONContent["marks"]): JSONContent[] {
  if (!marks?.length) {
    return nodes;
  } else {
    return nodes.map(node => ({...node, marks: [...(node.marks || []), ...marks]}));
  }
}

function isRuleText(value: string): boolean {
  return /^\s*-{3,}\s*$/.test(value);
}

function inlineNodesFromCell(host: ParentNode, helpers: MarkdownParseHelpers, marks: JSONContent["marks"] = []): JSONContent[] {
  return Array.from(host.childNodes).flatMap(node => {
    if (node.nodeName === "BR") {
      return withMarks([{type: "hardBreak"}], marks);
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      const tokens = helpers.tokenizeInline ? helpers.tokenizeInline(text) : [{type: "text", text, raw: text}];
      return withMarks(helpers.parseInline(tokens), marks);
    } else {
      const element = node as HTMLElement;
      if (/^(STRONG|B)$/.test(element.tagName)) {
        return inlineNodesFromCell(element, helpers, [...marks, {type: "bold"}]);
      } else if (/^(EM|I)$/.test(element.tagName)) {
        return inlineNodesFromCell(element, helpers, [...marks, {type: "italic"}]);
      } else if (element.tagName === "A") {
        const href = element.getAttribute("href") || "";
        return withMarks(inlineNodesFromCell(element, helpers, marks), href ? [{type: "link", attrs: {href}}] : []);
      } else {
        return inlineNodesFromCell(element, helpers, marks);
      }
    }
  });
}

function blocksFromCell(cell: HTMLTableCellElement, helpers: MarkdownParseHelpers): JSONContent[] {
  const blocks: JSONContent[] = [];
  const pending: JSONContent[] = [];
  const flushParagraph = () => {
    if (pending.length) {
      blocks.push(helpers.createNode("paragraph", {}, pending.splice(0)));
    }
  };
  Array.from(cell.childNodes).forEach(node => {
    const text = node.textContent || "";
    if (node.nodeName === "HR" || (node.nodeType === Node.TEXT_NODE && isRuleText(text))) {
      flushParagraph();
      blocks.push(helpers.createNode("horizontalRule"));
    } else if (node.nodeType === Node.ELEMENT_NODE && isRuleText((node as HTMLElement).textContent || "") && !/(STRONG|B|EM|I|A)/.test((node as HTMLElement).tagName)) {
      flushParagraph();
      blocks.push(helpers.createNode("horizontalRule"));
    } else {
      pending.push(...inlineNodesFromCell({childNodes: [node]} as unknown as ParentNode, helpers));
    }
  });
  flushParagraph();
  const content = blocks.filter(block => block.type === "horizontalRule" || (block.content || []).some(child => child.type !== "hardBreak"));
  return content.length ? content : [helpers.createNode("paragraph", {}, [])];
}

function alignmentFromCell(element: HTMLTableCellElement): string | null {
  const style = (element.getAttribute("style") || "").toLowerCase();
  const align = (element.align || element.getAttribute("align") || "").toLowerCase();
  if (style.includes("text-align:right") || align === "right") {
    return "right";
  } else if (style.includes("text-align:center") || align === "center") {
    return "center";
  } else if (style.includes("text-align:justify") || align === "justify") {
    return "justify";
  } else if (style.includes("text-align:left") || align === "left") {
    return "left";
  } else {
    return null;
  }
}

export const ProgrammeTableCell = TableCell.extend({
  content: "(paragraph | horizontalRule)+",
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: {
        default: null,
        parseHTML: element => alignmentFromCell(element as HTMLTableCellElement),
        renderHTML: attributes => {
          const align = attributes["textAlign"] || attributes["align"];
          return align ? {style: `text-align: ${align}`} : {};
        }
      },
      style: {
        default: null,
        parseHTML: element => element.getAttribute("style"),
        renderHTML: attributes => attributes["style"] ? {style: attributes["style"]} : {}
      },
      width: {
        default: null,
        parseHTML: element => element.getAttribute("width"),
        renderHTML: attributes => attributes["width"] ? {width: attributes["width"]} : {}
      }
    };
  }
});

export const ProgrammeTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      role: {
        default: null,
        parseHTML: element => element.getAttribute("role"),
        renderHTML: attributes => attributes["role"] ? {role: attributes["role"]} : {}
      },
      style: {
        default: null,
        parseHTML: element => element.getAttribute("style"),
        renderHTML: attributes => attributes["style"] ? {style: attributes["style"]} : {}
      }
    };
  },
  markdownTokenizer: {
    name: "table",
    level: "block" as const,
    start: (source: string) => {
      const htmlIndex = source.search(/<table\b/i);
      if (htmlIndex >= 0 && !source.slice(0, htmlIndex).trim()) {
        return htmlIndex;
      } else {
        const lines = source.split("\n");
        if (lines.length < 2) {
          return -1;
        } else {
          const separator = lines[1];
          if (!/^[ \t|:]*-[ \t|:-]*$/.test(separator) || !separator.includes("|")) {
            return -1;
          } else {
            return lines[0].includes("|") ? 0 : -1;
          }
        }
      }
    },
    tokenize: (source: string) => {
      if (/^\s*<table\b/i.test(source)) {
        const close = source.toLowerCase().indexOf("</table>");
        if (close < 0) {
          return undefined;
        } else {
          return {type: "table", raw: source.slice(0, close + 8), format: "html"};
        }
      } else {
        return undefined;
      }
    }
  },
  parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers) => {
    if (token["format"] === "html" || /<table\b/i.test(token.raw || "")) {
      const document = new DOMParser().parseFromString(token.raw || "", "text/html");
      const table = document.querySelector("table");
      const rows = table ? Array.from(table.rows).map(row => helpers.createNode("tableRow", {}, Array.from(row.cells).map(cell => {
        const align = alignmentFromCell(cell);
        const style = cell.getAttribute("style");
        const width = cell.getAttribute("width");
        const attrs = {
          colspan: Math.max(cell.colSpan || 1, 1),
          ...(align ? {align: align === "justify" ? null : align, textAlign: align} : {}),
          ...(style ? {style} : {}),
          ...(width ? {colwidth: null, width} : {})
        };
        return helpers.createNode("tableCell", attrs, blocksFromCell(cell, helpers));
      }))) : [];
      return helpers.createNode("table", {
        role: table?.getAttribute("role") || null,
        style: table?.getAttribute("style") || null
      }, rows);
    } else {
      const rows: JSONContent[] = [];
      const alignments = isArray(token.align) ? token.align : [];
      if (token.header) {
        rows.push(helpers.createNode("tableRow", {}, token.header.map((cell: any, index: number) => helpers.createNode("tableHeader", alignments[index] ? {align: alignments[index]} : {}, [{
          type: "paragraph",
          content: helpers.parseInline(cell.tokens)
        }]))));
      }
      if (token.rows) {
        token.rows.forEach((row: any[]) => {
          rows.push(helpers.createNode("tableRow", {}, row.map((cell, index) => helpers.createNode("tableCell", alignments[index] ? {align: alignments[index]} : {}, [{
            type: "paragraph",
            content: helpers.parseInline(cell.tokens)
          }]))));
        });
      }
      return helpers.createNode("table", undefined, rows);
    }
  },
  renderMarkdown: (node: JSONContent, helpers: MarkdownRendererHelpers) => {
    if (tableNeedsHtmlMarkdown(node)) {
      return renderHtmlTable(node, child => helpers.renderChildren(child));
    } else {
      return renderTableToMarkdown(node, helpers);
    }
  }
});
