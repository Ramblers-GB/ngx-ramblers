import {Component, EventEmitter, inject, Input, OnChanges, Output, SimpleChanges} from "@angular/core";
import {NgxLoggerLevel} from "ngx-logger";
import {MemberSelection, NotificationConfig} from "../../models/mail.model";
import {ComposerFilterSelection, PriorSendExclusion, RECIPIENT_PRE_FILTERS, RecipientMode, RecipientPreFilter} from "../../models/email-composer.model";
import {LoggerFactory} from "../../services/logger-factory.service";
import {EmailComposerRecipientSourcesService} from "../../services/email-composer/email-composer-recipient-sources.service";
import {EmailComposerRecipientResolutionService} from "../../services/email-composer/email-composer-recipient-resolution.service";

@Component({
  selector: "app-email-composer-member-filter",
  template: `
    @if (applicablePreFilters().length > 0) {
      <div class="mb-2">
        <div class="fw-semibold mb-1">Member filter</div>
        @for (filter of applicablePreFilters(); track filter.key) {
          <div class="form-check">
            <input class="form-check-input" type="radio"
                   [id]="'pre-filter-' + (filter.key ?? 'all-with-email')" name="member-pre-filter"
                   [checked]="activePreFilterKey === filter.key && !manualMode"
                   (click)="applyPreFilter(filter.key)">
            <label class="form-check-label" [for]="'pre-filter-' + (filter.key ?? 'all-with-email')">{{ labelFor(filter) }}</label>
          </div>
        }
      </div>
    }
  `
})
export class EmailComposerMemberFilterComponent implements OnChanges {
  private logger = inject(LoggerFactory).createLogger("EmailComposerMemberFilterComponent", NgxLoggerLevel.ERROR);
  private recipientSources = inject(EmailComposerRecipientSourcesService);
  private resolution = inject(EmailComposerRecipientResolutionService);
  @Input() selectedIds: string[] = [];
  @Input() preFilterKey: MemberSelection | null = null;
  @Input() notificationConfig: NotificationConfig | null = null;
  @Input() narrowListId: number | null = null;
  @Input() recipientMode: RecipientMode = RecipientMode.SELECTED_MEMBERS;
  @Input() membersRevision = 0;
  @Input() includeAlreadySent = false;
  @Output() selectedIdsChange = new EventEmitter<string[]>();
  @Output() preFilterKeyChange = new EventEmitter<MemberSelection | null>();
  @Output() priorSendExclusionsChange = new EventEmitter<PriorSendExclusion[]>();
  protected activePreFilterKey: MemberSelection | null = null;
  protected manualMode = true;
  private priorSendExclusions: PriorSendExclusion[] = [];
  private selectionToken = 0;
  private selectionPending = false;

  protected applicablePreFilters(): RecipientPreFilter[] {
    const selection = this.notificationConfig?.defaultMemberSelection;
    return selection ? RECIPIENT_PRE_FILTERS.filter(filter => filter.key === selection) : RECIPIENT_PRE_FILTERS;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["preFilterKey"] || changes["notificationConfig"] || changes["narrowListId"] || changes["recipientMode"] || changes["membersRevision"]) {
      this.activePreFilterKey = this.preFilterKey;
      this.manualMode = !this.preFilterKey;
      this.selectionPending = this.selectionPending || (!!changes["notificationConfig"] && !this.manualMode);
      void this.refreshSelection();
    }
    if (changes["includeAlreadySent"] && !changes["includeAlreadySent"].firstChange && !this.manualMode) {
      this.applyAlreadySentDelta();
    }
  }

  applyPreFilter(key: MemberSelection | null): void {
    this.activePreFilterKey = key;
    this.manualMode = false;
    this.selectionPending = true;
    this.preFilterKeyChange.emit(key);
    void this.refreshSelection();
  }

  private async refreshSelection(): Promise<void> {
    const token = ++this.selectionToken;
    const applySelection = this.selectionPending;
    const sentIds = applySelection ? [] : this.selectedIds;
    try {
      const selection = await this.recipientSources.filterSelection({
        notificationConfigId: this.notificationConfig?.id ?? null,
        recipientMode: this.recipientMode,
        preFilterKey: this.activePreFilterKey,
        narrowListId: this.narrowListId,
        includeAlreadySent: this.includeAlreadySent,
        keepMemberIds: sentIds
      });
      if (token === this.selectionToken) {
        this.applyServerSelection(selection, applySelection, sentIds);
      }
    } catch (error) {
      if (token === this.selectionToken) {
        this.logger.warn("Could not work out the member filter selection:", error);
      }
    }
  }

  private applyServerSelection(selection: ComposerFilterSelection, applySelection: boolean, sentIds: string[]): void {
    this.refreshExclusions(this.manualMode ? [] : selection.priorSendExclusions);
    if (applySelection) {
      this.selectionPending = false;
      this.selectedIdsChange.emit(selection.memberIds);
    } else {
      const kept = new Set(selection.keptMemberIds);
      const dropped = new Set(sentIds.filter(id => !kept.has(id)));
      const remaining = this.selectedIds.filter(id => !dropped.has(id));
      if (remaining.length !== this.selectedIds.length) {
        this.selectedIdsChange.emit(remaining);
      }
    }
  }

  private refreshExclusions(exclusions: PriorSendExclusion[]): void {
    const changed = exclusions.length !== this.priorSendExclusions.length
      || exclusions.some((entry, index) => entry.memberId !== this.priorSendExclusions[index]?.memberId || entry.sentAt !== this.priorSendExclusions[index]?.sentAt);
    this.priorSendExclusions = exclusions;
    if (changed) {
      this.priorSendExclusionsChange.emit(exclusions);
    }
  }

  private applyAlreadySentDelta(): void {
    const alreadySent = this.priorSendExclusions.map(entry => entry.memberId);
    if (this.includeAlreadySent) {
      const selected = new Set(this.selectedIds);
      const additions = alreadySent.filter(id => !selected.has(id));
      if (additions.length > 0) {
        this.selectedIdsChange.emit([...this.selectedIds, ...additions]);
      }
    } else {
      const drop = new Set(alreadySent);
      const next = this.selectedIds.filter(id => !drop.has(id));
      if (next.length !== this.selectedIds.length) {
        this.selectedIdsChange.emit(next);
      }
    }
  }

  protected labelFor(filter: RecipientPreFilter): string {
    return filter.key ? this.resolution.memberSelectionChipLabel(filter.key) : filter.label;
  }
}
