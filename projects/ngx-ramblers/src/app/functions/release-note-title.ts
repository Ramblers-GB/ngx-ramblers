import { REPOSITORY_URL } from "../models/build-version.model";
import { ReleaseFeedEntry, ReleaseNoteLink, ReleaseNoteTitleSegment } from "../models/release-feed.model";

const ISSUE_REFERENCE = /(#\d+)/;
const ISSUE_NUMBER = /^#(\d+)$/;

export function releaseNoteTitleSegments(title: string): ReleaseNoteTitleSegment[] {
  return (title || "").split(ISSUE_REFERENCE)
    .filter(part => part.length > 0)
    .map(part => {
      const issue = part.match(ISSUE_NUMBER);
      return {text: part, issueUrl: issue ? `${REPOSITORY_URL}/issues/${issue[1]}` : null};
    });
}

export function releaseNoteLinks(entries: ReleaseFeedEntry[]): ReleaseNoteLink[] {
  return entries.map(entry => ({entry, segments: releaseNoteTitleSegments(entry.title)}));
}
