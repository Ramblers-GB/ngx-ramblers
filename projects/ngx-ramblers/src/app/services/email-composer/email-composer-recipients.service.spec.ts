import {DateTime} from "luxon";
import {TestBed} from "@angular/core/testing";
import {afterEach, describe, expect, it, vi} from "vitest";
import {composerCommitteeRoleSendOffered, composerListToken, composerRecipientFromMember, composerSharesRecipientHeaders, defaultEmailComposerState} from "../../functions/email-composer";
import {BrandingMode, ComposerExternalRecipient, ComposerFilterSelectionRequest, RecipientAddressMode, RecipientField, RecipientMode, SendingChannel} from "../../models/email-composer.model";
import {fakeComposerSources} from "../../testing/fake-composer-sources";
import {StoredValue} from "../../models/ui-actions.model";
import {CommitteeMember} from "../../models/committee.model";
import {Member} from "../../models/member.model";
import {ListInfo, MemberSelection, NotificationConfig, WorkflowAction} from "../../models/mail.model";
import {MailListUpdaterService} from "../mail/mail-list-updater.service";
import {EmailComposerSessionService} from "./email-composer-session.service";
import {EmailComposerRecipientSourcesService} from "./email-composer-recipient-sources.service";
import {EmailComposerRecipientResolutionService} from "./email-composer-recipient-resolution.service";
import {EmailComposerRecipientsService} from "./email-composer-recipients.service";

function resolverPrototype(): EmailComposerRecipientResolutionService {
  const resolver = Object.create(EmailComposerRecipientResolutionService.prototype);
  return Object.assign(resolver, {memberIndexes: new WeakMap()});
}

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function recentlyAdded(members: Member[], since: number): (request: ComposerFilterSelectionRequest) => string[] {
  return request => members.filter(member => !request.preFilterKey || (member.createdDate ?? 0) >= since).map(member => member.id);
}

