import { describe, expect, it, vi } from "vitest";
import { CommitteeFile } from "../../models/committee.model";
import { CommitteeDisplayService } from "./committee-display.service";

describe("committee file slugs across attachments and composed documents", () => {
  const attachment = {
    id: "6b08bcfefd401e73c2fb7f59",
    fileType: "Council Agenda",
    eventDate: 1796860800000,
    fileNameData: {title: "Agenda", originalFileName: "Agenda.pdf", awsFileName: "agenda.pdf"}
  } as CommitteeFile;
  const composed = {
    id: "6b08c621cf52f1f77c8972ad",
    fileType: "Council Agenda",
    eventDate: 1796860800000,
    document: {title: "Agenda", markdown: "# Agenda"}
  } as CommitteeFile;

  function service(files: CommitteeFile[]): CommitteeDisplayService {
    const display = Object.create(CommitteeDisplayService.prototype) as CommitteeDisplayService;
    display["referenceFilesSource"] = null;
    display["referencesById"] = new Map();
    display["committeeFileService"] = {knownReferenceFiles: vi.fn(() => files)} as unknown as typeof display["committeeFileService"];
    display["legacyCommitteeFileSlug"] = () => "agenda-december-10-2026";
    return display;
  }

  it("gives an attachment and the composed document made from it different slugs", () => {
    const display = service([attachment, composed]);
    expect(display.committeeFileSlug(attachment)).toBe("agenda-december-10-2026");
    expect(display.committeeFileSlug(composed)).toBe("agenda-december-10-2026-2");
  });

  it("opens the composed document from its own slug wherever the page lists the attachment first", () => {
    const display = service([attachment, composed]);
    expect(display.committeeFileMatchingSlug([attachment, composed], "agenda-december-10-2026-2")).toBe(composed);
    expect(display.committeeFileMatchingSlug([attachment, composed], "agenda-december-10-2026")).toBe(attachment);
  });

  it("still opens an older document link when only composed documents are being searched", () => {
    const display = service([attachment, composed]);
    expect(display.committeeFileMatchingSlug([composed], "agenda-december-10-2026")).toBe(composed);
  });
});

describe("committee file email link wording", () => {
  function service(publicTypes: string[]): CommitteeDisplayService {
    const display = Object.create(CommitteeDisplayService.prototype) as CommitteeDisplayService;
    display.committeeReferenceData = {isPublic: (fileType: string) => publicTypes.includes(fileType)} as unknown as typeof display.committeeReferenceData;
    display["urlService"] = {isRemoteUrl: (url: string) => !!url?.startsWith("https://")} as unknown as typeof display["urlService"];
    return display;
  }

  const stored = {id: "file-1", fileType: "Council Agenda", fileNameData: {awsFileName: "agenda.pdf", originalFileName: "Agenda.pdf"}} as CommitteeFile;
  const remote = {id: "file-2", fileType: "Council Agenda", fileNameData: {awsFileName: "https://group.example.org.uk/papers/agenda.pdf"}} as CommitteeFile;

  it("only calls a link a download when it serves a stored public file for saving", () => {
    expect(service(["Council Agenda"]).fileUrlDownloads(stored)).toBe(true);
  });

  it("treats a public file held on another website as something that opens in the browser", () => {
    expect(service(["Council Agenda"]).fileUrlDownloads(remote)).toBe(false);
  });

  it("treats a file that is not public as opening on the document page", () => {
    expect(service([]).fileUrlDownloads(stored)).toBe(false);
  });
});
