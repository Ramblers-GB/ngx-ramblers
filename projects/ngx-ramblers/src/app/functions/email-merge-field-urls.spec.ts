import { describe, expect, it } from "vitest";
import { hasUnresolvedViewInBrowserLink, neutraliseUnresolvedMergeFieldUrls, pointViewInBrowserLinksAt, viewInBrowserUrlFromDeliveredHtml } from "./email-merge-field-urls";

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

describe("pointViewInBrowserLinksAt", () => {
  it("points a leftover mirror link at the given address and keeps its styling", () => {
    const html = `<a href="{{ mirror }}" style="color: #757575;">View this email in your browser</a>`;
    expect(pointViewInBrowserLinksAt(html, "https://mail.example.org/tr/cl/abc"))
      .toEqual(`<a href="https://mail.example.org/tr/cl/abc" style="color: #757575;">View this email in your browser</a>`);
  });

  it("leaves other merge-field links and ordinary links untouched", () => {
    const html = `<a href="{{ unsubscribe }}">Unsubscribe</a><a href="https://group.example.org.uk/walks">Walks</a>`;
    expect(pointViewInBrowserLinksAt(html, "https://mail.example.org/tr/cl/abc")).toEqual(html);
  });

  it("recognises a leftover mirror link and ignores one already resolved by the mail service", () => {
    expect(hasUnresolvedViewInBrowserLink(`<a href="{{mirror}}">View</a>`)).toBe(true);
    expect(hasUnresolvedViewInBrowserLink(`<a href='#view-in-browser'>View</a>`)).toBe(true);
    expect(hasUnresolvedViewInBrowserLink(`<a href="https://mail.example.org/tr/cl/abc">View</a>`)).toBe(false);
  });
});

describe("viewInBrowserUrlFromDeliveredHtml", () => {
  const sent = `<a href="{{ mirror }}" style="color: #757575;">View this email in your browser</a><a href="https://group.example.org.uk/walks">Walks</a>`;

  it("reads the hosted address the mail service put on the same link", () => {
    const delivered = `<a href="https://mail.example.org/tr/cl/walks">Walks</a><a href="https://mail.example.org/tr/cl/hosted" style="color: #757575;">View this email in your browser</a>`;
    expect(viewInBrowserUrlFromDeliveredHtml(sent, delivered)).toEqual("https://mail.example.org/tr/cl/hosted");
  });

  it("returns nothing when the delivered copy has no matching link", () => {
    expect(viewInBrowserUrlFromDeliveredHtml(sent, `<a href="https://mail.example.org/tr/cl/walks">Walks</a>`)).toBeNull();
  });

  it("returns nothing when the sent copy has no leftover link to resolve", () => {
    expect(viewInBrowserUrlFromDeliveredHtml(`<p>Hello</p>`, `<a href="https://mail.example.org/tr/cl/hosted">View this email in your browser</a>`)).toBeNull();
  });
});
