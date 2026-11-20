import debug from "debug";
import {
  MemberBulkLoadAudit,
  RamblersMember,
} from "../../../projects/ngx-ramblers/src/app/models/member.model";
import {
  MemberBulkLoadSource,
  SalesforceAreaQueryMode,
  SalesforceConfig,
} from "../../../projects/ngx-ramblers/src/app/models/salesforce.model";
import { SystemConfig } from "../../../projects/ngx-ramblers/src/app/models/system.model";
import { systemConfig as loadSystemConfig } from "../config/system-config";
import { envConfig } from "../env-config/env-config";
import { dateTimeNowAsValue } from "../shared/dates";
import { fetchSalesforceMembers } from "./salesforce-client";
import { configuredSalesforce, parseGroupCodes, persistSalesforceConfig } from "./salesforce-config";
import { mapSalesforceMemberToRamblersMember } from "./salesforce-member-mapper";
import {
  SalesforceMember,
  SalesforceSyncOptions,
  SalesforceSyncOutcome,
  SalesforceTeamFetch,
  SnapshotReconciliation,
} from "./salesforce.model";
import { memberBulkLoadAudit } from "../mongo/models/member-bulk-load-audit";
import { uniq } from "es-toolkit/compat";
import { strongestTeamStatus } from "../../../projects/ngx-ramblers/src/app/functions/team-emails-membership";
import { combinedVolunteerRoles } from "../../../projects/ngx-ramblers/src/app/functions/volunteer-roles";

const debugLog = debug(envConfig.logNamespace("salesforce-sync"));
debugLog.enabled = true;

function emptyAudit(createdBy: string | undefined): MemberBulkLoadAudit {
  return {
    files: { archive: null, data: null },
    source: MemberBulkLoadSource.RAMBLERS_TEAM_EMAILS,
    auditLog: [],
    members: [],
    createdDate: dateTimeNowAsValue(),
    createdBy: createdBy ?? undefined,
  };
}

function logInfo(audit: MemberBulkLoadAudit, message: string) {
  debugLog(message);
  audit.auditLog.push({ status: "info", message });
}

function logComplete(audit: MemberBulkLoadAudit, message: string) {
  debugLog(message);
  audit.auditLog.push({ status: "complete", message });
}

function logError(audit: MemberBulkLoadAudit, message: string) {
  debugLog("error:", message);
  audit.auditLog.push({ status: "error", message });
  audit.error = audit.error ? `${audit.error}; ${message}` : message;
}

function ensureGroupCodes(systemConfig: SystemConfig): string[] {
  return parseGroupCodes(systemConfig?.group?.groupCode);
}

function identityKeysOf(member: Partial<RamblersMember>): string[] {
  return [
    member.salesforceMemberRef,
    member.salesforceId,
    member.membershipNumber,
    member.email,
  ].filter((key): key is string => !!key);
}

export function combinedTeamRecord(existing: RamblersMember, candidate: RamblersMember): RamblersMember {
  return {
    ...existing,
    ...candidate,
    salesforceTeamStatus: strongestTeamStatus(existing.salesforceTeamStatus, candidate.salesforceTeamStatus),
    volunteerRoles: combinedVolunteerRoles(existing.volunteerRoles, candidate.volunteerRoles),
    groupCodes: uniq([...(existing.groupCodes ?? []), ...(candidate.groupCodes ?? [])])
  };
}

function findMatchingMember(members: RamblersMember[], candidate: RamblersMember): RamblersMember | null {
  const candidateKeys = new Set(identityKeysOf(candidate));
  return members.find(member => identityKeysOf(member).some(key => candidateKeys.has(key))) ?? null;
}

export function reconcileSupporterSnapshot(
  previousMembers: RamblersMember[],
  supporters: SalesforceMember[],
  groupCodesByIdentity: Map<string, string[]> | null = null,
): SnapshotReconciliation {
  const mapped = supporters.map(supporter => groupCodesByIdentity
    ? {...mapSalesforceMemberToRamblersMember(supporter), groupCodes: groupCodesByIdentity.get(supporterIdentity(supporter)) ?? []}
    : mapSalesforceMemberToRamblersMember(supporter));
  const currentMembers = mapped.reduce((result, candidate) => {
    const existing = findMatchingMember(result, candidate);
    return existing
      ? result.map(member => member === existing ? combinedTeamRecord(member, candidate) : member)
      : [...result, candidate];
  }, [] as RamblersMember[]);

  const counts = {newCount: 0, changedCount: 0, unchangedCount: 0};
  const reconciled = currentMembers.map(current => {
    const previous = findMatchingMember(previousMembers, current);
    if (!previous) {
      counts.newCount += 1;
      return current;
    }
    const merged = {...previous, ...current};
    if (JSON.stringify(previous) === JSON.stringify(merged)) {
      counts.unchangedCount += 1;
    } else {
      counts.changedCount += 1;
    }
    return merged;
  });

  const disappeared = previousMembers.filter(previous => !findMatchingMember(currentMembers, previous));
  return {
    members: reconciled,
    newCount: counts.newCount,
    changedCount: counts.changedCount,
    unchangedCount: counts.unchangedCount,
    disappearedCount: disappeared.length,
  };
}

