import { escapeRegExp } from "es-toolkit/compat";

const VIEW_IN_BROWSER_HREF = /(\shref\s*=\s*)(["'])\s*(?:\{\{\s*mirror\s*\}\}|#view-in-browser)\s*\2/gi;
const VIEW_IN_BROWSER_ANCHOR = /<a\b[^>]*\shref\s*=\s*(["'])\s*(?:\{\{\s*mirror\s*\}\}|#view-in-browser)\s*\1[^>]*>([\s\S]*?)<\/a>/i;

export function hasUnresolvedViewInBrowserLink(html: string): boolean {
  return !!html && new RegExp(VIEW_IN_BROWSER_HREF.source, "i").test(html);
}

export function pointViewInBrowserLinksAt(html: string, url: string | null): string {
  if (!html || !url) {
    return html;
  } else {
    return html.replace(VIEW_IN_BROWSER_HREF, (_match, attribute: string, quote: string) => `${attribute}${quote}${url}${quote}`);
  }
}

export function viewInBrowserUrlFromDeliveredHtml(sentHtml: string, deliveredHtml: string): string | null {
  const label = (sentHtml || "").match(VIEW_IN_BROWSER_ANCHOR)?.[2]?.trim();
  if (!label || !deliveredHtml) {
    return null;
  } else {
    const delivered = new RegExp(`<a\\b[^>]*\\shref\\s*=\\s*(["'])(https?://[^"']+)\\1[^>]*>\\s*${escapeRegExp(label)}\\s*</a>`, "i");
    return deliveredHtml.match(delivered)?.[2] ?? null;
  }
}

export function neutraliseUnresolvedMergeFieldUrls(html: string): string {
  if (!html) {
    return html;
  } else {
    return html
      .replace(/\s(?:href|src)\s*=\s*(["'])\s*\{\{\s*[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*\s*\}\}\s*\1/gi, "")
      .replace(/\s(?:href|src)\s*=\s*(["'])#view-in-browser\1/gi, "");
  }
}
