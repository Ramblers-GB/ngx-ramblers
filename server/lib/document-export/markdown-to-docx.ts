import {fetchPublicSiteImage} from "../site-registration/public-site-fetch";
import {DocumentAppearance, documentAppearance} from "../../../projects/ngx-ramblers/src/app/models/document-appearance.model";
import * as fs from "fs";
import sharp, {OverlayOptions} from "sharp";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  WidthType
} from "docx";
import {encodeMarkdownLinkUrls} from "../../../projects/ngx-ramblers/src/app/functions/markdown";
import {JSDOM} from "jsdom";
import {CommitteeDocumentLayout, DocumentExportRequest} from "../../../projects/ngx-ramblers/src/app/models/committee.model";
import {ramblersLegalBoilerplate} from "../../../projects/ngx-ramblers/src/app/models/ramblers-legal.model";
import {renderMarkdownToHtml} from "../shared/markdown-renderer";
import {resolveClientPath} from "../shared/path-utils";
import {objectBufferForKey} from "../aws/aws-controllers";
import {S3_BASE_URL} from "../../../projects/ngx-ramblers/src/app/models/content-metadata.model";

const SUNRISE = "F9B104";
const CHARCOAL = "404141";
const MUTED = "6C757D";
const LINK = "C05711";
const A4 = {width: 11906, height: 16838};
const A5 = {width: 8391, height: 11906};
const TWIPS_PER_PIXEL = 15;
const PAPERCUT_RATIO = 385 / 1600;
const NONE_BORDER = {style: BorderStyle.NONE, size: 0, color: "FFFFFF"};
const NO_BORDERS = {top: NONE_BORDER, bottom: NONE_BORDER, left: NONE_BORDER, right: NONE_BORDER};

export interface DocumentExportBranding {
  groupName: string;
  groupHref: string;
  contactEmail: string;
  logo: Buffer | null;
}

type DocChild = Paragraph | Table;
type RunChild = TextRun | ExternalHyperlink | ImageRun;

export async function markdownToDocx(request: DocumentExportRequest, branding: DocumentExportBranding, appearance = documentAppearance(null)): Promise<Buffer> {
  const layout = request.layout || CommitteeDocumentLayout.A4_PORTRAIT;
  const page = layout === CommitteeDocumentLayout.A5_PORTRAIT || layout === CommitteeDocumentLayout.A5_BOOKLET ? A5 : A4;
  const a4 = layout === CommitteeDocumentLayout.A4_PORTRAIT;
  const pageWidthPx = Math.round(page.width / TWIPS_PER_PIXEL);
  const headerHeightPx = appearance.showLetterhead ? Math.round(pageWidthPx * PAPERCUT_RATIO) : 0;
  const header = appearance.showLetterhead ? await headerImage(pageWidthPx, headerHeightPx, branding, appearance) : null;
  const regulator = appearance.showRegulator ? await regulatorImage() : null;
  const contentWidth = page.width - 1440;
  const children = await bodyParagraphs(request.markdown || "", request.title || "", Math.max(50, Math.min(request.imageHeight || 240, 800)), branding.groupHref, Math.round(contentWidth / TWIPS_PER_PIXEL));
  const document = new Document({
    styles: {
      default: {
        document: {
          run: {font: "Calibri", size: a4 ? 22 : 20, color: CHARCOAL}
        }
      },
      paragraphStyles: [
        headingStyle("Heading1", "Heading 1", a4 ? 44 : 36, 0, 360, 80),
        headingStyle("Heading2", "Heading 2", a4 ? 32 : 28, 1, 280, 60),
        headingStyle("Heading3", "Heading 3", a4 ? 26 : 24, 2, 200, 40)
      ],
      characterStyles: [{
        id: "Hyperlink",
        name: "Hyperlink",
        basedOn: "DefaultParagraphFont",
        run: {color: LINK, underline: {type: UnderlineType.SINGLE, color: LINK}}
      }]
    },
    numbering: {
      config: [{
        reference: "programme-bullets",
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: "•",
          alignment: AlignmentType.LEFT,
          style: {paragraph: {indent: {left: 720, hanging: 360}}}
        }]
      }, {
        reference: "programme-numbers",
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: "%1.",
          alignment: AlignmentType.LEFT,
          style: {paragraph: {indent: {left: 720, hanging: 360}}}
        }]
      }]
    },
    sections: [{
      properties: {
        page: {
          size: {width: page.width, height: page.height},
          margin: {
            top: headerHeightPx * TWIPS_PER_PIXEL + 120,
            right: 720,
            bottom: 900,
            left: 720,
            header: 0,
            footer: 120
          }
        }
      },
      headers: {
        default: new Header({
          children: [header
            ? imageParagraph(header, pageWidthPx, headerHeightPx, branding.groupName, undefined, {left: -720, right: -720})
            : new Paragraph({children: []})]
        })
      },
      footers: {
        default: new Footer({children: [await footerTable(branding, regulator, contentWidth, appearance)]})
      },
      children
    }]
  });
  return Packer.toBuffer(document);
}

