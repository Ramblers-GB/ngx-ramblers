export function neutraliseUnresolvedMergeFieldUrls(html: string): string {
  if (!html) {
    return html;
  } else {
    return html
      .replace(/\s(?:href|src)\s*=\s*(["'])\s*\{\{\s*[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*\s*\}\}\s*\1/gi, "")
      .replace(/\s(?:href|src)\s*=\s*(["'])#view-in-browser\1/gi, "");
  }
}
