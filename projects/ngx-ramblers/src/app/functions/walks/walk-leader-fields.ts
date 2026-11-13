import { EventSource, ExtendedGroupEvent, GroupEvent, InputSource } from "../../models/group-event.model";
import { Contact, RamblersEventType } from "../../models/ramblers-walks-manager.model";
import { isArray } from "es-toolkit/compat";
import { jointWalkLeaderNames, normalisedWalkLeaderName } from "./joint-walk-leaders";

export type WebsiteWalkLeaderDisplayName = string;
export type WalksManagerContactNameForCsv = string;
export type WalksManagerListedWalkLeaderName = string;

export function memberLeadsWalk(memberId: string, walk: ExtendedGroupEvent): boolean {
  const contact = walk?.groupEvent?.item_type === RamblersEventType.GROUP_EVENT ? walk?.groupEvent?.event_organiser : walk?.groupEvent?.walk_leader;
  return !!memberId && [walk?.fields?.contactDetails?.memberId, contact?.id].includes(memberId);
}

export function websiteWalkLeaderDisplayName(walk: ExtendedGroupEvent): WebsiteWalkLeaderDisplayName {
  return (walk?.fields?.contactDetails?.displayName || "").trim();
}

export function walkLeaderDisplayName(walk: ExtendedGroupEvent): WebsiteWalkLeaderDisplayName {
  return websiteWalkLeaderDisplayName(walk) || (walk?.groupEvent?.walk_leader?.name || "").trim();
}

export function walksManagerContactNamesForCsv(walk: ExtendedGroupEvent): WalksManagerContactNameForCsv {
  return normalisedWalkLeaderName(walk?.fields?.publishing?.ramblers?.contactName) || "";
}

function walksManagerFirstName(walk: ExtendedGroupEvent): string {
  const contactName = walksManagerContactNamesForCsv(walk);
  return contactName ? jointWalkLeaderNames(contactName)[0]?.split(/\s+/).filter(Boolean)[0] || "" : "";
}

export function walkLeaderFirstNameForAlbumThanks(walk: ExtendedGroupEvent): string {
  const displayName = websiteWalkLeaderDisplayName(walk);
  const spaced = displayName.split(/\s+/).filter(Boolean);
  const fromWalksManager = walksManagerFirstName(walk);
  if (spaced.length > 1) {
    return spaced[0];
  } else if (displayName && fromWalksManager && displayName.toLowerCase().startsWith(fromWalksManager.toLowerCase())) {
    return fromWalksManager;
  } else if (displayName) {
    return displayName;
  } else {
    return fromWalksManager;
  }
}

export function walkEventIsWalksManagerSourced(walk: ExtendedGroupEvent | {source?: EventSource; fields?: {inputSource?: InputSource}}): boolean {
  return walk?.source === EventSource.WALKS_MANAGER
    || walk?.fields?.inputSource === InputSource.WALKS_MANAGER_CACHE;
}

function walksManagerWalkLeaderContact(groupEvent: GroupEvent): Contact | null {
  const contact = groupEvent?.walk_leader as Contact | Contact[] | null;
  if (isArray(contact)) {
    return contact[0] || null;
  } else {
    return contact || null;
  }
}

export function walksManagerWalkLeaderNameFromGroupEvent(groupEvent: GroupEvent): WalksManagerListedWalkLeaderName {
  return normalisedWalkLeaderName(walksManagerWalkLeaderContact(groupEvent)?.name || "");
}

export function walksManagerWalkLeaderIdFromGroupEvent(groupEvent: GroupEvent): string {
  return (walksManagerWalkLeaderContact(groupEvent)?.id || "").trim();
}

export function walkLeaderNameForStats(walk: ExtendedGroupEvent): string {
  const displayName = websiteWalkLeaderDisplayName(walk);
  const listedName = walksManagerWalkLeaderNameFromGroupEvent(walk?.groupEvent);
  const publishedName = walksManagerContactNamesForCsv(walk);
  if (walkEventIsWalksManagerSourced(walk)) {
    return listedName || displayName || publishedName;
  } else {
    return displayName || publishedName || listedName;
  }
}

export function remoteWalksManagerContactNameForCompare(
  listedFromWalksManager: WalksManagerListedWalkLeaderName,
  priorFromHistory: WalksManagerContactNameForCsv
): WalksManagerContactNameForCsv {
  return listedFromWalksManager || priorFromHistory || "";
}