describe("composer list expansion", () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it("keeps the chosen committee pill and its recipient count when member-loading cleanup runs", () => {
    const state = defaultEmailComposerState();
    state.brandingMode = BrandingMode.UNBRANDED;
    const list = {id: 7, name: "Committee"} as ListInfo;
    const members = ["alex", "sam", "casey"].map(id => ({id, email: `${id}@example.com`, committee: true} as Member));
    const pool = fakeComposerSources({members, lists: [list], subscribed: () => true, committeeOnlyListIds: [list.id]});
    const updater = {memberSubscribed: () => true};
    const session = {state, inboxReplyContext: null, syncStateToUrl: vi.fn()};
    const resolver = resolverPrototype();
    Object.assign(resolver, {session, pool, mailListUpdaterService: updater});
    TestBed.configureTestingModule({providers: [
      EmailComposerRecipientsService,
      {provide: EmailComposerSessionService, useValue: session},
      {provide: MailListUpdaterService, useValue: updater},
      {provide: EmailComposerRecipientSourcesService, useValue: pool},
      {provide: EmailComposerRecipientResolutionService, useValue: resolver}
    ]});
    const service = TestBed.inject(EmailComposerRecipientsService);

    service.selectUnbrandedCommitteeList(list);
    service.clearUnsupportedUnbrandedBulkRecipients();

    expect(state.externalRecipients).toEqual([composerListToken(list.id, list.name, members.length)]);
    expect(resolver.unbrandedSelectedListId()).toBe(list.id);
    expect(resolver.totalRecipientCount()).toBe(members.length);
    expect(resolver.unbrandedListExpanded()).toBe(false);

    state.ccRecipients = [composerListToken(42, "Group members", 12)];
    state.bccRecipients = [{email: "guest@example.com"}];
    service.clearUnsupportedUnbrandedBulkRecipients();
    expect(state.externalRecipients[0].listId).toBe(list.id);
    expect(state.ccRecipients).toEqual([]);
    expect(state.bccRecipients).toEqual([{email: "guest@example.com"}]);

    state.bccRecipients = [];
    service.onUnbrandedToChange([...state.externalRecipients, {email: "guest@example.com"}]);

    expect(state.recipientMode).toBe(RecipientMode.SELECTED_MEMBERS);
    expect(state.externalRecipients.filter(recipient => recipient.fromBulkAudience).map(recipient => recipient.email))
      .toEqual(members.map(member => member.email));
    expect(composerSharesRecipientHeaders(state, false, resolver.committeeOnlyAudience())).toBe(false);
  });

  it("clears list, filter, header and member selections together for an unbranded audience reset", () => {
    const state = defaultEmailComposerState();
    state.brandingMode = BrandingMode.UNBRANDED;
    state.recipientMode = RecipientMode.ENTIRE_LIST;
    state.sendingChannel = SendingChannel.CAMPAIGN;
    state.selectedListId = 42;
    state.narrowListId = 42;
    state.preFilterKey = MemberSelection.EXPIRED_MEMBERS;
    state.selectedMemberIds = ["alex", "sam"];
    state.externalRecipients = [composerListToken(42, "Group members", 12)];
    state.ccRecipients = [{email: "alex.reed@example.com"}];
    state.bccRecipients = [{email: "sam@example.com"}];
    const syncStateToUrl = vi.fn();
    TestBed.configureTestingModule({providers: [
      EmailComposerRecipientsService,
      {provide: EmailComposerSessionService, useValue: {state, inboxReplyContext: null, syncStateToUrl}},
      {provide: MailListUpdaterService, useValue: {}},
      {provide: EmailComposerRecipientSourcesService, useValue: {members: () => []}},
      {provide: EmailComposerRecipientResolutionService, useValue: {
        sendingAsCampaign: () => false, committeeRoleSendOffered: () => false, committeeOnlyAudience: () => false
      }}
    ]});
    const service = TestBed.inject(EmailComposerRecipientsService);
    service.expandedRecipientListIds.add(42);
    service.expandedRecipientFilterKeys.add(MemberSelection.EXPIRED_MEMBERS);
    service.expandedEveryoneSet = true;

    service.clearRecipientSelection();

    expect(state.recipientMode).toBe(RecipientMode.SELECTED_MEMBERS);
    expect(state.sendingChannel).toBe(SendingChannel.TRANSACTIONAL_BATCH);
    expect(state.selectedListId).toBeNull();
    expect(state.narrowListId).toBeNull();
    expect(state.preFilterKey).toBeNull();
    expect(state.selectedMemberIds).toEqual([]);
    expect(state.externalRecipients).toEqual([]);
    expect(state.ccRecipients).toEqual([]);
    expect(state.bccRecipients).toEqual([]);
    expect(service.expandedRecipientListIds.size).toBe(0);
    expect(service.expandedRecipientFilterKeys.size).toBe(0);
    expect(service.expandedEveryoneSet).toBe(false);
    expect(syncStateToUrl).toHaveBeenCalledWith({[StoredValue.LIST_ID]: null});
    expect(syncStateToUrl).toHaveBeenCalledWith({[StoredValue.EMAIL_TYPE]: "selected-members", [StoredValue.PRE_FILTER]: null});
  });

  it("does not treat a committee list with a non-committee Cc or Bcc as a committee-only audience", () => {
    const state = defaultEmailComposerState();
    state.recipientMode = RecipientMode.ENTIRE_LIST;
    state.selectedListId = 7;
    state.externalRecipients = [{email: "chair@group.example.org.uk", memberId: "alex"}];
    state.ccRecipients = [{email: "guest@example.com"}];
    const resolver = resolverPrototype();
    Object.assign(resolver, {
      session: {state},
      pool: fakeComposerSources({members: [{id: "alex", email: "alex.reed@example.com", committee: true} as Member], lists: [{id: 7, name: "Committee"} as ListInfo], subscribed: () => true, committeeOnlyListIds: [7]})
    });

    expect(resolver.committeeOnlyAudience()).toBe(false);
    state.bccRecipients = state.ccRecipients;
    state.ccRecipients = [];
    expect(resolver.committeeOnlyAudience()).toBe(false);
    state.bccRecipients = [];
    expect(resolver.committeeOnlyAudience()).toBe(true);
  });

  it.each([RecipientField.TO, RecipientField.CC, RecipientField.BCC])("rejects a non-committee list on %s in unbranded mode", field => {
    const state = defaultEmailComposerState();
    state.brandingMode = BrandingMode.UNBRANDED;
    state.recipientMode = RecipientMode.SELECTED_MEMBERS;
    const recipientFields = {[RecipientField.TO]: "externalRecipients", [RecipientField.CC]: "ccRecipients", [RecipientField.BCC]: "bccRecipients"};
    state[recipientFields[field]] = [composerListToken(42, "Group members", 3)];
    const resolver = resolverPrototype();
    Object.assign(resolver, {session: {state}, pool: {unbrandedCommitteeLists: () => [{id: 7}]}});
    expect(resolver.unbrandedListsAllowed()).toBe(false);
    state[recipientFields[field]] = [composerListToken(7, "Committee", 2)];
    expect(resolver.unbrandedListsAllowed()).toBe(true);
  });

  it("keeps a mailing-list pill until expanded, then keeps its individual recipients through picker updates", async () => {
    const members = [...new Set([..."abcdefghijkl"])].map(id => ({id, firstName: "Alex", lastName: id, email: `${id}@example.com`} as Member));
    const outside = {id: "outside", email: "outside@example.com"} as Member;
    const list = {id: 42, name: "Group members"} as ListInfo;
    const state = defaultEmailComposerState();
    state.brandingMode = BrandingMode.BRANDED;
    state.recipientMode = RecipientMode.ENTIRE_LIST;
    state.selectedListId = list.id;
    state.preFilterKey = null;
    state.externalRecipients = [composerListToken(list.id, list.name, members.length)];
    const ids = members.map(member => member.id);
    TestBed.configureTestingModule({providers: [
      EmailComposerRecipientsService,
      {provide: EmailComposerSessionService, useValue: {state, inboxReplyContext: null, syncStateToUrl: vi.fn()}},
      {provide: MailListUpdaterService, useValue: {memberSubscribed: (member: Member) => member.id !== outside.id}},
      {provide: EmailComposerRecipientSourcesService, useValue: fakeComposerSources({members: [...members, outside], lists: [list], subscribed: member => member.id !== outside.id})},
      {provide: EmailComposerRecipientResolutionService, useValue: {
        committeeRoleSendOffered: () => false,
        committeeOnlyAudience: () => false,
        sendingAsCampaign: () => state.recipientMode === RecipientMode.ENTIRE_LIST,
        memberRecipientsForIds: (selectedIds: string[]) => members.filter(member => selectedIds.includes(member.id))
          .map(member => composerRecipientFromMember(member)).filter((recipient): recipient is ComposerExternalRecipient => !!recipient)
      }}
    ]});
    const service = TestBed.inject(EmailComposerRecipientsService);
    await service.onFilteredMemberIdsChange(ids);
    expect(state.externalRecipients).toHaveLength(1);
    expect(state.externalRecipients[0].listId).toBe(list.id);
    await service.expandListToken(RecipientField.TO, state.externalRecipients[0]);
    await service.onFilteredMemberIdsChange(ids);
    expect(state.externalRecipients.map(recipient => recipient.email)).toEqual(members.map(member => member.email));
    expect(state.externalRecipients.every(recipient => !recipient.listId && !recipient.filterKey)).toBe(true);
    expect(state.externalRecipients.some(recipient => recipient.email === outside.email)).toBe(false);
    expect(state.narrowListId).toBe(list.id);
  });

  it("does not replace a whole-list send with every member who has an email", () => {
    const members = [...new Set([..."abcdefghijkl"])].map(id => ({id, firstName: "Alex", lastName: id, email: `${id}@example.com`} as Member));
    const list = {id: 42, name: "Group members"} as ListInfo;
    const listToken = composerListToken(list.id, list.name, members.length);
    const state = defaultEmailComposerState();
    state.brandingMode = BrandingMode.BRANDED;
    state.recipientMode = RecipientMode.ENTIRE_LIST;
    state.selectedListId = list.id;
    state.preFilterKey = null;
    state.externalRecipients = [listToken];
    TestBed.configureTestingModule({providers: [
      EmailComposerRecipientsService,
      {provide: EmailComposerSessionService, useValue: {state, inboxReplyContext: null, syncStateToUrl: vi.fn()}},
      {provide: MailListUpdaterService, useValue: {memberSubscribed: () => true}},
      {provide: EmailComposerRecipientSourcesService, useValue: fakeComposerSources({members, subscribed: () => true})},
      {provide: EmailComposerRecipientResolutionService, useValue: {
        committeeRoleSendOffered: () => false,
        committeeOnlyAudience: () => false,
        sendingAsCampaign: () => true,
        memberRecipientsForIds: (selectedIds: string[]) => members.filter(member => selectedIds.includes(member.id))
          .map(member => composerRecipientFromMember(member)).filter((recipient): recipient is ComposerExternalRecipient => !!recipient)
      }}
    ]});
    const service = TestBed.inject(EmailComposerRecipientsService);
    service.applyPreFilterAudienceToTo();
    expect(state.recipientMode).toBe(RecipientMode.ENTIRE_LIST);
    expect(state.externalRecipients).toEqual([listToken]);
  });

  it("does not recurse when a person is added to a whole-list send", () => {
    const members = [{id: "alex", firstName: "Alex", lastName: "Reed", email: "alex.reed@example.com", committee: true} as Member];
    const list = {id: 7, name: "Committee"} as ListInfo;
    const listToken = composerListToken(list.id, list.name, members.length);
    const guest = {email: "guest@example.com", name: "Guest", saveForReuse: false};
    const state = defaultEmailComposerState();
    state.brandingMode = BrandingMode.UNBRANDED;
    state.recipientMode = RecipientMode.ENTIRE_LIST;
    state.selectedListId = list.id;
    state.externalRecipients = [listToken];
    TestBed.configureTestingModule({providers: [
      EmailComposerRecipientsService,
      {provide: EmailComposerSessionService, useValue: {state, inboxReplyContext: null, syncStateToUrl: vi.fn()}},
      {provide: MailListUpdaterService, useValue: {memberSubscribed: () => true}},
      {provide: EmailComposerRecipientSourcesService, useValue: fakeComposerSources({members, lists: [list], subscribed: () => true, committeeOnlyListIds: [list.id], committeeReferenceData: {committeeMembers: () => []} as any})},
      {provide: EmailComposerRecipientResolutionService, useValue: {
        committeeRoleSendOffered: () => false,
        committeeOnlyAudience: () => false,
        sendingAsCampaign: () => false,
        headerEmailSet: () => new Set((state.externalRecipients ?? []).map(recipient => recipient.email.toLowerCase())),
        memberRecipientsForIds: () => members.map(member => composerRecipientFromMember(member))
          .filter((recipient): recipient is ComposerExternalRecipient => !!recipient)
      }}
    ]});
    const service = TestBed.inject(EmailComposerRecipientsService);
    expect(() => service.onUnbrandedToChange([listToken, guest])).not.toThrow();
    expect(state.recipientMode).toBe(RecipientMode.SELECTED_MEMBERS);
    expect(state.selectedListId).toBeNull();
    expect(state.narrowListId).toBe(list.id);
    expect(state.externalRecipients.some(recipient => recipient.email === guest.email)).toBe(true);
    expect(state.externalRecipients.every(recipient => !recipient.listId)).toBe(true);
  });

  it("keeps the mailing list as the member audience when a person is added to a branded list send", () => {
    const members = [{id: "alex", firstName: "Alex", lastName: "Reed", email: "alex.reed@example.com"} as Member];
    const list = {id: 7, name: "Committee"} as ListInfo;
    const listToken = composerListToken(list.id, list.name, members.length);
    const person = composerRecipientFromMember(members[0]) as ComposerExternalRecipient;
    const state = defaultEmailComposerState();
    state.brandingMode = BrandingMode.BRANDED;
    state.recipientMode = RecipientMode.ENTIRE_LIST;
    state.selectedListId = list.id;
    state.externalRecipients = [listToken];
    TestBed.configureTestingModule({providers: [
      EmailComposerRecipientsService,
      {provide: EmailComposerSessionService, useValue: {state, inboxReplyContext: null, syncStateToUrl: vi.fn()}},
      {provide: MailListUpdaterService, useValue: {memberSubscribed: () => true}},
      {provide: EmailComposerRecipientSourcesService, useValue: fakeComposerSources({members, lists: [list], subscribed: () => true, committeeReferenceData: {committeeMembers: () => []} as any})},
      {provide: EmailComposerRecipientResolutionService, useValue: {
        committeeRoleSendOffered: () => false,
        committeeOnlyAudience: () => false,
        sendingAsCampaign: () => true,
        headerEmailSet: () => new Set((state.externalRecipients ?? []).map(recipient => recipient.email.toLowerCase())),
        memberRecipientsForIds: () => [person]
      }}
    ]});
    const service = TestBed.inject(EmailComposerRecipientsService);
    service.onUnbrandedToChange([listToken, person]);
    expect(state.recipientMode).toBe(RecipientMode.SELECTED_MEMBERS);
    expect(state.selectedListId).toBeNull();
    expect(state.narrowListId).toBe(list.id);
    expect(state.externalRecipients.some(recipient => recipient.email === person.email)).toBe(true);
  });

  it("loads only members added within the welcome configuration's one-month window on a fresh composition", async () => {
    const now = DateTime.fromMillis(1800000000000);
    const members = Array.from({length: 137}, (_, index) => ({
      id: `member-${index}`, email: `member-${index}@example.com`, groupMember: true,
      createdDate: now.minus(index < 2 ? {days: 5} : {months: 3}).toMillis()
    } as Member));
    const state = defaultEmailComposerState();
    const config = {id: "welcome", defaultMemberSelection: MemberSelection.RECENTLY_ADDED, monthsInPast: 1} as NotificationConfig;
    state.notificationConfig = config;
    const session = {state, inboxReplyContext: null, syncStateToUrl: vi.fn()};
    const pool = fakeComposerSources({members, selection: recentlyAdded(members, now.minus({months: 1}).toMillis())});
    const resolver = resolverPrototype();
    Object.assign(resolver, {session, pool, dateUtils: {dateTimeNowNoTime: () => now}});
    vi.spyOn(resolver, "committeeRoleSendOffered").mockReturnValue(false);
    vi.spyOn(resolver, "committeeOnlyAudience").mockReturnValue(false);
    TestBed.configureTestingModule({providers: [
      EmailComposerRecipientsService,
      {provide: EmailComposerSessionService, useValue: session},
      {provide: MailListUpdaterService, useValue: {}},
      {provide: EmailComposerRecipientSourcesService, useValue: pool},
      {provide: EmailComposerRecipientResolutionService, useValue: resolver}
    ]});
    TestBed.inject(EmailComposerRecipientsService).applyRecipientDefaultsFrom(config);
    await flush();
    expect(state.recipientMode).toBe(RecipientMode.SELECTED_MEMBERS);
    expect(state.preFilterKey).toBe(MemberSelection.RECENTLY_ADDED);
    expect(state.selectedListId).toBeNull();
    expect(state.selectedMemberIds).toEqual(["member-0", "member-1"]);
    expect(state.externalRecipients.map(recipient => recipient.email)).toEqual(["member-0@example.com", "member-1@example.com"]);
  });

  it("keeps an existing mailing list when an email type is applied", () => {
    const members = [{id: "alex", firstName: "Alex", lastName: "Reed", email: "alex.reed@example.com"} as Member];
    const list = {id: 13, name: "Platform service alerts"} as ListInfo;
    const state = defaultEmailComposerState();
    state.brandingMode = BrandingMode.BRANDED;
    state.recipientMode = RecipientMode.ENTIRE_LIST;
    state.selectedListId = list.id;
    state.selectedMemberIds = [];
    state.externalRecipients = [];
    const config = {
      id: "newsletter",
      defaultMemberSelection: MemberSelection.MAILING_LIST,
      defaultListId: 1
    } as NotificationConfig;
    TestBed.configureTestingModule({providers: [
      EmailComposerRecipientsService,
      {provide: EmailComposerSessionService, useValue: {state, inboxReplyContext: null, syncStateToUrl: vi.fn()}},
      {provide: MailListUpdaterService, useValue: {memberSubscribed: () => true}},
      {provide: EmailComposerRecipientSourcesService, useValue: fakeComposerSources({members, lists: [list, {id: 1, name: "All Members"} as ListInfo], subscribed: () => true})},
      {provide: EmailComposerRecipientResolutionService, useValue: {
        committeeRoleSendOffered: () => false,
        committeeOnlyAudience: () => false,
        sendingAsCampaign: () => true,
        headerEmailSet: () => new Set(),
        memberRecipientsForIds: () => []
      }}
    ]});
    const service = TestBed.inject(EmailComposerRecipientsService);
    service.applyRecipientDefaultsFrom(config);
    expect(state.selectedListId).toBe(13);
    expect(state.recipientMode).toBe(RecipientMode.ENTIRE_LIST);
  });

  it("uses a mailing list only to pick members when the config has a pre-send action", () => {
    const members = [{id: "alex", firstName: "Alex", lastName: "Reed", email: "alex.reed@example.com"} as Member];
    const list = {id: 14, name: "Mobile Trial"} as ListInfo;
    const state = defaultEmailComposerState();
    state.brandingMode = BrandingMode.BRANDED;
    state.notificationConfig = {
      id: "login-details",
      defaultMemberSelection: MemberSelection.MAILING_LIST,
      defaultListId: 14,
      preSendActions: [WorkflowAction.GENERATE_GROUP_MEMBER_PASSWORD_RESET_ID]
    } as NotificationConfig;
    const config = state.notificationConfig;
    TestBed.configureTestingModule({providers: [
      EmailComposerRecipientsService,
      {provide: EmailComposerSessionService, useValue: {state, inboxReplyContext: null, syncStateToUrl: vi.fn()}},
      {provide: MailListUpdaterService, useValue: {memberSubscribed: () => true}},
      {provide: EmailComposerRecipientSourcesService, useValue: fakeComposerSources({members, lists: [list], subscribed: () => true})},
      {provide: EmailComposerRecipientResolutionService, useValue: {
        committeeRoleSendOffered: () => false,
        committeeOnlyAudience: () => false,
        sendingAsCampaign: () => false,
        headerEmailSet: () => new Set(),
        memberRecipientsForIds: () => []
      }}
    ]});
    const service = TestBed.inject(EmailComposerRecipientsService);
    service.applyRecipientDefaultsFrom(config, true);
    expect(state.recipientMode).toBe(RecipientMode.ENTIRE_LIST);
    expect(state.selectedListId).toBe(14);
    expect(state.sendingChannel).toBe(SendingChannel.TRANSACTIONAL_BATCH);
  });

  it("replaces a default mailing list when a filter email type is auto-applied", async () => {
    const now = DateTime.fromMillis(1800000000000);
    const members = Array.from({length: 137}, (_, index) => ({
      id: `member-${index}`, email: `member-${index}@example.com`, groupMember: true,
      createdDate: now.minus(index < 2 ? {days: 5} : {months: 3}).toMillis()
    } as Member));
    const list = {id: 13, name: "All Members"} as ListInfo;
    const state = defaultEmailComposerState();
    state.brandingMode = BrandingMode.BRANDED;
    state.recipientMode = RecipientMode.ENTIRE_LIST;
    state.selectedListId = list.id;
    state.externalRecipients = [{email: "list@example.com", listId: list.id} as any];
    const config = {id: "welcome", defaultMemberSelection: MemberSelection.RECENTLY_ADDED, monthsInPast: 1} as NotificationConfig;
    const session = {state, inboxReplyContext: null, syncStateToUrl: vi.fn()};
    const pool = fakeComposerSources({members, lists: [list], selection: recentlyAdded(members, now.minus({months: 1}).toMillis())});
    const resolver = resolverPrototype();
    Object.assign(resolver, {session, pool, dateUtils: {dateTimeNowNoTime: () => now}});
    vi.spyOn(resolver, "committeeRoleSendOffered").mockReturnValue(false);
    vi.spyOn(resolver, "committeeOnlyAudience").mockReturnValue(false);
    TestBed.configureTestingModule({providers: [
      EmailComposerRecipientsService,
      {provide: EmailComposerSessionService, useValue: session},
      {provide: MailListUpdaterService, useValue: {}},
      {provide: EmailComposerRecipientSourcesService, useValue: pool},
      {provide: EmailComposerRecipientResolutionService, useValue: resolver}
    ]});
    const service = TestBed.inject(EmailComposerRecipientsService);
    service.applyRecipientDefaultsFrom(config);
    await flush();
    expect(state.recipientMode).toBe(RecipientMode.SELECTED_MEMBERS);
    expect(state.preFilterKey).toBe(MemberSelection.RECENTLY_ADDED);
    expect(state.selectedListId).toBeNull();
    expect(state.selectedMemberIds).toEqual(["member-0", "member-1"]);
  });

  it("replaces an existing mailing list when the user chooses a type with a member filter", async () => {
    const now = DateTime.fromMillis(1800000000000);
    const members = Array.from({length: 137}, (_, index) => ({
      id: `member-${index}`, email: `member-${index}@example.com`, groupMember: true,
      createdDate: now.minus(index < 2 ? {days: 5} : {months: 3}).toMillis()
    } as Member));
    const list = {id: 13, name: "All Members"} as ListInfo;
    const state = defaultEmailComposerState();
    state.brandingMode = BrandingMode.BRANDED;
    state.recipientMode = RecipientMode.ENTIRE_LIST;
    state.selectedListId = list.id;
    state.externalRecipients = [{email: "list@example.com", listId: list.id} as any];
    const config = {id: "welcome", defaultMemberSelection: MemberSelection.RECENTLY_ADDED, monthsInPast: 1} as NotificationConfig;
    const session = {state, inboxReplyContext: null, syncStateToUrl: vi.fn()};
    const pool = fakeComposerSources({members, lists: [list], selection: recentlyAdded(members, now.minus({months: 1}).toMillis())});
    const resolver = resolverPrototype();
    Object.assign(resolver, {session, pool, dateUtils: {dateTimeNowNoTime: () => now}});
    vi.spyOn(resolver, "committeeRoleSendOffered").mockReturnValue(false);
    vi.spyOn(resolver, "committeeOnlyAudience").mockReturnValue(false);
    TestBed.configureTestingModule({providers: [
      EmailComposerRecipientsService,
      {provide: EmailComposerSessionService, useValue: session},
      {provide: MailListUpdaterService, useValue: {}},
      {provide: EmailComposerRecipientSourcesService, useValue: pool},
      {provide: EmailComposerRecipientResolutionService, useValue: resolver}
    ]});
    const service = TestBed.inject(EmailComposerRecipientsService);
    service.applyRecipientDefaultsFrom(config, true);
    await flush();
    expect(state.recipientMode).toBe(RecipientMode.SELECTED_MEMBERS);
    expect(state.preFilterKey).toBe(MemberSelection.RECENTLY_ADDED);
    expect(state.selectedListId).toBeNull();
    expect(state.selectedMemberIds).toEqual(["member-0", "member-1"]);
  });
});