function headingStyle(id: string, name: string, size: number, outlineLevel: number, before: number, after: number) {
  return {
    id,
    name,
    basedOn: "Normal",
    next: "Normal",
    quickFormat: true,
    run: {
      size,
      bold: true,
      font: "Calibri",
      color: CHARCOAL
    },
    paragraph: {
      spacing: {before, after},
      outlineLevel,
      border: {bottom: {style: BorderStyle.SINGLE, size: 48, color: SUNRISE, space: 1}}
    }
  };
}

async function headerImage(width: number, height: number, branding: DocumentExportBranding, appearance: DocumentAppearance): Promise<Buffer | null> {
  const papercut = appearance.headerImage ? await objectBufferForKey(appearance.headerImage) : readAsset([
    "projects/ngx-ramblers/src/app/assets/images/ramblers/committee-document-papercut.png",
    "dist/ngx-ramblers/assets/images/ramblers/committee-document-papercut.png"
  ]);
  if (!papercut) {
    return null;
  } else {
    const wave = await sharp(papercut).resize(width, height, {fit: "cover"}).png().toBuffer();
    const layers: OverlayOptions[] = [{input: wave, top: 0, left: 0}];
    const mark = appearance.showLogo ? await headerMark(width, height, branding) : null;
    if (mark) {
      layers.push(mark);
    }
    return sharp({
      create: {width, height, channels: 4, background: {r: 255, g: 255, b: 255, alpha: 1}}
    }).composite(layers).png().toBuffer();
  }
}

async function headerMark(width: number, height: number, branding: DocumentExportBranding): Promise<OverlayOptions | null> {
  const logoHeight = Math.round(height * 0.55);
  const left = Math.max(Math.round(width * 0.06), 24);
  const top = Math.max(height - logoHeight - Math.round(height * 0.02), 0);
  if (branding.logo) {
    const meta = await sharp(branding.logo).metadata();
    const ratio = (meta.width || 1) / (meta.height || 1);
    const logoWidth = Math.round(logoHeight * ratio);
    const input = await sharp(branding.logo).resize(logoWidth, logoHeight, {fit: "inside"}).png().toBuffer();
    return {input, left, top};
  } else {
    const fontSize = Math.max(Math.round(logoHeight * 0.38), 18);
    const textWidth = Math.min(width - left - 16, Math.max(branding.groupName.length * fontSize * 0.6, 120));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${textWidth}" height="${logoHeight}"><text x="0" y="${Math.round(logoHeight * 0.72)}" font-family="Calibri,Arial,Helvetica,sans-serif" font-size="${fontSize}" font-weight="700" fill="#404141">${escapeXml(branding.groupName)}</text></svg>`;
    return {input: Buffer.from(svg), left, top};
  }
}

async function regulatorImage(): Promise<Buffer | null> {
  const png = readAsset([
    "projects/ngx-ramblers/src/app/assets/images/local/fr-regulator-logo.png",
    "dist/ngx-ramblers/assets/images/local/fr-regulator-logo.png"
  ]);
  const svg = readAsset([
    "projects/ngx-ramblers/src/app/assets/images/local/fr-regulator-colour.svg",
    "dist/ngx-ramblers/assets/images/local/fr-regulator-colour.svg"
  ]);
  if (svg) {
    return sharp(svg).resize(280, 80, {fit: "inside"}).png().toBuffer();
  } else if (png) {
    return sharp(png).resize(280, 80, {fit: "inside"}).png().toBuffer();
  } else {
    return null;
  }
}

