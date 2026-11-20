import { SiteMemberLabel } from "../models/member.model";
import { SystemConfig } from "../models/system.model";

export function areaSite(systemConfig: SystemConfig): boolean {
  const areaCode = systemConfig?.area?.groupCode;
  const siteCodes = (systemConfig?.group?.groupCode || "").split(",").map(code => code.trim());
  return !!areaCode && siteCodes.includes(areaCode) && (systemConfig?.area?.groups?.length ?? 0) > 0;
}

export function siteMemberLabel(systemConfig: SystemConfig): SiteMemberLabel {
  return areaSite(systemConfig) ? SiteMemberLabel.AREA : SiteMemberLabel.GROUP;
}

export function everyoneOnSiteLabel(systemConfig: SystemConfig): string {
  return areaSite(systemConfig) ? "Everyone in the area" : "Everyone in the group";
}
