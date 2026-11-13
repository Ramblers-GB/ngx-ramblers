import { isArray, kebabCase } from "es-toolkit/compat";
import { UIDateFormat } from "../../../../projects/ngx-ramblers/src/app/models/date-format.model";
import {
  LeaderStats,
  WalkAGMStats,
  WalkListItem
} from "../../../../projects/ngx-ramblers/src/app/models/group-event.model";
import { RamblersEventType } from "../../../../projects/ngx-ramblers/src/app/models/ramblers-walks-manager.model";
import { EventField, GroupEventField } from "../../../../projects/ngx-ramblers/src/app/models/walk.model";
import {
  historicalLeaderTokens,
  isUnknownWalkLeader,
  isUnknownWalkLeaderName,
  leaderStatsFromWalks,
  newLeadersFromPeriod,
  UNKNOWN_WALK_LEADER_KEY
} from "../../../../projects/ngx-ramblers/src/app/functions/agm-leader-stats";
import { trimmedNamePart } from "../../../../projects/ngx-ramblers/src/app/functions/member-names";
import { fieldEqualsAnyValue } from "../../../../projects/ngx-ramblers/src/app/functions/mongo";
import { walkLeaderNameForStats } from "../../../../projects/ngx-ramblers/src/app/functions/walks/walk-leader-fields";
import { dateTimeFromIso, dateTimeFromMillis, dateTimeNowAsValue } from "../../shared/dates";
import { envConfig } from "../../env-config/env-config";
import debug from "debug";
import { extendedGroupEvent } from "../models/extended-group-event";
import {
  WalkStatBuckets,
  bucketWalksForStats
} from "./classify-local-walk";

const debugLog = debug(envConfig.logNamespace("walk-stats-agm"));
debugLog.enabled = false;

const emptyLeader: LeaderStats = {
  id: "",
  name: "None",
  email: "",
  walkCount: 0,
  totalMiles: 0
};

export function totalMilesFromWalks(walks: {groupEvent?: {distance_miles?: number}}[]): number {
  const miles = (walks || []).reduce((sum, walk) => sum + (walk?.groupEvent?.distance_miles || 0), 0);
  return Math.round(miles * 10) / 10;
}

export function attendeeCountFromWalks(walks: any[]): number {
  return (walks || []).reduce((sum, walk) => {
    const attendees = walk?.fields?.attendees;
    return sum + (isArray(attendees) ? attendees.length : 0);
  }, 0);
}

export function walkAgmStatsFromBuckets(
  buckets: WalkStatBuckets,
  leaders: LeaderStats[],
  newLeaders: LeaderStats[]
): WalkAGMStats {
  const ledWalks = [...buckets.morning, ...buckets.evening];
  const namedLeaders = leaders.filter(leader => !isUnknownWalkLeader(leader));
  return {
    totalWalks: buckets.morning.length + buckets.evening.length + buckets.cancelled.length + buckets.unfilled.length,
    confirmedWalks: ledWalks.length,
    morningWalks: buckets.morning.length,
    cancelledWalks: buckets.cancelled.length,
    cancelledWalksList: buckets.cancelled.map(walk => formatWalkListItem(walk)),
    eveningWalks: buckets.evening.length,
    eveningWalksList: buckets.evening.map(walk => formatWalkListItem(walk)),
    totalMiles: totalMilesFromWalks(ledWalks),
    totalAttendees: attendeeCountFromWalks(ledWalks),
    activeLeaders: namedLeaders.length,
    newLeaders: newLeaders.length,
    newLeadersList: newLeaders,
    topLeader: namedLeaders[0] || emptyLeader,
    allLeaders: leaders,
    unfilledSlots: buckets.unfilled.length,
    unfilledSlotsList: buckets.unfilled.map(walk => formatWalkListItem(walk)),
    morningWalksList: buckets.morning.map(walk => formatWalkListItem(walk))
  };
}

function formatWalkListItem(walk: any): WalkListItem {
  const walkId = walk._id?.toString() || walk.groupEvent?.id || "";
  const title = walk.groupEvent?.title || "";
  const startDate = walk.groupEvent?.start_date_time;
  const dateStr = startDate ? dateTimeFromIso(startDate).toFormat(UIDateFormat.YEAR_MONTH_DAY_WITH_DASHES) : "";
  const urlSlug = walk.groupEvent?.url
    || kebabCase([title, dateStr].filter(Boolean).join("-"))
    || walk.groupEvent?.id
    || walkId;
  const lastSegment = (urlSlug || "").split("/").pop() || urlSlug;
  const walkLeader = walkLeaderNameForStats(walk);
  const startMillis = startDate ? dateTimeFromIso(startDate).toMillis() : 0;
  return {
    id: walkId,
    title,
    startDate: startMillis,
    walkDate: startDate || "",
    walkLeader,
    distance: walk.groupEvent?.distance_miles || 0,
    url: `/walks/${lastSegment}`
  };
}

