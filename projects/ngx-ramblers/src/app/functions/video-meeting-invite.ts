import { ComposerExternalRecipient } from "../models/email-composer.model";
import { CommitteeMember } from "../models/committee.model";
import { Member } from "../models/member.model";
import { committeeAssignedEmailsForMemberId, memberHoldsCommitteeRole } from "./committee-members";
import { GUEST_MEETING_EMAIL_PARAM, GUEST_MEETING_NAME_PARAM, MEETING_JOIN_LINK_LABEL } from "./video-meeting-join";
import { escapeHtml, normaliseEmail } from "./strings";

const INVITEE_NAME_MERGE_FIELD = "{{params.memberMergeFields.FULL_NAME}}";
const INVITEE_EMAIL_MERGE_FIELD = "{{params.memberMergeFields.EMAIL}}";

export function meetingInviteRecipientMember(
  recipient: ComposerExternalRecipient,
  members: Member[],
  roles: CommitteeMember[]
): Member | null {
  const byId = recipient.memberId
    ? (members ?? []).find(member => member.id === recipient.memberId)
    : undefined;
  if (byId) {
    return byId;
  } else {
    const wanted = normaliseEmail(recipient.email);
    return wanted
      ? ((members ?? []).find(member => normaliseEmail(member.email) === wanted)
        || (members ?? []).find(member =>
          committeeAssignedEmailsForMemberId(roles, member.id ?? null)
            .some(entry => normaliseEmail(entry.email) === wanted))
        || null)
      : null;
  }
}

export function meetingInviteCommitteeRoleSendOffered(
  recipients: ComposerExternalRecipient[],
  members: Member[],
  roles: CommitteeMember[]
): boolean {
  const chosen = (recipients ?? []).filter(item => !!(item.email || "").trim());
  if (chosen.length === 0) {
    return false;
  } else {
    return chosen.every(recipient => {
      const member = meetingInviteRecipientMember(recipient, members, roles);
      return !!member && memberHoldsCommitteeRole(member, roles);
    });
  }
}

export function personalisedGuestJoinUrl(joinUrl: string): string {
  const base = (joinUrl || "").trim();
  if (!base) {
    return "";
  } else {
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}${GUEST_MEETING_NAME_PARAM}=${INVITEE_NAME_MERGE_FIELD}&${GUEST_MEETING_EMAIL_PARAM}=${INVITEE_EMAIL_MERGE_FIELD}`;
  }
}

export function personaliseJoinLinkHtml(html: string, joinUrl: string): string {
  const base = (joinUrl || "").trim();
  if (!base || !html) {
    return html || "";
  } else {
    const personalised = escapeHtml(personalisedGuestJoinUrl(base));
    return html.split(`href="${base}"`).join(`href="${personalised}"`);
  }
}

export function personaliseGuestMeetingLinksInHtml(html: string): string {
  const source = html || "";
  if (!source) {
    return source;
  } else {
    return source.replace(/href="([^"]*\/video-meetings\/guest\/[^"]*)"/g, (match, href) => {
      if (href.includes(INVITEE_NAME_MERGE_FIELD)) {
        return match;
      } else {
        return `href="${escapeHtml(personalisedGuestJoinUrl(href))}"`;
      }
    });
  }
}

export function meetingInviteKindPhrase(kind: string): string {
  const trimmed = (kind || "").trim() || "committee meeting";
  if (/^[A-Z]{2,}$/.test(trimmed)) {
    return `the ${trimmed}`;
  } else {
    const article = /^[aeiou]/i.test(trimmed) ? "an" : "a";
    return `${article} ${trimmed}`;
  }
}

export function meetingInviteBodyMarkdown(input: {
  dateLabel: string;
  timeLabel: string;
  joinUrl: string;
  location: string;
  note: string;
  guestInstructions: string;
  signoff: string;
  agendaItems?: string;
  meetingKind?: string;
}): string {
  const note = (input.note || "").trim();
  const agenda = (input.agendaItems || "").trim();
  const signoff = (input.signoff || "").trim();
  const guidance = input.joinUrl
    ? (input.guestInstructions || "").trim()
    : "We look forward to seeing you there.";
  return [
    meetingInviteOpening(input),
    note,
    agenda,
    guidance,
    signoff
  ].filter(Boolean).join("\n\n");
}

function meetingInviteOpening(input: {
  dateLabel: string;
  timeLabel: string;
  joinUrl: string;
  location: string;
  meetingKind?: string;
}): string {
  const when = `You are invited to ${meetingInviteKindPhrase(input.meetingKind)} on ${input.dateLabel} at ${input.timeLabel}.`;
  const place = (input.location || "").trim();
  const atVenue = place && !/^online$/i.test(place) ? ` We are meeting at ${place}.` : "";
  const join = input.joinUrl ? ` Please join using [${MEETING_JOIN_LINK_LABEL}](${input.joinUrl}).` : "";
  return `## ${when}${atVenue}${join}`;
}
