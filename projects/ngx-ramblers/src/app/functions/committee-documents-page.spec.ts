import { describe, expect, it } from "vitest";
import { committeeDocumentSlug, committeeFileByReference, committeeFileReference, committeeFileReferences, preferredCommitteeDocumentsPagePath } from "./committee-documents-page";
import { CommitteeDocumentsPageChoice } from "../models/content-text.model";

describe("committee file references", () => {
  const agenda = {id: "aaaaaaaaaaaaaaaaaaaaaaaa", fileType: "AGM Agenda"};
  const minutes = {id: "bbbbbbbbbbbbbbbbbbbbbbbb", fileType: "AGM Minutes"};
  const slug = committeeDocumentSlug("Hillside Park AGM", "15 November 2026");
  const sameTitleAndDate = () => slug;

  it("opens each file even when the agenda and minutes share a title and date", () => {
    const files = [agenda, minutes];
    expect(committeeFileByReference(files, committeeFileReference(slug, agenda.id), sameTitleAndDate)).toBe(agenda);
    expect(committeeFileByReference(files, committeeFileReference(slug, minutes.id), sameTitleAndDate)).toBe(minutes);
  });

  it("keeps an ID-based link usable after the document title changes", () => {
    expect(committeeFileByReference([minutes], committeeFileReference(slug, minutes.id), () => "renamed-agm")).toBe(minutes);
  });

  it("does not open a different file when an ID-based link points at a missing one", () => {
    expect(committeeFileByReference([agenda], committeeFileReference(slug, minutes.id), sameTitleAndDate)).toBeNull();
  });

  it("gives the earliest file the plain slug and numbers later files sharing it", () => {
    const references = committeeFileReferences([minutes, agenda], sameTitleAndDate);
    expect(references.get(agenda.id)).toEqual(slug);
    expect(references.get(minutes.id)).toEqual(`${slug}-2`);
  });

  it("keeps the plain slug, with no ID, when a title and date are unique", () => {
    const references = committeeFileReferences([agenda, minutes], file => committeeDocumentSlug(file.fileType, "15 November 2026"));
    expect(references.get(agenda.id)).toEqual("agm-agenda-15-november-2026");
    expect(references.get(minutes.id)).toEqual("agm-minutes-15-november-2026");
  });

  it("opens each file from its readable reference", () => {
    const files = [minutes, agenda];
    const references = committeeFileReferences(files, sameTitleAndDate);
    expect(committeeFileByReference(files, references.get(agenda.id) ?? null, sameTitleAndDate)).toBe(agenda);
    expect(committeeFileByReference(files, references.get(minutes.id) ?? null, sameTitleAndDate)).toBe(minutes);
  });

  it("does not resolve a number beyond the files sharing a slug", () => {
    expect(committeeFileByReference([agenda, minutes], `${slug}-3`, sameTitleAndDate)).toBeNull();
    expect(committeeFileByReference([agenda], "unknown-slug", sameTitleAndDate)).toBeNull();
  });

  it("resolves a slug whose title happens to end in a number before reading it as a numbered reference", () => {
    const paper = {id: "cccccccccccccccccccccccc", fileType: "Paper"};
    expect(committeeFileByReference([paper, agenda], "paper-2", file => file === paper ? "paper-2" : "paper")).toBe(paper);
  });
});

const pages: CommitteeDocumentsPageChoice[] = [
  {path: "committee", label: "Committee"},
  {path: "committee/2025", label: "2025"},
  {path: "committee/2026", label: "2026"},
  {path: "group/papers", label: "Papers"}
];

describe("preferredCommitteeDocumentsPagePath", () => {

  it("keeps a file on the page it is already attached to", () => {
    expect(preferredCommitteeDocumentsPagePath(pages, "committee/2026", "group/papers", "2026")).toEqual("group/papers");
  });

  it("uses the configured documents page when it still exists", () => {
    expect(preferredCommitteeDocumentsPagePath(pages, "group/papers", null, "2026")).toEqual("group/papers");
  });

  it("uses the configured page even when a year child also exists", () => {
    expect(preferredCommitteeDocumentsPagePath(pages, "committee", null, "2026")).toEqual("committee");
  });

  it("uses a year child of the configured path when that parent is not itself a documents list", () => {
    expect(preferredCommitteeDocumentsPagePath(
      pages.filter(page => page.path !== "committee"),
      "committee",
      null,
      "2026"
    )).toEqual("committee/2026");
  });

  it("uses a documents page whose last segment is the meeting year when nothing is configured", () => {
    expect(preferredCommitteeDocumentsPagePath(pages, null, null, "2026")).toEqual("committee/2026");
  });

  it("falls back to the first documents page when no year page exists", () => {
    const withoutYear = pages.filter(page => page.path !== "committee/2026");
    expect(preferredCommitteeDocumentsPagePath(withoutYear, null, null, "2026")).toEqual("committee");
  });

  it("returns null when there are no documents pages", () => {
    expect(preferredCommitteeDocumentsPagePath([], "committee/2026", null, "2026")).toEqual(null);
  });

});
