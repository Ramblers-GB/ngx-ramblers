import { inject, Injectable } from "@angular/core";
import { NgxLoggerLevel } from "ngx-logger";
import { summariseFieldChanges as fieldChangeSummary } from "../../functions/member-bulk-load-digest";
import { existingMemberMatchFor } from "../../functions/member-bulk-apply";
import { MemberBulkApplyResult } from "../../models/member-bulk-apply.model";
import {
  Member,
  MemberAuditFieldChange,
  MemberBulkLoadAudit,
  MemberMatchResult,
  RamblersMemberAndContact
} from "../../models/member.model";
import { Logger, LoggerFactory } from "../logger-factory.service";
import { AlertInstance } from "../notifier.service";
import { StringUtilsService } from "../string-utils.service";
import { MemberBulkLoadAuditService } from "./member-bulk-load-audit.service";

@Injectable({
  providedIn: "root"
})
export class MemberBulkLoadService {

  private logger: Logger = inject(LoggerFactory).createLogger("MemberBulkLoadService", NgxLoggerLevel.ERROR);
  private memberBulkLoadAuditService = inject(MemberBulkLoadAuditService);
  private stringUtils = inject(StringUtilsService);

  public async processResponse(memberBulkLoadResponse: MemberBulkLoadAudit, notify: AlertInstance): Promise<MemberBulkApplyResult> {
    notify.setBusy();
    const total = memberBulkLoadResponse.members?.length ?? 0;
    this.logger.info("processResponse:received", total, "ramblersMembers");
    const auditResponse: MemberBulkLoadAudit = await this.memberBulkLoadAuditService.create(memberBulkLoadResponse);
    notify.progress({title: "Bulk member load", message: `Updating ${this.stringUtils.pluraliseWithCount(total, "member")}`}, true);
    const result = await this.memberBulkLoadAuditService.apply(auditResponse.id);
    notify.progress({title: "Bulk member load", message: this.finishedMessage(result), completed: result.total, total: result.total, percent: 100}, true);
    return result;
  }

  public finishedMessage(result: MemberBulkApplyResult): string {
    const counts = `${result.created} created, ${result.updated} updated, ${result.skipped} unchanged`;
    const failures = result.failed > 0 ? `; ${this.stringUtils.pluraliseWithCount(result.failed, "member")} could not be saved` : "";
    return `Finished processing ${this.stringUtils.pluraliseWithCount(result.total, "member")} in ${Math.round(result.durationMs / 1000)}s: ${counts}${failures}`;
  }

  public existingMemberMatchFor(ramblersMemberAndContact: RamblersMemberAndContact, existingMembers: Member[]): MemberMatchResult {
    return existingMemberMatchFor(ramblersMemberAndContact, existingMembers);
  }

  public summariseFieldChanges(fieldChanges: MemberAuditFieldChange[]): string {
    return fieldChangeSummary(fieldChanges);
  }
}