export function areaGroupCodes(systemConfig: SystemConfig, siteGroupCodes: string[]): string[] {
  const areaCode = systemConfig?.area?.groupCode;
  return areaCode && siteGroupCodes.includes(areaCode)
    ? (systemConfig.area.groups ?? []).map(group => group.groupCode).filter(code => !!code && !siteGroupCodes.includes(code))
    : [];
}

export function supporterIdentity(supporter: SalesforceMember): string {
  return supporter.contactId || supporter.memberRef || supporter.membershipNo || supporter.email || "";
}

export function groupCodesByIdentityFrom(groupFetches: SalesforceTeamFetch[]): Map<string, string[]> {
  return groupFetches.reduce((byIdentity, groupFetch) => {
    (groupFetch.supporters ?? []).map(supporterIdentity).filter(identity => !!identity).forEach(identity => {
      const existing = byIdentity.get(identity) ?? [];
      byIdentity.set(identity, existing.includes(groupFetch.teamCode) ? existing : [...existing, groupFetch.teamCode]);
    });
    return byIdentity;
  }, new Map<string, string[]>());
}

async function previousBulkLoadMembers(): Promise<RamblersMember[]> {
  const latestAudit = await memberBulkLoadAudit.findOne().sort({ createdDate: -1 }).lean().exec();
  return latestAudit?.members ?? [];
}

export async function runSalesforceSync(options: SalesforceSyncOptions = {}): Promise<SalesforceSyncOutcome> {
  const audit = emptyAudit(options.createdBy);
  const salesforceConfig = await configuredSalesforce();
  if (!salesforceConfig) {
    logError(audit, "Salesforce integration is not configured.");
    return { audit, config: null, status: 0, errorCode: "NOT_CONFIGURED", errorMessage: "Salesforce integration is not configured." };
  } else if (!salesforceConfig.enabled) {
    logError(audit, "Salesforce integration is disabled in System Settings.");
    return { audit, config: salesforceConfig, status: 0, errorCode: "DISABLED", errorMessage: "Salesforce integration is disabled." };
  } else if (!salesforceConfig.endpointBaseUrl) {
    logError(audit, "Salesforce endpoint base URL is not configured.");
    return { audit, config: salesforceConfig, status: 0, errorCode: "NOT_CONFIGURED", errorMessage: "Salesforce endpoint base URL is not configured." };
  }

  const systemConfig = await loadSystemConfig();
  const groupCodes = ensureGroupCodes(systemConfig);
  if (groupCodes.length === 0) {
    logError(audit, "Group code is not configured under Area & Group settings.");
    return { audit, config: salesforceConfig, status: 0, errorCode: "GROUP_CODE_MISSING", errorMessage: "Group code is not configured." };
  }

  const queryByGroupCodes = salesforceConfig.areaQueryMode === SalesforceAreaQueryMode.GROUP_CODES && areaGroupCodes(systemConfig, groupCodes).length > 0;
  const teamCodes = queryByGroupCodes ? [...areaGroupCodes(systemConfig, groupCodes), ...groupCodes] : groupCodes;
  logInfo(audit, `Starting Ramblers Team Emails supporter snapshot for ${teamCodes.join(", ")} via ${salesforceConfig.endpointBaseUrl}.`);
  const startedAt = dateTimeNowAsValue();
  const statuses: number[] = [];
  const supporters: SalesforceMember[] = [];
  const teamFetches: SalesforceTeamFetch[] = [];

  for (const groupCode of teamCodes) {
    const result = await fetchSalesforceMembers(salesforceConfig, { groupCode });
    if (!result.data) {
      const message = `Supporter snapshot failed for ${groupCode}: ${result.errorCode || "UNKNOWN"} - ${result.errorMessage || "no response body"} (status ${result.status}, ${result.latencyMs}ms).`;
      logError(audit, message);
      return { audit, config: salesforceConfig, status: result.status, errorCode: result.errorCode, errorMessage: result.errorMessage };
    }
    statuses.push(result.status);
    supporters.push(...result.data);
    teamFetches.push({teamCode: groupCode, status: result.status, supporters: result.data});
    logInfo(audit, `Ramblers Team Emails returned ${result.data.length} supporters for ${groupCode} in ${result.latencyMs}ms.`);
  }

  const groupCodesByIdentity = queryByGroupCodes ? groupCodesByIdentityFrom(teamFetches.filter(teamFetch => !groupCodes.includes(teamFetch.teamCode))) : null;

  const previousMembers = await previousBulkLoadMembers();
  const reconciliation = reconcileSupporterSnapshot(previousMembers, supporters, groupCodesByIdentity);
  audit.members = reconciliation.members;
  logInfo(
    audit,
    `Snapshot reconciliation: ${reconciliation.newCount} new, ${reconciliation.changedCount} changed, ${reconciliation.unchangedCount} unchanged and ${reconciliation.disappearedCount} no longer present in this snapshot (not prepared for apply).`,
  );

  const updatedConfig: SalesforceConfig = {
    ...salesforceConfig,
    lastSyncedAt: dateTimeNowAsValue(),
  };
  await persistSalesforceConfig(updatedConfig);
  logComplete(audit, `Supporter snapshot complete: ${audit.members.length} records prepared in ${dateTimeNowAsValue() - startedAt}ms.`);

  return {
    audit,
    config: updatedConfig,
    status: statuses[statuses.length - 1] ?? 0,
  };
}
