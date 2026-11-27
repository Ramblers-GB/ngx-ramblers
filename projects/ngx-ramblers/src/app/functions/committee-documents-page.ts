import { toKebabCase } from "./strings";
import { CommitteeFile } from "../models/committee.model";
import { CommitteeDocumentsPageChoice, PageContent, PageContentRow, PageContentType } from "../models/content-text.model";

export function committeeDocumentSlug(title: string, eventDateLabel: string): string {
  return toKebabCase(title, eventDateLabel).replace(/(\d)-(st|nd|rd|th)(?=-|$)/g, "$1$2");
}

const COMMITTEE_FILE_REFERENCE_SEPARATOR = "--";

export function committeeFileReference(slug: string, id: string | null): string {
  return id ? `${slug}${COMMITTEE_FILE_REFERENCE_SEPARATOR}${id}` : slug;
}

const NUMBERED_REFERENCE = /^(.+)-(\d+)$/;

function filesInCreationOrder(files: CommitteeFile[]): CommitteeFile[] {
  return [...files].sort((first, second) => (first.id || "").localeCompare(second.id || ""));
}

function filesWithSlug(files: CommitteeFile[], slug: string, legacySlug: (file: CommitteeFile) => string): CommitteeFile[] {
  return filesInCreationOrder(files.filter(file => legacySlug(file) === slug));
}

export function committeeFileReferences(
  files: CommitteeFile[],
  legacySlug: (file: CommitteeFile) => string
): Map<string, string> {
  const slugById = new Map(files.filter(file => file.id).map((file): [string, string] => [`${file.id}`, legacySlug(file)]));
  const groups = Array.from(slugById.entries()).reduce((grouped, [id, slug]) => {
    grouped.set(slug, [...(grouped.get(slug) || []), id]);
    return grouped;
  }, new Map<string, string[]>());
  return new Map(Array.from(groups.entries()).flatMap(([slug, ids]) => [...ids]
    .sort((first, second) => first.localeCompare(second))
    .map((id, index): [string, string] => [id, index === 0 ? slug : `${slug}-${index + 1}`])));
}

export function committeeFileByReference(
  files: CommitteeFile[],
  reference: string | null,
  legacySlug: (file: CommitteeFile) => string
): CommitteeFile | null {
  if (!reference) {
    return null;
  } else if (reference.includes(COMMITTEE_FILE_REFERENCE_SEPARATOR)) {
    const id = reference.split(COMMITTEE_FILE_REFERENCE_SEPARATOR).at(-1);
    return id ? files.find(file => file.id === id) ?? null : null;
  } else {
    const exact = filesWithSlug(files, reference, legacySlug);
    const numbered = reference.match(NUMBERED_REFERENCE);
    if (exact.length > 0) {
      return exact[0];
    } else if (numbered) {
      return filesWithSlug(files, numbered[1], legacySlug)[Number(numbered[2]) - 1] ?? null;
    } else {
      return null;
    }
  }
}

export function meetingMinutesDocumentSlug(room: string): string {
  return toKebabCase(room || "");
}

export function committeeDocumentsRow(page: PageContent | null): PageContentRow | null {
  return (page?.rows || []).find(row => row.type === PageContentType.COMMITTEE_DOCUMENTS) || null;
}

export function committeeDocumentsPageLabel(page: PageContent): string {
  const titled = committeeDocumentsRow(page)?.committeeDocuments?.pageTitle?.trim();
  if (titled) {
    return titled;
  } else {
    return (page.path || "").replace(/\//g, " / ") || "Committee documents";
  }
}

export function preferredCommitteeDocumentsPagePath(
  pages: CommitteeDocumentsPageChoice[],
  configuredPath: string | null,
  currentPath: string | null,
  year?: string | null
): string | null {
  const current = pages.find(page => page.path === currentPath);
  const configured = pages.find(page => page.path === configuredPath);
  const configuredYear = configuredPath && year ? pages.find(page => page.path === `${configuredPath}/${year}`) : null;
  const yearMatch = year ? pages.find(page => page.path === year || page.path.endsWith(`/${year}`)) : null;
  if (current) {
    return current.path;
  } else if (configured) {
    return configured.path;
  } else if (configuredYear) {
    return configuredYear.path;
  } else if (yearMatch) {
    return yearMatch.path;
  } else {
    return pages[0]?.path || null;
  }
}

export function addCommitteeFileIdToPage(page: PageContent, fileId: string): boolean {
  const row = committeeDocumentsRow(page);
  if (!row?.committeeDocuments || !fileId) {
    return false;
  } else {
    const ids = row.committeeDocuments.fileIds || [];
    if (ids.includes(fileId)) {
      return false;
    } else {
      row.committeeDocuments.fileIds = [...ids, fileId];
      return true;
    }
  }
}
