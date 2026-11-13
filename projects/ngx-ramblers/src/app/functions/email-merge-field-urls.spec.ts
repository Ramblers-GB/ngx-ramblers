import { describe, expect, it } from "vitest";
import { neutraliseUnresolvedMergeFieldUrls } from "./email-merge-field-urls";

describe("neutraliseUnresolvedMergeFieldUrls", () => {
  it("removes a Brevo mirror href so a site base tag cannot resolve it", () => {
    const html = `<a href="{{ mirror }}">View this email in your browser</a>`;
    const output = neutraliseUnresolvedMergeFieldUrls(html);
    expect(output).not.toContain("href=");
    expect(output).not.toContain("{{ mirror }}");
  });

  it("removes unsubscribe and other merge-field URLs", () => {
    const html = `<a href="{{ unsubscribe }}">Unsubscribe</a><img src="{{ contact.WEBSITE }}">`;
    const output = neutraliseUnresolvedMergeFieldUrls(html);
    expect(output).not.toContain("href=");
    expect(output).not.toContain("src=");
    expect(output).not.toContain("{{ unsubscribe }}");
    expect(output).not.toContain("{{ contact.WEBSITE }}");
  });

  it("leaves a mirror anchor inert under the inbox base URL and target", () => {
    const html = `<base href="https://group.example.org.uk/" target="_blank"><a href="#view-in-browser">View in browser</a>`;
    const document = new DOMParser().parseFromString(neutraliseUnresolvedMergeFieldUrls(html), "text/html");
    expect(document.querySelector("a")?.hasAttribute("href")).toBe(false);
  });

  it("leaves ordinary site and https links alone", () => {
    const html = `<a href="https://group.example.org.uk/walks">Walks</a><img src="/api/aws/s3/banner.jpg">`;
    expect(neutraliseUnresolvedMergeFieldUrls(html)).toEqual(html);
  });
});
