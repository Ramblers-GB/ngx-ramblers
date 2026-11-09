export const SYSTEM_LOG_LIMIT = 500;
export const SYSTEM_LOG_PREFIX_LIMIT = 16;

export interface SystemLogLine {
  at: number;
  namespace: string;
  prefix: string;
  text: string;
}

export interface SystemLogPayload {
  lines?: SystemLogLine[];
  line?: SystemLogLine;
}

export function systemLogPrefix(namespace: string): string {
  const namespaced = namespace.match(/ngx-ramblers:[^:]+:(\S+)/);
  if (namespaced) {
    return namespaced[1];
  } else {
    return namespace.replace(/^ngx-ramblers:[^:]+:/, "");
  }
}

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI_SEQUENCE = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, "g");
const ANSI_OSC = new RegExp(`${ESC}\\][^${BEL}]*${BEL}`, "g");
const ANSI_SGR = new RegExp(`^${ESC}\\[([0-9;]*)m$`);

export function stripAnsi(value: string): string {
  return value.replace(ANSI_SEQUENCE, "").replace(ANSI_OSC, "");
}

const ANSI_FOREGROUND: Record<string, string> = {
  "30": "#1e293b",
  "31": "#ef4444",
  "32": "#4ade80",
  "33": "#facc15",
  "34": "#60a5fa",
  "35": "#e879f9",
  "36": "#22d3ee",
  "37": "#e2e8f0",
  "90": "#94a3b8",
  "91": "#f87171",
  "92": "#86efac",
  "93": "#fde047",
  "94": "#93c5fd",
  "95": "#f0abfc",
  "96": "#67e8f9",
  "97": "#f8fafc"
};

export function ansiHtml(value: string): string {
  const parts = value.split(new RegExp(`(${ESC}\\[[0-9;]*m)`));
  const style = {css: [] as string[]};
  return parts.map(part => {
    const codes = part.match(ANSI_SGR);
    if (codes) {
      style.css = cssFromAnsiCodes(codes[1], style.css);
      return "";
    } else if (!part) {
      return "";
    } else if (style.css.length) {
      return `<span style="${style.css.join(";")}">${escapeHtml(part)}</span>`;
    } else {
      return escapeHtml(part);
    }
  }).join("");
}

function cssFromAnsiCodes(joined: string, current: string[]): string[] {
  const codes = joined.length ? joined.split(";") : ["0"];
  return codes.reduce((styles: string[], code) => {
    if (code === "0" || code === "") {
      return [];
    } else if (code === "1") {
      return [...styles.filter(item => !item.startsWith("font-weight")), "font-weight:700"];
    } else if (code === "22") {
      return styles.filter(item => !item.startsWith("font-weight"));
    } else if (code === "39") {
      return styles.filter(item => !item.startsWith("color"));
    } else if (ANSI_FOREGROUND[code]) {
      return [...styles.filter(item => !item.startsWith("color")), `color:${ANSI_FOREGROUND[code]}`];
    } else {
      return styles;
    }
  }, current);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