describe("mixed unbranded committee recipients", () => {
  const member = {id: "alex", firstName: "Alex", lastName: "Reed", email: "alex.reed@example.com"} as Member;
  const roles = [{type: "chair", memberId: member.id, email: "chair@group.example.org.uk"}] as CommitteeMember[];

  function service() {
    const state = defaultEmailComposerState();
    state.brandingMode = BrandingMode.UNBRANDED;
    state.externalRecipients = [{email: "guest@example.com"}];
    const instance = Object.create(EmailComposerRecipientsService.prototype) as EmailComposerRecipientsService;
    Object.assign(instance, {
      recipientAddressModeTouched: false,
      session: {state, inboxReplyContext: null},
      pool: fakeComposerSources({members: [member], lists: [{id: 7, name: "Committee"} as ListInfo], subscribed: () => true, committeeOnlyListIds: [7], committeeReferenceData: {committeeMembers: () => roles} as any}),
      resolver: {
        committeeRoleSendOffered: () => composerCommitteeRoleSendOffered({
          recipients: [...state.externalRecipients, ...state.ccRecipients, ...state.bccRecipients],
          members: [member], roles, committeeOnlyAudience: false, recipientCount: 2, brandingMode: state.brandingMode
        }),
        committeeOnlyAudience: () => false,
        headerEmailSet: () => new Set()
      }
    });
    return {instance, state};
  }

  it.each([RecipientField.CC, RecipientField.BCC])("defaults to the role mailbox when the first committee member is added on %s", field => {
    const {instance, state} = service();
    const recipients = [composerRecipientFromMember(member) as ComposerExternalRecipient];
    if (field === RecipientField.CC) {
      instance.onUnbrandedCcChange(recipients);
    } else {
      instance.onUnbrandedBccChange(recipients);
    }
    expect(state.recipientAddressMode).toBe(RecipientAddressMode.COMMITTEE_ROLE);
    expect((field === RecipientField.CC ? state.ccRecipients : state.bccRecipients)[0].email).toBe(roles[0].email);
    expect(state.externalRecipients[0].email).toBe("guest@example.com");
  });

  it("preserves an explicit choice to use personal addresses", () => {
    const {instance, state} = service();
    instance.recipientAddressModeTouched = true;
    state.recipientAddressMode = RecipientAddressMode.PERSONAL;
    instance.onUnbrandedCcChange([composerRecipientFromMember(member) as ComposerExternalRecipient]);
    expect(state.recipientAddressMode).toBe(RecipientAddressMode.PERSONAL);
    expect(state.ccRecipients[0].email).toBe(member.email);
  });

  it.each([RecipientField.CC, RecipientField.BCC])("offers and defaults role addresses for a committee list on %s beside a guest on To", field => {
    const {instance, state} = service();
    const resolver = resolverPrototype();
    Object.assign(resolver, {
      session: {state},
      pool: instance.pool,
      mailListUpdaterService: {memberSubscribed: () => true},
      committeeOnlyAudience: () => false,
      totalRecipientCount: () => 2
    });
    instance["resolver"] = resolver;
    const recipients = [composerListToken(7, "Committee", 1)];
    if (field === RecipientField.CC) {
      instance.onUnbrandedCcChange(recipients);
    } else {
      instance.onUnbrandedBccChange(recipients);
    }
    expect(resolver.committeeRoleSendOffered()).toBe(true);
    expect(state.recipientAddressMode).toBe(RecipientAddressMode.COMMITTEE_ROLE);
    expect(resolver.expandedHeaderRecipients(recipients)[0].email).toBe(roles[0].email);
    expect(state.externalRecipients[0].email).toBe("guest@example.com");
    instance.onSendToCommitteeRoleAddressesChange({target: {checked: false}} as unknown as Event);
    expect(resolver.expandedHeaderRecipients(recipients)[0].email).toBe(member.email);
  });
});

