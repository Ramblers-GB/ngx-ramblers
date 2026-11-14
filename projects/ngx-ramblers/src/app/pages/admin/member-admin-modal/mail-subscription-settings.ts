import { Component, EventEmitter, inject, Input, OnInit, Output, ViewChild } from "@angular/core";
import { faBan, faCircleCheck, faCircleExclamation, faEnvelope, faTriangleExclamation, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";
import { NgxLoggerLevel } from "ngx-logger";
import { Logger, LoggerFactory } from "../../../services/logger-factory.service";
import { StringUtilsService } from "../../../services/string-utils.service";
import { DateUtilsService } from "../../../services/date-utils.service";
import { Member, MemberEmailBlock } from "../../../models/member.model";
import {
  BLOCKED_CONTACT_REASON_LABELS,
  BrevoTabSubTab,
  ListInfo,
  ListSetting,
  MailListAudit,
  MailListAuditSource,
  MailMessagingConfig,
  MailSubscription
} from "../../../models/mail.model";
import { MailService } from "../../../services/mail/mail.service";
import { MemberService } from "../../../services/member/member.service";
import { MailLinkService } from "../../../services/mail/mail-link.service";
import { cloneDeep } from "es-toolkit/compat";
import { SystemConfig } from "../../../models/system.model";
import { MailMessagingService } from "../../../services/mail/mail-messaging.service";
import { MailSubscriptionSettingComponent } from "./mail-subscription-setting";
import { BrevoButtonComponent } from "../../../modules/common/third-parties/brevo-button";
import { BrevoContactViewComponent } from "./brevo-contact-view";
import { DisplayDateAndTimePipe } from "../../../pipes/display-date-and-time.pipe";
import { MemberIdToFullNamePipe } from "../../../pipes/member-id-to-full-name.pipe";
import { SectionToggle } from "../../../shared/components/section-toggle";
import { SectionToggleTab } from "../../../models/section-toggle.model";
import { SortableTableComponent } from "../../../modules/common/sortable-table/sortable-table.component";
import { SortableTableCellDirective } from "../../../modules/common/sortable-table/sortable-table-cell.directive";
import { SortableTableColumn } from "../../../modules/common/sortable-table/sortable-table.model";
import { StoredValue } from "../../../models/ui-actions.model";
import { DESCENDING } from "../../../models/table-filtering.model";

@Component({
    selector: "[app-mail-subscription-settings]",
    template: `
    <div class="img-thumbnail thumbnail-admin-edit">
      @if (member?.emailBlock; as block) {
        <div class="alert alert-warning small mb-3 p-3 d-flex align-items-start gap-3">
          <div class="d-flex align-items-start flex-fill text-break" style="min-width: 0">
            <fa-icon [icon]="faBan" class="me-2"></fa-icon>
            <div>
              <strong>{{ blockedTitle() }}</strong>
              <div>{{ blockReasonLabel(block) }} &middot; {{ formatBlockDate(block.blockedAt) }}</div>
              @if (blockExcludesFromSend()) {
                <div>Sends that respect email blocks will exclude this member.</div>
              }
              @if (confirmingEmailEnable) {
                <div class="mt-1">Clear the email block for {{ member.email }}? List subscriptions switched off by a hard bounce can be restored.</div>
              }
            </div>
          </div>
          @if (allowEdits && member.id && member.email) {
            <div class="d-flex flex-wrap justify-content-end gap-2 ms-auto flex-shrink-0" style="max-width: 55%">
              @if (confirmingEmailEnable) {
                <button type="button" class="btn btn-quiet" [disabled]="enablingEmail" (click)="cancelEmailEnable()">
                  <fa-icon [icon]="faXmark" class="me-1"></fa-icon> Cancel
                </button>
                <button type="button" class="btn btn-primary" [disabled]="enablingEmail" (click)="enableEmail()">
                  <fa-icon [icon]="faCircleCheck" class="me-1"></fa-icon>
                  {{ enablingEmail ? "Re-enabling…" : "Confirm re-enable" }}
                </button>
              } @else {
                <button type="button" class="btn btn-primary" (click)="confirmingEmailEnable = true">
                  <fa-icon [icon]="faEnvelope" class="me-1"></fa-icon> Re-enable email
                </button>
              }
            </div>
          }
        </div>
      }
      @if (emailEnableError) {
        <div class="alert alert-danger small d-flex align-items-start">
          <fa-icon [icon]="faCircleExclamation" class="me-2"></fa-icon>
          <div><strong>Could not re-enable email</strong><div>{{ emailEnableError }}</div></div>
        </div>
      }
      @if (emailEnabled && !member?.emailBlock) {
        <div class="alert alert-success small d-flex align-items-start">
          <fa-icon [icon]="faCircleCheck" class="me-2"></fa-icon>
          <div>
            <strong>Email block cleared</strong>
            @if (restoredEmailLists.length) {
              <div>Restored {{ restoredEmailLists.length }} {{ restoredEmailLists.length === 1 ? "list" : "lists" }}: {{ restoredEmailLists.join(", ") }}.</div>
            }
            <div>Select Save to apply any further changes to this member.</div>
          </div>
        </div>
      }
      @if (member) {
        <div class="row thumbnail-heading-frame">
          <div class="thumbnail-heading">Subscriptions</div>
          <div class="col-sm-12">
          @if (member?.mail?.subscriptions && mailMessagingConfig) {
            <div class="row">
              @for (subscription of member.mail.subscriptions; track subscription.id) {
                <div class="col-sm-4">
                  <app-mail-subscription-setting [member]="member" [subscription]="subscription"/>
                </div>
              }
            </div>
            @if (notEmailableReason(); as reason) {
              <div class="alert alert-warning small mt-3 mb-0">
                <div class="d-flex align-items-center mb-1">
                  <fa-icon [icon]="faTriangleExclamation" class="me-2"></fa-icon>
                  <strong>Subscriptions do not guarantee delivery</strong>
                </div>
                <span>{{ reason }}.</span>
                @if (consentMissing()) {
                  <div class="mt-1">
                    <a href="javascript:void(0)" (click)="viewConsent($event)">View consent settings on the Ramblers Membership tab</a>
                  </div>
                }
              </div>
            }
          }
          </div>
        </div>
      }
        <div class="row mt-3">
          <div class="col col-sm-12 d-flex align-items-center justify-content-between flex-wrap gap-2">
            <app-section-toggle
              [tabs]="subTabs"
              [selectedTab]="activeSubTab"
              (selectedTabChange)="onSubTabChange($event)"
              [queryParamKey]="subTabQueryParam"
              [fullWidth]="false"/>
            @if (activeSubTab === BrevoTabSubTab.AUDIT_LOG && mailLinkService.canNavigateToBrevo) {
              <app-brevo-button button [disabled]="!member?.mail?.id"
                (click)="viewBrevoContact(member?.mail?.id)"
                [title]="linkTitle()"/>
            }
          </div>
        </div>
        <div class="row mt-3">
          <div class="col col-sm-12">
            <div [class.d-none]="activeSubTab !== BrevoTabSubTab.AUDIT_LOG">
              <app-sortable-table
                [columns]="auditColumns"
                [rows]="mailListAudits || []"
                [defaultSortKey]="'timestamp'"
                [defaultSortDirection]="DESCENDING"
                emptyMessage="No mail list audit entries">
                <ng-template appSortableTableCell="time" let-row>{{ row.timestamp | displayDateAndTime }}</ng-template>
                <ng-template appSortableTableCell="createdBy" let-row>{{ auditSourceLabels[row.createdBy] ?? (row.createdBy | memberIdToFullName : members) }}</ng-template>
                <ng-template appSortableTableCell="audit" let-row>{{ stringUtils.stringifyObject(row.audit) }}</ng-template>
              </app-sortable-table>
            </div>
            @if (member?.email) {
              <div [class.d-none]="activeSubTab !== BrevoTabSubTab.ACTIVITY">
                <app-brevo-contact-view
                  [contactId]="member?.mail?.id ?? null"
                  [contactEmail]="member.email"
                  [mailMessagingConfig]="mailMessagingConfig"
                  (refreshed)="refreshRequested.emit()"/>
              </div>
            }
          </div>
        </div>
      </div>`,
    imports: [MailSubscriptionSettingComponent, BrevoButtonComponent, BrevoContactViewComponent, DisplayDateAndTimePipe, MemberIdToFullNamePipe, FontAwesomeModule, SectionToggle, SortableTableComponent, SortableTableCellDirective]
})
export class MailSubscriptionSettingsComponent implements OnInit {

  private logger: Logger = inject(LoggerFactory).createLogger("MailSubscriptionSettingsComponent", NgxLoggerLevel.ERROR);
  stringUtils = inject(StringUtilsService);
  mailLinkService = inject(MailLinkService);
  protected mailMessagingService = inject(MailMessagingService);
  protected dateUtils = inject(DateUtilsService);
  private mailService = inject(MailService);
  private memberService = inject(MemberService);
  @ViewChild(BrevoContactViewComponent) private brevoActivity: BrevoContactViewComponent;
  @Input() allowEdits = false;
  protected confirmingEmailEnable = false;
  protected enablingEmail = false;
  protected emailEnabled = false;
  protected restoredEmailLists: string[] = [];
  protected emailEnableError: string | null = null;
  protected readonly faEnvelope = faEnvelope;
  protected readonly faXmark = faXmark;
  protected readonly faCircleCheck = faCircleCheck;
  protected readonly faCircleExclamation = faCircleExclamation;
  @Output() refreshRequested = new EventEmitter<void>();
  @Output() viewConsentRequested = new EventEmitter<void>();
  public member: Member;
  public systemConfig: SystemConfig;
  public mailMessagingConfig: MailMessagingConfig;
  @Input("systemConfig") set systemConfigValue(systemConfig: SystemConfig) {
    this.systemConfig = systemConfig;
    this.initialiseSubscriptions();
  }

  @Input("mailMessagingConfig") set mailMessagingConfigValue(mailMessagingConfig: MailMessagingConfig) {
    this.mailMessagingConfig = mailMessagingConfig;
    this.initialiseSubscriptions();
  }

  @Input("member") set memberValue(member: Member) {
    this.member = member;
  }

  @Input() public mailListAudits: MailListAudit[];
  @Input() public members: Member[];

  protected activeSubTab: BrevoTabSubTab = BrevoTabSubTab.ACTIVITY;
  protected readonly subTabQueryParam: StoredValue = StoredValue.BREVO_SECTION;
  protected readonly subTabs: SectionToggleTab[] = [
    { value: BrevoTabSubTab.ACTIVITY, label: "Brevo activity" },
    { value: BrevoTabSubTab.AUDIT_LOG, label: "Subscription audit" }
  ];
  protected readonly auditSourceLabels: Record<MailListAuditSource, string> = {
    [MailListAuditSource.BRANDED_UNSUBSCRIBE]: "Email unsubscribe link",
    [MailListAuditSource.BRANDED_UNSUBSCRIBE_FEEDBACK]: "Email unsubscribe feedback",
    [MailListAuditSource.BREVO_UNSUBSCRIBES_SYNC]: "Brevo sync",
    [MailListAuditSource.BREVO_EVENTS_WEBHOOK]: "Brevo webhook",
    [MailListAuditSource.BREVO_EMAIL_DENIED_SYNC]: "Brevo sync"
  };
  protected readonly auditColumns: SortableTableColumn<MailListAudit>[] = [
    { key: "time", label: "Time", sortKey: "timestamp" },
    { key: "createdBy", label: "Created By", sortKey: "createdBy" },
    { key: "audit", label: "Audit Message" }
  ];
  protected readonly BrevoTabSubTab = BrevoTabSubTab;
  protected readonly DESCENDING = DESCENDING;
  protected readonly faBan = faBan;
  protected readonly faTriangleExclamation = faTriangleExclamation;

  private respectsHeadOfficeConsent(): boolean {
    return this.mailMessagingConfig?.mailConfig?.respectHeadOfficeConsent !== false;
  }

  private respectsEmailBlocks(): boolean {
    return this.mailMessagingConfig?.mailConfig?.respectEmailBlocks === true;
  }

  blockExcludesFromSend(): boolean {
    return !!this.member?.emailBlock && this.respectsEmailBlocks();
  }

  notEmailableReason(): string | null {
    return this.consentMissing()
      ? "Head office marketing consent has been withheld. Existing subscriptions can be cleared."
      : null;
  }

  consentMissing(): boolean {
    return !!this.member && this.member.emailMarketingConsent === false && this.respectsHeadOfficeConsent() && !this.blockExcludesFromSend();
  }

  viewConsent(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.viewConsentRequested.emit();
  }

  onSubTabChange(value: BrevoTabSubTab): void {
    this.activeSubTab = value;
  }

  ngOnInit() {
    this.activeSubTab = this.member?.mail?.id ? BrevoTabSubTab.ACTIVITY : BrevoTabSubTab.AUDIT_LOG;
    this.initialiseSubscriptions();
  }

  viewBrevoContact(id: number) {
    if (id) {
      this.mailLinkService.openUrl(this.mailLinkService.contactView(id));
    }
  }

  blockReasonLabel(block: MemberEmailBlock): string {
    if (!block?.reasonCode) return "Unknown reason";
    return BLOCKED_CONTACT_REASON_LABELS[block.reasonCode] || block.reasonCode;
  }

  blockedTitle(): string {
    return this.member?.mail?.id ? "Blocked in Brevo" : "Blocked locally";
  }

  protected cancelEmailEnable(): void {
    this.confirmingEmailEnable = false;
    this.emailEnableError = null;
  }

  protected async enableEmail(): Promise<void> {
    const editedMember = this.member;
    if (this.allowEdits && this.confirmingEmailEnable && !this.enablingEmail && editedMember?.id && editedMember.email && editedMember.emailBlock) {
      this.enablingEmail = true;
      this.emailEnableError = null;
      try {
        const saved = await this.memberService.getById(editedMember.id);
        if (saved?.email?.trim().toLowerCase() !== editedMember.email.trim().toLowerCase()) {
          this.emailEnableError = "Save the email address change before re-enabling email.";
        } else {
          const result = await this.mailService.removeFromBlocklist(saved.email);
          if (result?.removed) {
            const updated = await this.memberService.getById(editedMember.id);
            editedMember.emailBlock = updated.emailBlock ?? null;
            const savedSubscriptions = new Map((saved.mail?.subscriptions ?? []).map(subscription => [subscription.id, subscription]));
            const updatedSubscriptions = updated.mail?.subscriptions ?? [];
            const listNames = new Map((this.mailMessagingConfig?.brevo?.lists?.lists ?? []).map(list => [list.id, list.name]));
            this.restoredEmailLists = updatedSubscriptions
              .filter(subscription => subscription.subscribed && savedSubscriptions.get(subscription.id)?.subscribed === false)
              .map(subscription => listNames.get(subscription.id) ?? `List ${subscription.id}`);
            if (editedMember.mail) {
              const updatedSubscriptionsById = new Map(updatedSubscriptions.map(subscription => [subscription.id, subscription]));
              editedMember.mail.subscriptions = (editedMember.mail.subscriptions ?? []).map(subscription =>
                subscription.subscribed === savedSubscriptions.get(subscription.id)?.subscribed
                  ? updatedSubscriptionsById.get(subscription.id) ?? subscription
                  : subscription);
            }
            this.emailEnabled = !editedMember.emailBlock;
            this.confirmingEmailEnable = false;
            if (this.emailEnabled) {
              if (this.brevoActivity) {
                this.brevoActivity.refresh();
              } else {
                this.refreshRequested.emit();
              }
            } else {
              this.emailEnableError = "Brevo accepted the request, but the member still has an email block. Try again.";
            }
          } else {
            this.emailEnableError = "Brevo did not confirm that the block was cleared.";
          }
        }
      } catch (error) {
        this.logger.error("Could not re-enable email", error);
        this.emailEnableError = "The email block could not be cleared. Try again.";
      } finally {
        this.enablingEmail = false;
      }
    }
  }

  formatBlockDate(timestamp: number | undefined): string {
    if (!timestamp) return "unknown date";
    return this.dateUtils.displayDateAbbreviatedTime(timestamp) || "unknown date";
  }

  linkTitle() {
    return this.member?.mail?.id ? "View contact details In Brevo" : "Contact not yet created in Brevo";
  }

  private listSetting(list: ListInfo): ListSetting {
    return this.mailMessagingConfig?.mailConfig?.listSettings?.find(item => item.id === list.id);
  }

  private initialiseListSubscription(list: ListInfo) {
    this.logger.info("constructed with:member:", this.member, "mailMessagingConfig:", this.mailMessagingConfig, "list:", list);
    if (this.mailMessagingConfig && list && this.member && !this.member.mail?.subscriptions?.find(mailSubscription => mailSubscription?.id === list.id)) {
      const listSetting: ListSetting = this.listSetting(list);
      const subscription: MailSubscription = {
        subscribed: this.mailMessagingService.subscribed(listSetting, this.member),
        id: list.id
      };
      if (!this.member?.mail?.subscriptions) {
        this.logger.info("mail subscription doesn't exist - creating default value:", subscription);
        this.member.mail = {...this.member.mail, subscriptions: [subscription]};
      } else if (!this.member?.mail.subscriptions?.find(mailSubscription => mailSubscription?.id === list.id)) {
        this.logger.info("mail subscription exists as", cloneDeep(this.member.mail.subscriptions), "but missing value for", list, "- adding value:", subscription);
        this.member.mail.subscriptions.push(subscription);
      }
    }
  }

  private initialiseSubscriptions() {
    if (this.mailMessagingConfig && this.systemConfig && this.member) {
      this.logger.info("constructed with:member:", this.member, "mailMessagingConfig:", this.mailMessagingConfig,);
      this.mailMessagingConfig?.brevo?.lists?.lists.forEach((list: ListInfo) => this.initialiseListSubscription(list));
      this.removeInvalidSubscriptions();
    } else {
      this.logger.info("initialiseSubscriptions:missing:member:", this.member, "mailMessagingConfig:", this.mailMessagingConfig, "systemConfig:", this.systemConfig);
    }
  }

  private removeInvalidSubscriptions() {
    this.logger.info("removeInvalidSubscriptions:before:", cloneDeep(this.member.mail.subscriptions));
    const validIds: number[] = this.mailMessagingConfig.brevo.lists.lists.map(list => list.id);
    this.member.mail.subscriptions = this.member.mail.subscriptions.filter(item => validIds.includes(item.id));
    this.logger.info("removeInvalidSubscriptions:after:", this.member.mail.subscriptions, "applying validIds:", validIds);
  }
}
