import {TestBed} from "@angular/core/testing";
import {describe, expect, it, vi} from "vitest";
import {LoggerTestingModule} from "ngx-logger/testing";
import {EmailComposerEventSelectionService} from "./email-composer-event-selection.service";
import {EmailComposerSessionService} from "./email-composer-session.service";
import {EmailComposerFragmentsService} from "./email-composer-fragments.service";
import {CommitteeQueryService} from "../committee/committee-query.service";
import {WalksAndEventsService} from "../walks-and-events/walks-and-events.service";
import {CommitteeDisplayService} from "../../pages/committee/committee-display.service";
import {MediaQueryService} from "../committee/media-query.service";
import {StringUtilsService} from "../string-utils.service";
import {GroupEventService} from "../walks-and-events/group-event.service";
import {DateUtilsService} from "../date-utils.service";
import {defaultEmailComposerState} from "../../functions/email-composer";
import {ComposerFragmentKind, EventInclusionMode} from "../../models/email-composer.model";
import {GroupEventSummary} from "../../models/committee.model";

describe("composer event selection", () => {
  function setup() {
    const state = defaultEmailComposerState();
    state.eventInclusion = EventInclusionMode.AUTO_INCLUDE;
    state.groupEventsFilter = {
      search: null, selectAll: true, fromDate: {value: 1} as any, toDate: {value: 2} as any,
      includeImage: true, includeContact: true, includeDescription: true, includeLocation: true,
      includeWalks: true, includeSocialEvents: true, includeCommitteeEvents: true
    };
    const groupEvents = vi.fn().mockResolvedValue([
      {id: "ready", title: "Hillside Park", selected: false} as GroupEventSummary,
      {id: "draft", title: "Untitled walk slot", selected: false} as GroupEventSummary
    ]);
    TestBed.configureTestingModule({
      imports: [LoggerTestingModule],
      providers: [
        EmailComposerEventSelectionService,
        {provide: EmailComposerSessionService, useValue: {state, newsletterMode: () => false, eventsStepOmitted: () => false}},
        {provide: EmailComposerFragmentsService, useValue: {hasFragmentKindAtTopLevel: () => true, expandedFragmentIds: new Set()}},
        {provide: CommitteeQueryService, useValue: {groupEvents}},
        {provide: WalksAndEventsService, useValue: {}},
        {provide: CommitteeDisplayService, useValue: {}},
        {provide: MediaQueryService, useValue: {}},
        {provide: StringUtilsService, useValue: {kebabCase: value => value}},
        {provide: GroupEventService, useValue: {}},
        {provide: DateUtilsService, useValue: {
          dateTimeNow: () => {
            const stamp = {
              startOf: () => stamp,
              minus: () => stamp,
              plus: () => stamp,
              endOf: () => stamp,
              toMillis: () => 1
            };
            return stamp;
          },
          dateTimeNowNoTime: () => ({toMillis: () => 1, plus: () => ({toMillis: () => 2})}),
          asDateValue: value => ({value})
        }}
      ]
    });
    return {state, groupEvents, events: TestBed.inject(EmailComposerEventSelectionService)};
  }

  it("keeps ticks the coordinator has already chosen when the list is queried again", () => {
    const {events} = setup();
    const prior = {id: "draft", selected: true} as GroupEventSummary;
    expect(events.mergePriorSelection({id: "draft", selected: false} as GroupEventSummary, prior).selected).toBe(true);
    expect(events.mergePriorSelection({id: "ready", selected: false} as GroupEventSummary).selected).toBe(true);
  });

  it("does not query events again when the date range and types have not changed", async () => {
    const {state, groupEvents, events} = setup();
    await events.populateGroupEvents();
    state.groupEvents[1].selected = true;
    await events.populateGroupEvents();
    expect(groupEvents).toHaveBeenCalledTimes(1);
    expect(state.groupEvents.find(event => event.id === "draft")?.selected).toBe(true);
  });
});

describe("adding the events section", () => {
  it("keeps the intro when the events list is first added on an empty compose", () => {
    const state = defaultEmailComposerState();
    const fragmentEditor = Object.assign(Object.create(EmailComposerFragmentsService.prototype), {
      expandedFragmentIds: new Set<string>()
    }) as EmailComposerFragmentsService;
    const events = Object.assign(Object.create(EmailComposerEventSelectionService.prototype), {
      session: {state, eventsStepOmitted: () => false},
      fragmentEditor
    }) as EmailComposerEventSelectionService;
    events.addEventsFragment();
    expect(state.fragmentOrder.map(fragment => fragment.kind)).toContain(ComposerFragmentKind.INTRO);
    expect(state.fragmentOrder.map(fragment => fragment.kind)).toContain(ComposerFragmentKind.EVENTS);
  });
});