function walksInRangeQuery(fromDate: number, toDate: number): Record<string, unknown> {
  return {
    [`${GroupEventField.ITEM_TYPE}`]: RamblersEventType.GROUP_WALK,
    [`${GroupEventField.START_DATE}`]: {
      $gte: dateTimeFromMillis(fromDate).toISO(),
      $lte: dateTimeFromMillis(toDate).toISO()
    },
    [`${GroupEventField.STATUS}`]: {$ne: "deleted"}
  };
}

function identityFieldMatch(field: EventField | GroupEventField, values: string[]): Record<string, unknown> | null {
  if (values.length === 0) {
    return null;
  } else {
    return {[field]: fieldEqualsAnyValue(values)};
  }
}

export function historicalLeaderIdentityMatch(leaders: LeaderStats[]): Record<string, unknown>[] {
  const emails = [...new Set(leaders.map(leader => trimmedNamePart(leader.email)).filter(Boolean))];
  const names = [...new Set(leaders.map(leader => trimmedNamePart(leader.name)).filter(name => name && !isUnknownWalkLeaderName(name)))];
  const ids = [...new Set(leaders.map(leader => trimmedNamePart(leader.id)).filter(id => id && id !== UNKNOWN_WALK_LEADER_KEY && !id.includes("@")))];
  return [
    identityFieldMatch(EventField.CONTACT_DETAILS_EMAIL, emails),
    identityFieldMatch(EventField.CONTACT_DETAILS_DISPLAY_NAME, names),
    identityFieldMatch(GroupEventField.WALK_LEADER_NAME, names),
    identityFieldMatch(EventField.PUBLISHING_RAMBLERS_CONTACT_NAME, names),
    identityFieldMatch(EventField.CONTACT_DETAILS_MEMBER_ID, ids),
    identityFieldMatch(GroupEventField.WALK_LEADER_ID, ids)
  ].filter(Boolean) as Record<string, unknown>[];
}

async function historicalLeadersMatching(leaders: LeaderStats[], beforeDate: number): Promise<Set<string>> {
  const identityMatch = historicalLeaderIdentityMatch(leaders);
  if (identityMatch.length === 0) {
    return new Set<string>();
  } else {
    const walks = await extendedGroupEvent.find({
      [`${GroupEventField.ITEM_TYPE}`]: RamblersEventType.GROUP_WALK,
      [`${GroupEventField.START_DATE}`]: {
        $lt: dateTimeFromMillis(beforeDate).toISO()
      },
      [`${GroupEventField.STATUS}`]: {$nin: ["cancelled", "deleted"]},
      $or: identityMatch
    }).select({
      "fields.contactDetails.displayName": 1,
      "fields.contactDetails.memberId": 1,
      "fields.contactDetails.email": 1,
      "fields.publishing.ramblers.contactName": 1,
      "fields.inputSource": 1,
      source: 1,
      "groupEvent.walk_leader.id": 1,
      "groupEvent.walk_leader.name": 1
    }).lean();
    return historicalLeaderTokens(walks);
  }
}

async function statsFromWalks(walks: any[], fromDate: number): Promise<WalkAGMStats> {
  const buckets = bucketWalksForStats(walks, dateTimeNowAsValue());
  const leaders = leaderStatsFromWalks([...buckets.morning, ...buckets.evening]);
  const historicalLeaders = await historicalLeadersMatching(leaders.filter(leader => !isUnknownWalkLeader(leader)), fromDate);
  const newLeaders = newLeadersFromPeriod(
    leaders.filter(leader => !isUnknownWalkLeader(leader)),
    historicalLeaders
  );
  return walkAgmStatsFromBuckets(buckets, leaders, newLeaders);
}

export async function calculateWalkStats(fromDate: number, toDate: number): Promise<WalkAGMStats> {
  const walks = await extendedGroupEvent.find(walksInRangeQuery(fromDate, toDate))
    .sort({[`${GroupEventField.START_DATE}`]: 1})
    .lean();
  return statsFromWalks(walks, fromDate);
}
