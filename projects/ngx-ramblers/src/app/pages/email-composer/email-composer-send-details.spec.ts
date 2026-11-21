import { ASCENDING, DESCENDING } from "../../models/table-filtering.model";
import { TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { ActivatedRoute, convertToParamMap, provideRouter } from "@angular/router";
import { BehaviorSubject } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailComposerSendDetailsComponent } from "./email-composer-send-details";
import { BatchSendEntryStatus, BatchSendStatus } from "../../models/email-composer.model";
import { UiActionsService } from "../../services/ui-actions.service";
import { StoredValue } from "../../models/ui-actions.model";
import { SortableTableComponent } from "../../modules/common/sortable-table/sortable-table.component";

describe("email send recipient detail at scale", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("renders only a page of 8000 recipients and restores sorting from the URL", async () => {
    const params = new BehaviorSubject(convertToParamMap({[StoredValue.BATCH_SEND_SORT]: "email", [StoredValue.BATCH_SEND_SORT_ORDER]: DESCENDING}));
    const updateQueryParameters = vi.fn();
    await TestBed.configureTestingModule({
      imports: [EmailComposerSendDetailsComponent],
      providers: [
        provideRouter([]),
        {provide: ActivatedRoute, useValue: {queryParamMap: params}},
        {provide: UiActionsService, useValue: {initialObjectValueFor: () => ({}), updateQueryParameters}}
      ]
    }).compileComponents();
    const fixture = TestBed.createComponent(EmailComposerSendDetailsComponent);
    fixture.componentRef.setInput("progress", {
      jobId: "example-job", status: BatchSendStatus.COMPLETED, totalRecipients: 8000, sentCount: 8000,
      failedCount: 0, skippedCount: 0, startedAt: 1,
      entries: Array.from({length: 8000}, (_, index) => ({
        memberId: `member-${index}`, fullName: "Alex Reed", email: `alex.${String(index).padStart(4, "0")}@example.com`, status: BatchSendEntryStatus.Sent
      }))
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll("tbody tr")).toHaveLength(50);
    expect(fixture.nativeElement.querySelector("tbody").textContent).toContain("alex.7999@example.com");
    const table = fixture.debugElement.query(By.directive(SortableTableComponent)).componentInstance;
    table.sortChange.emit({key: "status", direction: ASCENDING});
    expect(updateQueryParameters).toHaveBeenCalledWith({[StoredValue.BATCH_SEND_SORT]: "status", [StoredValue.BATCH_SEND_SORT_ORDER]: ASCENDING});
    params.next(convertToParamMap({[StoredValue.BATCH_SEND_SORT]: "email", [StoredValue.BATCH_SEND_SORT_ORDER]: ASCENDING}));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector("tbody").textContent).toContain("alex.0000@example.com");
    fixture.destroy();
  });
});
