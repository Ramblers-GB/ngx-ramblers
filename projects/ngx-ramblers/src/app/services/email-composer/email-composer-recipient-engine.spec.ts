import {TestBed} from "@angular/core/testing";
import {LoggerTestingModule} from "ngx-logger/testing";
import {afterEach, describe, expect, it, vi} from "vitest";
import {batchSendRecipientSplit, composerFilterToken, composerListToken, defaultEmailComposerState} from "../../functions/email-composer";
import {memberSubscribedToList} from "../../functions/member-send-eligibility";
import {BrandingMode, ComposerAudienceDefinition, ComposerAudienceScope, ComposerMemberLookupRequest, RecipientMode} from "../../models/email-composer.model";
import {ListInfo, MemberSelection} from "../../models/mail.model";
import {Member} from "../../models/member.model";
import {EmailComposerAudienceService} from "./email-composer-audience.service";
import {EmailComposerMemberDirectoryService} from "./email-composer-member-directory.service";
import {EmailComposerRecipientResolutionService} from "./email-composer-recipient-resolution.service";
import {EmailComposerRecipientSourcesService} from "./email-composer-recipient-sources.service";
import {EmailComposerSessionService} from "./email-composer-session.service";
import {MemberBulkLoadAuditService} from "../member/member-bulk-load-audit.service";

const LIST: ListInfo = {id: 3, name: "All members"} as ListInfo;
const COMMITTEE_LIST: ListInfo = {id: 9, name: "Committee"} as ListInfo;
const MEMBER_COUNT = 1200;

function memberId(index: number): string {
  return `64b${String(index).padStart(21, "0")}`;
}

const members: Member[] = Array.from({length: MEMBER_COUNT}, (_, index) => ({
  id: memberId(index),
  firstName: `Member${index}`,
  lastName: "Walker",
  email: `member${index}@example.com`,
  groupMember: true,
  committee: index < 2,
  mail: {subscriptions: [{id: LIST.id, subscribed: true}, ...(index < 2 ? [{id: COMMITTEE_LIST.id, subscribed: true}] : [])]}
} as Member));

function fakeServer() {
  const lookups: ComposerMemberLookupRequest[] = [];
  const audienceIds = (definition: ComposerAudienceDefinition) => definition.scope === ComposerAudienceScope.MAILING_LIST
    ? members.filter(member => memberSubscribedToList(member, definition.listId)).map(member => member.id)
    : members.map(member => member.id);
  return {
    lookups,
    listCounts: vi.fn(async (listIds: number[]) => listIds.map(listId => {
      const subscribers = members.filter(member => memberSubscribedToList(member, listId));
      return {listId, subscriberCount: subscribers.length, committeeOnly: subscribers.length > 0 && subscribers.every(member => member.committee)};
    })),
    memberIds: vi.fn(async (definition: ComposerAudienceDefinition) => audienceIds(definition)),
    members: vi.fn(async (request: ComposerMemberLookupRequest) => {
      lookups.push(request);
      return members.filter(member => (request.memberIds ?? []).includes(member.id) || (request.committee && member.committee));
    }),
    filterSelection: vi.fn()
  };
}

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function engine(configure: (state: ReturnType<typeof defaultEmailComposerState>) => void) {
  const state = defaultEmailComposerState();
  state.brandingMode = BrandingMode.BRANDED;
  configure(state);
  const server = fakeServer();
  TestBed.configureTestingModule({
    imports: [LoggerTestingModule],
    providers: [
      EmailComposerMemberDirectoryService,
      EmailComposerRecipientSourcesService,
      EmailComposerRecipientResolutionService,
      {provide: EmailComposerSessionService, useValue: {state}},
      {provide: EmailComposerAudienceService, useValue: server},
      {provide: MemberBulkLoadAuditService, useValue: {createMemberBulkLoadDateMap: async () => ({})}}
    ]
  });
  const sources = TestBed.inject(EmailComposerRecipientSourcesService);
  sources.mailMessagingConfig = {brevo: {lists: {lists: [LIST, COMMITTEE_LIST]}}} as any;
  await Promise.all([sources.loadCommitteeMembers(), sources.loadListFacts()]);
  return {state, server, sources, resolution: TestBed.inject(EmailComposerRecipientResolutionService)};
}