async function footerTable(branding: DocumentExportBranding, regulator: Buffer | null, contentWidth: number, appearance: DocumentAppearance): Promise<Table> {
  const textWidth = regulator ? Math.round(contentWidth * 0.72) : contentWidth;
  const markWidth = contentWidth - textWidth;
  const contactLine = footerContactRuns({...branding, contactEmail: appearance.showContactEmail ? appearance.contactEmail || branding.contactEmail : "", groupHref: appearance.showWebsite ? branding.groupHref : ""});
  const extra = appearance.footerMarkdown ? await htmlToBlocks(renderMarkdownToHtml(appearance.footerMarkdown), false, 120) : [];
  const children: TableCell[] = [
    new TableCell({
      width: {size: textWidth, type: WidthType.DXA},
      borders: NO_BORDERS,
      margins: {top: 40, bottom: 40, left: 0, right: 120},
      children: [
        new Paragraph({children: [new TextRun({text: appearance.showGroupName ? branding.groupName : "", bold: true, size: 16, color: CHARCOAL})]}),
        new Paragraph({children: contactLine}),
        ...extra,
        new Paragraph({children: [new TextRun({text: appearance.showLegal ? ramblersLegalBoilerplate() : "", size: 14, color: MUTED})]})
      ]
    })
  ];
  if (regulator) {
    children.push(new TableCell({
      width: {size: markWidth, type: WidthType.DXA},
      borders: NO_BORDERS,
      margins: {top: 40, bottom: 40, left: 80, right: 0},
      children: [imageParagraph(regulator, 140, 40, "Registered with Fundraising Regulator", AlignmentType.RIGHT)]
    }));
  }
  return new Table({
    width: {size: contentWidth, type: WidthType.DXA},
    columnWidths: regulator ? [textWidth, markWidth] : [textWidth],
    borders: NO_BORDERS,
    rows: [new TableRow({children})]
  });
}

