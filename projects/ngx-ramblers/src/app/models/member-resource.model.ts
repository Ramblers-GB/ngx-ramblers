import { mapValues, values } from "es-toolkit/compat";
import { ApiResponse, Identifiable } from "./api-response.model";
import { FileNameData } from "./aws-object.model";
import { MailchimpCampaign, MailchimpCampaignVersion2 } from "./mailchimp.model";

export enum AccessLevel {
  HIDDEN = "hidden",
  ENVIRONMENT_ADMIN = "environmentAdmin",
  MEMBER_ADMIN = "memberAdmin",
  EVENT_ADMIN = "eventAdmin",
  EVENT_LEADER = "eventLeader",
  COMMITTEE = "committee",
  LOGGED_IN_MEMBER = "loggedInMember",
  NOT_LOGGED_IN = "notLoggedIn",
  PUBLIC = "public"
}

export const EVENT_SCOPED_ACCESS_LEVELS: AccessLevel[] = [AccessLevel.EVENT_ADMIN, AccessLevel.EVENT_LEADER];

export const EVENT_ACTION_ACCESS_LEVELS: AccessLevel[] = [AccessLevel.HIDDEN, AccessLevel.EVENT_ADMIN, AccessLevel.EVENT_LEADER, AccessLevel.COMMITTEE, AccessLevel.LOGGED_IN_MEMBER];

export interface AccessLevelContext {
  loggedIn: boolean;
  emailedAccess: boolean;
  committee: boolean;
  memberAdmin: boolean;
  environmentAdmin: boolean;
  eventAdmin: boolean;
  eventLeader: boolean;
}

export interface AccessLevelDefinition {
  description: string;
  permitted: (context: AccessLevelContext) => boolean;
  includeAccessLevelIds: AccessLevel[];
}

export const ACCESS_LEVEL_DEFINITIONS: Record<AccessLevel, AccessLevelDefinition> = {
  [AccessLevel.HIDDEN]: {description: "Hidden", permitted: () => false, includeAccessLevelIds: []},
  [AccessLevel.ENVIRONMENT_ADMIN]: {
    description: "Environment Admin", permitted: context => context.environmentAdmin,
    includeAccessLevelIds: [AccessLevel.ENVIRONMENT_ADMIN, AccessLevel.COMMITTEE, AccessLevel.LOGGED_IN_MEMBER, AccessLevel.PUBLIC, AccessLevel.HIDDEN]
  },
  [AccessLevel.MEMBER_ADMIN]: {
    description: "Member Admin", permitted: context => context.memberAdmin,
    includeAccessLevelIds: [AccessLevel.MEMBER_ADMIN, AccessLevel.COMMITTEE, AccessLevel.LOGGED_IN_MEMBER, AccessLevel.PUBLIC, AccessLevel.HIDDEN]
  },
  [AccessLevel.EVENT_ADMIN]: {description: "Walk or event admin", permitted: context => context.eventAdmin, includeAccessLevelIds: [AccessLevel.EVENT_ADMIN]},
  [AccessLevel.EVENT_LEADER]: {description: "Event leader or organiser", permitted: context => context.eventLeader, includeAccessLevelIds: [AccessLevel.EVENT_LEADER]},
  [AccessLevel.COMMITTEE]: {
    description: "Committee", permitted: context => context.committee,
    includeAccessLevelIds: [AccessLevel.COMMITTEE, AccessLevel.LOGGED_IN_MEMBER, AccessLevel.PUBLIC, AccessLevel.HIDDEN]
  },
  [AccessLevel.LOGGED_IN_MEMBER]: {description: "Logged-in member", permitted: context => context.loggedIn || context.emailedAccess, includeAccessLevelIds: [AccessLevel.LOGGED_IN_MEMBER]},
  [AccessLevel.NOT_LOGGED_IN]: {description: "Not logged in", permitted: context => !context.loggedIn, includeAccessLevelIds: [AccessLevel.NOT_LOGGED_IN]},
  [AccessLevel.PUBLIC]: {description: "Public", permitted: () => true, includeAccessLevelIds: [AccessLevel.PUBLIC]}
};

export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = mapValues(ACCESS_LEVEL_DEFINITIONS, definition => definition.description);

export function generalAccessLevels(): AccessLevel[] {
  return values(AccessLevel).filter(level => !EVENT_SCOPED_ACCESS_LEVELS.includes(level));
}

export interface EventAccessContext {
  loggedIn: boolean;
  committee: boolean;
  memberAdmin: boolean;
  eventAdmin: boolean;
  eventLeader: boolean;
}

export enum ResourceType {
  EMAIL = "email",
  FILE = "file",
  URL = "url",
  PUBLIC = "public"
}

export interface ResourceSubject extends Identifiable {
  description: string;
}

export interface ResourceTypeData extends Identifiable {
  description: string;
  action: string;
  icon: (memberResource?: MemberResource) => string;
  resourceUrl: (memberResource: MemberResource) => string;
}

export interface AccessLevelData extends Identifiable {
  description: string;
  filter: () => boolean;
  includeAccessLevelIds: AccessLevel[];
}
export type MailchimpCampaignMixedVersion = MailchimpCampaign | MailchimpCampaignVersion2 ;
export interface MemberResource extends Identifiable {
  data: {
    campaignSearchTerm?: string;
    campaign?: MailchimpCampaignMixedVersion;
    fileNameData?: FileNameData;
  };
  resourceType: ResourceType;
  accessLevel: AccessLevel;
  createdDate: number;
  createdBy: string;
  title?: string;
  resourceDate?: number;
  description?: string;
  subject?: string;
}

export interface MemberResourceApiResponse extends ApiResponse {
  request: any;
  response?: MemberResource | MemberResource[];
}

export interface MemberResourcesPermissions {
  committee?: boolean;
  delete?: boolean;
  edit?: boolean;
}
