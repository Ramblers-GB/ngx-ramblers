import * as publicSite from "../site-registration/public-site-fetch";
import {documentAppearance} from "../../../projects/ngx-ramblers/src/app/models/document-appearance.model";
import expect from "expect";
import {describe, it} from "mocha";
import AdmZip from "adm-zip";
import sinon from "sinon";
import sharp from "sharp";
import * as aws from "../aws/aws-controllers";
import {CommitteeDocumentLayout} from "../../../projects/ngx-ramblers/src/app/models/committee.model";
import {markdownToDocx} from "./markdown-to-docx";

describe("programme Word export", () => {
  it("includes the title, intro, a walk heading and a page break", async () => {
    const buffer = await markdownToDocx({
      title: "Winter programme",
      markdown: "Welcome to the winter walks.\n\n## Hillside Park\n\nA riverside walk.\n\nPAGEBREAK\n\n## Woodland trail\n\nThrough the woods.",
      layout: CommitteeDocumentLayout.A5_BOOKLET
    }, {groupName: "Hillside Park Ramblers", groupHref: "https://group.example.org.uk", contactEmail: "walks@group.example.org.uk", logo: null});
    const zip = new AdmZip(buffer);
    const documentXml = zip.readAsText("word/document.xml");
    const headerXml = zip.readAsText("word/header1.xml");
    const stylesXml = zip.readAsText("word/styles.xml");
    expect(documentXml).toContain("Winter programme");
    expect(documentXml).toContain("Welcome to the winter walks");
    expect(documentXml).toContain("Hillside Park");
    expect(documentXml).toContain("w:br");
    expect(documentXml).not.toContain("w:fill=\"F9B104\"");
    expect(documentXml).toContain("w:sz=\"48\"");
    expect(headerXml).toContain("wp:inline");
    expect(headerXml).toContain("Hillside Park Ramblers");
    expect(stylesXml).toContain("C05711");
    expect(stylesXml).toContain("F9B104");
  });
});

describe("Word export image boundaries", () => {
  const branding = {groupName: "Hillside Park", groupHref: "https://group.example.org.uk", contactEmail: "", logo: null};

  it("embeds a stored Markdown image inside its paragraph", async () => {
    const image = await sharp({create: {width: 8, height: 8, channels: 4, background: "white"}}).png().toBuffer();
    const read = sinon.stub(aws, "objectBufferForKey").resolves(image);
    try {
      const buffer = await markdownToDocx({title: "Programme", markdown: "![Walk photo](/api/aws/s3/site-content/walk.png)", imageHeight: 180}, branding);
      expect(new AdmZip(buffer).readAsText("word/document.xml")).toContain("<w:drawing>");
      expect(new AdmZip(buffer).readAsText("word/document.xml")).toContain('cy="1714500"');
      expect(read.calledWith("site-content/walk.png")).toBe(true);
    } finally {
      read.restore();
    }
  });

  it("does not fetch arbitrary image addresses", async () => {
    const fetch = sinon.stub(globalThis, "fetch").rejects(new Error("Unexpected network request"));
    try {
      await expect(markdownToDocx({title: "Programme", markdown: '<img src="http://127.0.0.1/internal.png">'}, branding)).rejects.toThrow("Use the public HTTP or HTTPS address");
      expect(fetch.called).toBe(false);
    } finally {
      fetch.restore();
    }
  });
});

describe("Word hyperlink destinations", () => {
  it("keeps titles out of URLs and resolves local links against the public site", async () => {
    const buffer = await markdownToDocx({title: "Programme", markdown: '[View walk](http://localhost:4200/our-programme/hillside-loop "View walk")'}, {groupName: "Hillside Park", groupHref: "https://group.example.org.uk", contactEmail: "", logo: null});
    const relationships = new AdmZip(buffer).readAsText("word/_rels/document.xml.rels");
    expect(relationships).toContain('Target="https://group.example.org.uk/our-programme/hillside-loop"');
    expect(relationships).not.toContain("localhost");
    expect(relationships).not.toContain("%22");
  });
});

describe("saved document appearance", () => {
  it("uses footer choices and additional text without affecting public body links", async () => {
    const buffer = await markdownToDocx({title: "Programme", markdown: "[Walk](/our-programme/hillside-loop)"}, {groupName: "Hillside Park", groupHref: "https://group.example.org.uk", contactEmail: "contact@group.example.org.uk", logo: null}, documentAppearance({showLetterhead: false, showContactEmail: false, showWebsite: false, showRegulator: false, showLegal: false, footerMarkdown: "Prepared by the programme team."}));
    const zip = new AdmZip(buffer);
    const footer = zip.readAsText("word/footer1.xml");
    expect(footer).toContain("Prepared by the programme team.");
    expect(footer).toContain("Hillside Park");
    expect(footer).not.toContain("contact@group.example.org.uk");
    expect(footer).not.toContain("Registered office");
    expect(footer).not.toContain("<w:drawing>");
    expect(zip.readAsText("word/header1.xml")).not.toContain("<w:drawing>");
    expect(zip.readAsText("word/_rels/document.xml.rels")).toContain("https://group.example.org.uk/our-programme/hillside-loop");
  });
});

describe("event images in Word tables", () => {
  it("includes stored and public images inside nested event layout tables", async () => {
    const image = await sharp({create: {width: 8, height: 8, channels: 4, background: "white"}}).png().toBuffer();
    const stored = sinon.stub(aws, "objectBufferForKey").resolves(image);
    const remote = sinon.stub(publicSite, "fetchPublicSiteImage").resolves(image);
    try {
      const markdown = '<table><tr><td><table><tr><td><img src="/api/aws/s3/site-content/walk.png"></td><td><p>Walk description</p><img src="https://images.example.org/walk.png"></td></tr></table></td></tr></table>';
      const buffer = await markdownToDocx({title: "Programme", markdown}, {groupName: "Hillside Park", groupHref: "https://group.example.org.uk", contactEmail: "", logo: null});
      const xml = new AdmZip(buffer).readAsText("word/document.xml");
      expect(xml.match(/<w:drawing>/g)).toHaveLength(2);
      expect(xml).toContain("Walk description");
      expect(stored.calledWith("site-content/walk.png")).toBe(true);
      expect(remote.calledWith("https://images.example.org/walk.png")).toBe(true);
    } finally {
      stored.restore();
      remote.restore();
    }
  });
});
