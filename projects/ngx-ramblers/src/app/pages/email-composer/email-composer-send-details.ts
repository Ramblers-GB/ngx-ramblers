import { Component, inject, Input, OnChanges, OnDestroy, OnInit } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { Subscription } from "rxjs";
import { BatchSendDetailRow, BatchSendProgress, ComposerExternalRecipient, RecipientField } from "../../models/email-composer.model";
import { StoredValue } from "../../models/ui-actions.model";
import { ASCENDING, DESCENDING } from "../../models/table-filtering.model";
import { SortableTableComponent } from "../../modules/common/sortable-table/sortable-table.component";
import { SortableTableColumn, SortableTableSortState } from "../../modules/common/sortable-table/sortable-table.model";
import { UiActionsService } from "../../services/ui-actions.service";

@Component({
  selector: "app-email-composer-send-details",
  imports: [SortableTableComponent],
  template: `
    <app-sortable-table [rows]="rows" [columns]="columns" [pageSize]="50" [trackBy]="trackRow"
                        [defaultSortKey]="sortKey" [defaultSortDirection]="sortDirection"
                        emptyMessage="No recipient details available yet." (sortChange)="sortChanged($event)"/>
  `
})
export class EmailComposerSendDetailsComponent implements OnChanges, OnInit, OnDestroy {
  @Input() progress: BatchSendProgress | null = null;
  @Input() cc: ComposerExternalRecipient[] = [];
  @Input() bcc: ComposerExternalRecipient[] = [];
  private route = inject(ActivatedRoute);
  private uiActions = inject(UiActionsService);
  private subscriptions: Subscription[] = [];
  protected rows: BatchSendDetailRow[] = [];
  protected sortKey = "fullName";
  protected sortDirection = ASCENDING;
  protected columns: SortableTableColumn<BatchSendDetailRow>[] = [
    {key: "fullName", label: "Member", sortKey: "fullName", cellGetter: row => row.fullName},
    {key: "email", label: "Email", sortKey: "email", cellGetter: row => row.email},
    {key: "status", label: "Status", sortKey: "status", cellGetter: row => row.status},
    {key: "notes", label: "Notes", sortKey: "notes", cellGetter: row => row.notes}
  ];
  protected trackRow = (_index: number, row: BatchSendDetailRow) => row.id;

  ngOnInit(): void {
    this.subscriptions.push(this.route.queryParamMap.subscribe(params => {
      const key = params.get(StoredValue.BATCH_SEND_SORT);
      this.sortKey = this.columns.some(column => column.sortKey === key) ? key : "fullName";
      this.sortDirection = params.get(StoredValue.BATCH_SEND_SORT_ORDER) === DESCENDING ? DESCENDING : ASCENDING;
    }));
  }

  ngOnChanges(): void {
    const copies = (recipients: ComposerExternalRecipient[], field: RecipientField, notes: string): BatchSendDetailRow[] => recipients.map(recipient => ({
      id: `${field}:${recipient.email}`, fullName: recipient.name || "", email: recipient.email, status: field, notes
    }));
    this.rows = [
      ...(this.progress?.entries ?? []).map(entry => ({
        id: entry.memberId, fullName: entry.fullName, email: entry.email || "no email address",
        status: entry.notEmailable ? "not emailable" : entry.status,
        notes: [entry.errorMessage, entry.note].filter(Boolean).join(" — ")
      })),
      ...copies(this.progress?.ccRecipients ?? this.cc, RecipientField.CC, "copied on every send above"),
      ...copies(this.progress?.bccRecipients ?? this.bcc, RecipientField.BCC, "blind copied on every send above")
    ];
  }

  protected sortChanged(state: SortableTableSortState): void {
    this.sortKey = state.key ?? "fullName";
    this.sortDirection = state.direction;
    void this.uiActions.updateQueryParameters({[StoredValue.BATCH_SEND_SORT]: this.sortKey, [StoredValue.BATCH_SEND_SORT_ORDER]: this.sortDirection});
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
  }
}