describe("composer recipient engine without every member in the browser", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("submits an 8000-person mailing list as a definition without fetching member records", async () => {
    const {resolution, server} = await engine(state => {
      state.recipientMode = RecipientMode.ENTIRE_LIST;
      state.selectedListId = LIST.id;
      state.externalRecipients = [composerListToken(LIST.id, LIST.name, 8000)];
    });
    const lookupsBefore = server.lookups.length;
    const selection = resolution.batchRecipientSelection();
    expect(selection.audiences.to).toEqual([{scope: ComposerAudienceScope.MAILING_LIST, recipientMode: RecipientMode.ENTIRE_LIST, listId: LIST.id}]);
    expect(selection.memberIds).toEqual([]);
    expect(selection.externalRecipients).toEqual([]);
    expect(server.lookups).toHaveLength(lookupsBefore);
    expect(JSON.stringify(selection).length).toBeLessThan(500);
  });

  it("retains exactly the chosen filter members without fetching their records", async () => {
    const ids = Array.from({length: 8000}, (_, index) => memberId(index));
    const {resolution, server} = await engine(state => {
      state.recipientMode = RecipientMode.SELECTED_MEMBERS;
      state.selectedMemberIds = ids;
      state.externalRecipients = [composerFilterToken(MemberSelection.RECENTLY_ADDED, "Added recently", ids.length)];
    });
    const lookupsBefore = server.lookups.length;
    expect(resolution.batchRecipientSelection().audiences.to[0].memberIds).toEqual(ids);
    const preview = resolution.previewSendEntries();
    expect(preview).toHaveLength(8000);
    expect(resolution.previewSendEntries()).toBe(preview);
    expect(server.lookups).toHaveLength(lookupsBefore);
  });

  it("shares concurrent requests for the same member", async () => {
    const {sources, server} = await engine(() => null);
    const pending: {resolve: ((people: Member[]) => void) | null} = {resolve: null};
    server.members.mockImplementationOnce(() => new Promise(resolve => pending.resolve = resolve));
    const callsBefore = server.members.mock.calls.length;
    const first = sources.ensureMembers([members[10].id]);
    const second = sources.ensureMembers([members[10].id]);
    await Promise.resolve();
    expect(server.members.mock.calls.length).toBe(callsBefore + 1);
    pending.resolve([members[10]]);
    await Promise.all([first, second]);
    expect(sources.memberById(members[10].id)).toEqual(members[10]);
  });

  it("retries audience lookup after a temporary failure", async () => {
    const {sources, server} = await engine(() => null);
    server.memberIds.mockRejectedValueOnce(new Error("Temporary network failure"));
    await expect(sources.everyoneMemberIds()).rejects.toThrow("Temporary network failure");
    expect(sources.knownEveryoneMemberIds()).toBeNull();
    expect(server.memberIds).toHaveBeenCalledTimes(1);
    expect(await sources.everyoneMemberIds()).toHaveLength(MEMBER_COUNT);
    expect(server.memberIds).toHaveBeenCalledTimes(2);
  });

  it("keeps every member of a large filter selection in the send, even before any of their records are loaded", async () => {
    const selectedIds = members.map(member => member.id);
    const {state, resolution} = await engine(composerState => {
      composerState.recipientMode = RecipientMode.SELECTED_MEMBERS;
      composerState.preFilterKey = MemberSelection.RECENTLY_ADDED;
      composerState.selectedMemberIds = selectedIds;
      composerState.externalRecipients = [composerFilterToken(MemberSelection.RECENTLY_ADDED, "Added in last month", selectedIds.length)];
    });
    const expansion = resolution.expandHeaders(state.externalRecipients);
    const sendIds = new Set([...batchSendRecipientSplit(expansion.recipients).memberIds, ...expansion.unresolvedMemberIds]);
    expect(sendIds.size).toBe(MEMBER_COUNT);
    expect(selectedIds.every(id => sendIds.has(id))).toBe(true);
    expect(resolution.totalRecipientCount()).toBe(MEMBER_COUNT);
    expect(state.selectedMemberIds).toEqual(selectedIds);
  });

  it("does not turn a few chosen people into a campaign to the whole list when only their records are loaded", async () => {
    const chosen = [members[0], members[1]];
    const {resolution} = await engine(composerState => {
      composerState.recipientMode = RecipientMode.SELECTED_MEMBERS;
      composerState.narrowListId = LIST.id;
      composerState.selectedMemberIds = chosen.map(member => member.id);
      composerState.externalRecipients = chosen.map(member => ({email: member.email, name: member.firstName, memberId: member.id}));
    });
    expect(resolution.wholeMailingListSelected()).toBe(false);
    await flush();
    expect(resolution.wholeMailingListSelected()).toBe(false);
    expect(resolution.sendingAsCampaign()).toBe(false);
  });

  it("recognises the whole list is chosen once the list's member ids arrive from the server", async () => {
    const {state, resolution, sources} = await engine(composerState => {
      composerState.recipientMode = RecipientMode.SELECTED_MEMBERS;
      composerState.narrowListId = LIST.id;
      composerState.externalRecipients = [composerListToken(LIST.id, LIST.name, MEMBER_COUNT)];
    });
    state.selectedMemberIds = await sources.listMemberIdsForList(LIST.id);
    expect(state.selectedMemberIds).toHaveLength(MEMBER_COUNT);
    expect(resolution.wholeMailingListSelected()).toBe(true);
  });

  it("never treats a large audience as committee only because most of its records are not loaded", async () => {
    const selectedIds = members.map(member => member.id);
    const {resolution} = await engine(composerState => {
      composerState.recipientMode = RecipientMode.SELECTED_MEMBERS;
      composerState.selectedMemberIds = selectedIds;
      composerState.externalRecipients = [composerFilterToken(MemberSelection.RECENTLY_ADDED, "Added in last month", selectedIds.length)];
    });
    expect(resolution.committeeOnlyAudience()).toBe(false);
  });

  it("still recognises a committee list, whose members are always loaded", async () => {
    const {state, resolution} = await engine(composerState => {
      composerState.recipientMode = RecipientMode.ENTIRE_LIST;
      composerState.selectedListId = COMMITTEE_LIST.id;
      composerState.externalRecipients = [composerListToken(COMMITTEE_LIST.id, COMMITTEE_LIST.name, 2)];
    });
    resolution.expandHeaders(state.externalRecipients);
    await flush();
    expect(resolution.committeeOnlyAudience()).toBe(true);
    expect(resolution.totalRecipientCount()).toBe(2);
  });
});
