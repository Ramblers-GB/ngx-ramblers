import { accessLevelPermitted } from "../functions/access-level";
import { MemberResourcesReferenceDataService } from "./member/member-resources-reference-data.service";
import { inject, Injectable } from "@angular/core";
import { AccessLevel } from "../models/member-resource.model";
import { Link } from "../models/page.model";
import { MemberLoginService } from "./member/member-login.service";

@Injectable({
  providedIn: "root"
})
export class AccessLevelService {

  private memberResourcesReferenceData = inject(MemberResourcesReferenceDataService);
  private memberLoginService = inject(MemberLoginService);

  hasAccess(link: Link): boolean {
    return this.hasAccessLevel(link?.accessLevel);
  }

  hasAccessLevel(accessLevel: AccessLevel): boolean {
    return accessLevelPermitted(accessLevel || AccessLevel.PUBLIC, this.memberLoginService.loggedInMember(), this.memberResourcesReferenceData.platformAdminOn(), this.memberLoginService.emailedAccessActive());
  }
}