function footerContactRuns(branding: DocumentExportBranding): RunChild[] {
  const href = (branding.groupHref || "").replace(/^https?:\/\//, "");
  const runs: RunChild[] = [];
  if (branding.contactEmail) {
    runs.push(new ExternalHyperlink({
      link: `mailto:${branding.contactEmail}`,
      children: [new TextRun({text: branding.contactEmail, bold: true, size: 16, color: CHARCOAL, style: "Hyperlink"})]
    }));
  }
  if (branding.contactEmail && href) {
    runs.push(new TextRun({text: " | ", size: 16, color: CHARCOAL}));
  }
  if (href) {
    runs.push(new ExternalHyperlink({
      link: branding.groupHref || `https://${href}`,
      children: [new TextRun({text: href, bold: true, size: 16, color: CHARCOAL, style: "Hyperlink"})]
    }));
  }
  if (runs.length === 0) {
    return [new TextRun({text: "", size: 16})];
  } else {
    return runs;
  }
}

function imageParagraph(
  data: Buffer,
  width: number,
  height: number,
  name: string,
  alignment?: (typeof AlignmentType)[keyof typeof AlignmentType],
  indent?: {left: number; right: number}
): Paragraph {
  return new Paragraph({
    alignment,
    indent,
    spacing: {before: 0, after: 0},
    children: [new ImageRun({
      type: "png",
      data,
      transformation: {width, height},
      altText: {name, description: name}
    })]
  });
}

async function bodyParagraphs(markdown: string, title: string, imageHeight: number, publicBaseUrl: string, imageWidth: number): Promise<DocChild[]> {
  const pages = (markdown || "").split(/^[ \t]*PAGEBREAK[ \t]*$/gmi);
  const titled = /^#{1,2}\s/.test(markdown.trimStart());
  const titleBlock = titled ? [] : [headingParagraph(title, HeadingLevel.HEADING_1)];
  return pages.reduce(async (previous, page, index) => {
    const accumulated = await previous;
    const html = new JSDOM(renderMarkdownToHtml(encodeMarkdownLinkUrls(page)));
    if (publicBaseUrl) {
      Array.from(html.window.document.querySelectorAll("a[href]")).forEach(anchor => {
        const href = anchor.getAttribute("href") || "";
        if (/^(?:\/(?!\/)|https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/)/i.test(href)) {
          const path = href.replace(/^https?:\/\/[^/]+/i, "");
          anchor.setAttribute("href", new URL(path, publicBaseUrl).href);
        }
      });
    }
    const converted = await htmlToBlocks(html.window.document.body.innerHTML, false, imageHeight, imageWidth);
    if (index === 0) {
      return [...titleBlock, ...accumulated, ...converted];
    } else {
      return [...accumulated, new Paragraph({children: [new PageBreak()]}), ...converted];
    }
  }, Promise.resolve([] as DocChild[]));
}

function headingParagraph(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({
    heading: level,
    keepNext: true,
    keepLines: true,
    border: {bottom: {style: BorderStyle.SINGLE, size: 48, color: SUNRISE, space: 1}},
    children: [new TextRun({text, bold: true, color: CHARCOAL})]
  });
}

async function htmlToBlocks(html: string, keepTogether: boolean, imageHeight: number, imageWidth = 480): Promise<DocChild[]> {
  const dom = new JSDOM(`<body>${html}</body>`);
  return Array.from(dom.window.document.body.childNodes).reduce(async (previous, node) => {
    const accumulated = await previous;
    return [...accumulated, ...(await htmlNodeToBlocks(node, keepTogether, imageHeight, imageWidth))];
  }, Promise.resolve([] as DocChild[]));
}

async function htmlNodeToBlocks(node: ChildNode, keepTogether: boolean, imageHeight: number, imageWidth: number): Promise<DocChild[]> {
  if (node.nodeType !== 1) {
    const text = (node.textContent || "").trim();
    if (text) {
      return [new Paragraph({children: [new TextRun({text, color: CHARCOAL})], keepLines: keepTogether})];
    } else {
      return [];
    }
  } else {
    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();
    const together = keepTogether || element.classList.contains("committee-document-keep") || element.classList.contains("committee-document-title-block");
    if (["div", "section", "article", "figure"].includes(tag)) {
      return Array.from(element.childNodes).reduce(async (previous, child) => {
        const accumulated = await previous;
        return [...accumulated, ...(await htmlNodeToBlocks(child, together, imageHeight, imageWidth))];
      }, Promise.resolve([] as DocChild[]));
    } else if (tag === "h1" || tag === "h2" || tag === "h3") {
      const level = tag === "h1" ? HeadingLevel.HEADING_1 : tag === "h2" ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      return [headingParagraph(element.textContent || "", level)];
    } else if (tag === "table") {
      return [await htmlTable(element, together, imageHeight, imageWidth)];
    } else if (tag === "ul" || tag === "ol") {
      return Promise.all(Array.from(element.children).map(async item => new Paragraph({
        keepLines: together,
        numbering: {reference: tag === "ol" ? "programme-numbers" : "programme-bullets", level: 0},
        children: await runsWithImages(item as HTMLElement, imageHeight, imageWidth)
      })));
    } else if (tag === "p" || tag === "blockquote") {
      return [new Paragraph({
        children: await runsWithImages(element, imageHeight, imageWidth),
        keepLines: together,
        keepNext: together,
        spacing: {after: 160},
        border: tag === "blockquote" ? {left: {style: BorderStyle.SINGLE, size: 12, color: SUNRISE, space: 8}} : undefined
      })];
    } else if (tag === "img") {
      const image = await imageFrom(element.getAttribute("src") || "", imageHeight, imageWidth);
      if (image) {
        return [new Paragraph({children: [image], keepLines: together, spacing: {after: 160}})];
      } else {
        return [];
      }
    } else {
      const text = (element.textContent || "").trim();
      if (text) {
        return [new Paragraph({children: runsFrom(element), keepLines: together})];
      } else {
        return [];
      }
    }
  }
}

async function htmlTable(table: HTMLElement, keepTogether: boolean, imageHeight: number, imageWidth: number): Promise<Table> {
  const rows = Array.from((table as HTMLTableElement).rows);
  const columns = Math.max(...rows.map(row => row.children.length), 1);
  const width = Math.round(imageWidth * TWIPS_PER_PIXEL);
  const columnWidth = Math.round(width / columns);
  const cellBorder = {style: BorderStyle.SINGLE, size: 4, color: "DEE2E6"};
  const borders = {top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder};
  return new Table({
    width: {size: width, type: WidthType.DXA},
    columnWidths: Array.from({length: columns}, () => columnWidth),
    rows: await Promise.all(rows.map(async row => new TableRow({
      cantSplit: true,
      children: await Promise.all(Array.from(row.children).map(async cell => {
        const hasBlocks = Array.from(cell.children).some(child => ["P", "DIV", "TABLE", "UL", "OL", "H1", "H2", "H3", "BLOCKQUOTE"].includes(child.tagName));
        const html = hasBlocks ? cell.innerHTML : `<p>${cell.innerHTML}</p>`;
        return new TableCell({
        width: {size: columnWidth, type: WidthType.DXA},
        borders,
        margins: {top: 60, bottom: 60, left: 80, right: 80},
        children: await htmlToBlocks(html, keepTogether, imageHeight, Math.max(1, Math.floor(imageWidth / columns) - 12))
        });
      }))
    })))
  });
}

async function runsWithImages(element: HTMLElement, imageHeight: number, imageWidth: number): Promise<RunChild[]> {
  const images = await Promise.all(Array.from(element.querySelectorAll("img")).map(image => imageFrom(image.getAttribute("src") || "", imageHeight, imageWidth)));
  return [...runsFrom(element), ...images.filter(Boolean)];
}

function runsFrom(element: HTMLElement): RunChild[] {
  const parts = flattenText(element);
  if (parts.length) {
    return parts;
  } else {
    return [new TextRun({text: ""})];
  }
}

function flattenText(node: ChildNode, marks: {bold?: boolean; italics?: boolean} = {}): RunChild[] {
  if (node.nodeType !== 1) {
    const text = node.textContent || "";
    if (text) {
      return [new TextRun({text, bold: marks.bold, italics: marks.italics, color: CHARCOAL})];
    } else {
      return [];
    }
  } else {
    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();
    const next = {
      bold: marks.bold || tag === "strong" || tag === "b",
      italics: marks.italics || tag === "em" || tag === "i"
    };
    if (tag === "br") {
      return [new TextRun({break: 1})];
    } else if (tag === "a") {
      const label = (element.textContent || "").trim();
      const href = element.getAttribute("href") || "";
      if (label && href) {
        return [new ExternalHyperlink({
          link: href,
          children: [new TextRun({text: label, bold: next.bold, color: LINK, style: "Hyperlink"})]
        })];
      } else if (label) {
        return [new TextRun({text: label, bold: next.bold, color: CHARCOAL})];
      } else {
        return [];
      }
    } else {
      return Array.from(element.childNodes).flatMap(child => flattenText(child, next));
    }
  }
}

async function imageFrom(src: string, imageHeight: number, imageWidth: number): Promise<ImageRun | null> {
  const buffer = await imageBuffer(src);
  if (!buffer) {
    return null;
  } else {
    const width = imageWidth;
    const height = imageHeight;
    const png = await sharp(buffer).resize(width, height, {fit: "cover"}).png().toBuffer();
    return new ImageRun({
      type: "png",
      data: png,
      transformation: {width, height},
      altText: {name: "Event image", description: "Event image"}
    });
  }
}

async function imageBuffer(src: string): Promise<Buffer | null> {
  const keyMatch = src.match(new RegExp(`${S3_BASE_URL}/(.+)$`, "i"));
  if (keyMatch) {
    try {
      return await objectBufferForKey(keyMatch[1]);
    } catch {
      return null;
    }
  } else if (/^https?:\/\//i.test(src)) {
    return fetchPublicSiteImage(src);
  } else {
    return null;
  }
}

function readAsset(candidates: string[]): Buffer | null {
  const match = candidates.map(candidate => resolveClientPath(candidate)).find(file => fs.existsSync(file));
  if (match) {
    return fs.readFileSync(match);
  } else {
    return null;
  }
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