describe("recipient selection without every member in the browser", () => {
  afterEach(() => TestBed.resetTestingModule());

  function recipientsService(members: Member[], configure: (state: ReturnType<typeof defaultEmailComposerState>) => void) {
    const state = defaultEmailComposerState();
    state.brandingMode = BrandingMode.BRANDED;
    state.recipientMode = RecipientMode.SELECTED_MEMBERS;
    configure(state);
    const list = {id: 3, name: "All members"} as ListInfo;
    TestBed.configureTestingModule({providers: [
      EmailComposerRecipientsService,
      {provide: EmailComposerSessionService, useValue: {state, inboxReplyContext: null, syncStateToUrl: vi.fn()}},
      {provide: MailListUpdaterService, useValue: {}},
      {provide: EmailComposerRecipientSourcesService, useValue: fakeComposerSources({members, lists: [list], loadedIds: [], subscribed: member => member.id !== "outside"})},
      {provide: EmailComposerRecipientResolutionService, useValue: {
        committeeRoleSendOffered: () => false, committeeOnlyAudience: () => false, sendingAsCampaign: () => false,
        headerEmailSet: () => new Set(), memberSelectionChipLabel: () => "Added in last month",
        memberRecipientsForIds: () => []
      }}
    ]});
    return {state, service: TestBed.inject(EmailComposerRecipientsService), list};
  }

  const many = Array.from({length: 1200}, (_, index) => ({id: `member-${index}`, email: `member-${index}@example.com`, groupMember: true} as Member));

  it("keeps every id from a large filter result and shows it as one filter chip, with no member records loaded", async () => {
    const ids = many.map(member => member.id);
    const {state, service} = recipientsService(many, composerState => {
      composerState.preFilterKey = MemberSelection.RECENTLY_ADDED;
    });
    await service.onFilteredMemberIdsChange(ids);
    expect(state.selectedMemberIds).toEqual(ids);
    expect(state.externalRecipients).toHaveLength(1);
    expect(state.externalRecipients[0].filterKey).toBe(MemberSelection.RECENTLY_ADDED);
  });

  it("adds everyone on a chosen list, even when none of their records were loaded beforehand", async () => {
    const people = [...many.slice(0, 3), {id: "outside", email: "outside@example.com", groupMember: true} as Member];
    const {state, service, list} = recipientsService(people, composerState => {
      composerState.selectedMemberIds = ["member-0", "outside"];
    });
    await service.setNarrowListId(list.id);
    expect(state.selectedMemberIds).toEqual(["member-0", "member-1", "member-2"]);
    expect(state.externalRecipients.map(recipient => recipient.memberId)).toEqual(["member-0", "member-1", "member-2"]);
  });
});
