import { values } from "es-toolkit/compat";
import { InsightHubMemberStatus, InsightHubTeamStatus, Member, RamblersMember, TEAM_STATUS_PRECEDENCE } from "../models/member.model";

const INSIGHT_HUB_MEMBER_STATUSES: string[] = values(InsightHubMemberStatus);
const INSIGHT_HUB_TEAM_STATUSES: string[] = values(InsightHubTeamStatus);

function normalised(value: string): string {
  return (value || "").trim().toLowerCase();
}

export function teamStatusOf(member: Member | RamblersMember): string {
  return normalised(member?.salesforceTeamStatus);
}

export function strongestTeamStatus(first: string, second: string): string {
  const rank = (status: string) => {
    const index = TEAM_STATUS_PRECEDENCE.indexOf(normalised(status));
    return index === -1 ? TEAM_STATUS_PRECEDENCE.length : index;
  };
  return !second || (!!first && rank(first) <= rank(second)) ? first : second;
}

export function fromTeamEmailsFeed(ramblersMember: RamblersMember): boolean {
  return !!teamStatusOf(ramblersMember);
}

export function teamEmailsIgnoredReason(ramblersMember: RamblersMember): string | null {
  const memberStatus = normalised(ramblersMember?.memberStatus);
  const teamStatus = teamStatusOf(ramblersMember);
  if (!fromTeamEmailsFeed(ramblersMember)) {
    return null;
  } else if (!INSIGHT_HUB_MEMBER_STATUSES.includes(memberStatus)) {
    return memberStatus ? `Membership ${memberStatus}` : "No membership status";
  } else if (!INSIGHT_HUB_TEAM_STATUSES.includes(teamStatus)) {
    return `Team status ${teamStatus}, not a member of this group`;
  } else {
    return null;
  }
}

export function ignoredMember(member: Member): boolean {
  return !!member?.teamEmailsIgnoredReason;
}
