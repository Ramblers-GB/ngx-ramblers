import {TestBed} from "@angular/core/testing";
import {LoggerTestingModule} from "ngx-logger/testing";
import {EmailComposerMemberFilterComponent} from "./email-composer-member-filter";
import {EmailComposerRecipientResolutionService} from "../../services/email-composer/email-composer-recipient-resolution.service";
import {EmailComposerRecipientSourcesService} from "../../services/email-composer/email-composer-recipient-sources.service";
import {MemberSelection} from "../../models/mail.model";
import {ComposerFilterSelectionRequest} from "../../models/email-composer.model";

describe("composer member filters worked out on the server", () => {
  const exclusion = {memberId: "already-sent", name: "Sam Taylor", sentAt: 100};

  async function setup() {
    const filterSelection = vi.fn(async (request: ComposerFilterSelectionRequest) => ({
      candidateCount: 7,
      memberIds: request.includeAlreadySent ? ["available", "also-recent", "already-sent"] : ["available", "also-recent"],
      keptMemberIds: (request.keepMemberIds ?? []).filter(id => id !== "no-consent"),
      priorSendExclusions: request.preFilterKey ? [exclusion] : []
    }));
    await TestBed.configureTestingModule({
      imports: [EmailComposerMemberFilterComponent, LoggerTestingModule],
      providers: [
        {provide: EmailComposerRecipientResolutionService, useValue: {memberSelectionChipLabel: () => "Recently added members"}},
        {provide: EmailComposerRecipientSourcesService, useValue: {filterSelection}}
      ]
    }).compileComponents();
    const fixture = TestBed.createComponent(EmailComposerMemberFilterComponent);
    const selected = vi.fn();
    const exclusions = vi.fn();
    fixture.componentInstance.selectedIdsChange.subscribe((ids: string[]) => {
      selected(ids);
      fixture.componentRef.setInput("selectedIds", ids);
    });
    fixture.componentInstance.priorSendExclusionsChange.subscribe(exclusions);
    fixture.componentRef.setInput("selectedIds", ["available", "no-consent"]);
    fixture.componentRef.setInput("notificationConfig", {id: "notification", defaultMemberSelection: MemberSelection.RECENTLY_ADDED});
    fixture.detectChanges();
    await fixture.whenStable();
    return {fixture, filterSelection, selected, exclusions};
  }

  it("drops people who can no longer be emailed without selecting anyone else on opening", async () => {
    const {fixture, filterSelection, selected} = await setup();
    expect(fixture.nativeElement.querySelectorAll("input[type=radio]").length).toBe(1);
    expect(filterSelection.mock.calls[0][0]).toEqual(expect.objectContaining({notificationConfigId: "notification", preFilterKey: null, keepMemberIds: ["available", "no-consent"]}));
    expect(selected).toHaveBeenCalledWith(["available"]);
  });

  it("applies the server selection and its prior-send exclusions when a filter is chosen", async () => {
    const {fixture, selected, exclusions} = await setup();
    fixture.componentInstance.applyPreFilter(MemberSelection.RECENTLY_ADDED);
    await fixture.whenStable();
    expect(selected).toHaveBeenLastCalledWith(["available", "also-recent"]);
    expect(exclusions).toHaveBeenCalledWith([exclusion]);
  });

  it("toggles already-sent members without reselecting people the user had removed", async () => {
    const {fixture} = await setup();
    fixture.componentInstance.applyPreFilter(MemberSelection.RECENTLY_ADDED);
    await fixture.whenStable();
    fixture.componentRef.setInput("preFilterKey", MemberSelection.RECENTLY_ADDED);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentRef.setInput("selectedIds", ["available"]);
    fixture.componentRef.setInput("includeAlreadySent", true);
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedIds).toEqual(["available", "already-sent"]);
    fixture.componentRef.setInput("includeAlreadySent", false);
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedIds).toEqual(["available"]);
  });
});
