import { uniq } from "es-toolkit/compat";
import { Member } from "../models/member.model";
import { ListInfo, MailMessagingConfig, WorkflowAction } from "../models/mail.model";
import { ComposerFilterSelection, ComposerFilterSelectionRequest, MemberSendRules, RecipientMode } from "../models/email-composer.model";
import { CommitteeReferenceData } from "../services/committee/committee-reference-data";
import { memberSubscribedToList } from "../functions/member-send-eligibility";
import { EmailComposerRecipientSourcesService } from "../services/email-composer/email-composer-recipient-sources.service";

export function fakeComposerSources(options: {
  members: Member[];
  lists?: ListInfo[];
  loadedIds?: string[];
  subscribed?: (member: Member, listId: number) => boolean;
  selection?: (request: ComposerFilterSelectionRequest) => string[];
  committeeOnlyListIds?: number[];
  committeeReferenceData?: CommitteeReferenceData | null;
  mailMessagingConfig?: MailMessagingConfig | null;
  state?: {recipientMode: RecipientMode; notificationConfig?: {postSendActions?: WorkflowAction[]} | null};
}): EmailComposerRecipientSourcesService {
  const members = options.members ?? [];
  const lists = options.lists ?? [];
  const subscribed = options.subscribed ?? ((member: Member, listId: number) => memberSubscribedToList(member, listId));
  const loaded = new Set(options.loadedIds ?? members.map(member => member.id));
  const loadedMembers = () => members.filter(member => loaded.has(member.id));
  const emailable = (member: Member) => !!(member.email || "").trim();
  const listIds = (listId: number) => members.filter(member => emailable(member) && subscribed(member, listId)).map(member => member.id);
  const everyoneIds = () => members.filter(member => member.groupMember !== false && emailable(member)).map(member => member.id);
  const load = (ids: string[]) => ids.forEach(id => loaded.add(id));
  const configActions = () => options.state?.notificationConfig?.postSendActions ?? [];
  const fake = {
    committeeReferenceData: options.committeeReferenceData ?? null,
    mailMessagingConfig: options.mailMessagingConfig ?? null,
    memberBulkLoadDateMap: null,
    membersRevision: 0,
    filterCandidateCount: null as number | null,
    members: () => loadedMembers(),
    memberById: (id: string | null | undefined) => loadedMembers().find(member => member.id === id) ?? null,
    hasEmail: (email: string | null | undefined) => {
      const key = (email || "").trim().toLowerCase();
      const owner = members.find(member => (member.email || "").toLowerCase() === key);
      return !key || !owner || loaded.has(owner.id);
    },
    membersForIds: (ids: string[]) => uniq(ids ?? []).map(id => loadedMembers().find(member => member.id === id)).filter((member): member is Member => !!member),
    hasAllIds: (ids: string[]) => (ids ?? []).every(id => loaded.has(id) || !members.some(member => member.id === id)),
    ensureMembers: async (ids: string[], emails: string[] = []) => {
      load(ids ?? []);
      load(members.filter(member => (emails ?? []).some(email => (email || "").toLowerCase() === (member.email || "").toLowerCase())).map(member => member.id));
    },
    loadCommitteeMembers: async () => load(members.filter(member => member.committee).map(member => member.id)),
    loadCommitteeRoleHolders: async () => undefined,
    settled: async () => undefined,
    availableLists: () => lists,
    audienceFactsLoaded: () => true,
    loadListFacts: async () => undefined,
    nonEmptyLists: () => lists.filter(list => listIds(list.id).length > 0),
    unbrandedCommitteeLists: () => lists.filter(list => (options.committeeOnlyListIds ?? []).includes(list.id)),
    committeeOnlyLists: () => lists.filter(list => (options.committeeOnlyListIds ?? []).includes(list.id)),
    listSubscriberCount: (list: ListInfo) => `${listIds(list.id).length} subscribers`,
    listNameAndCount: (list: ListInfo) => `${list.name} ${listIds(list.id).length} subscribers`,
    subscribedMemberCount: (list: ListInfo) => listIds(list.id).length,
    listMemberIdsForList: async (listId: number) => listIds(listId),
    everyoneMemberIds: async () => everyoneIds(),
    knownListMemberIds: (listId: number) => listIds(listId),
    knownEveryoneMemberIds: () => everyoneIds(),
    loadRecordsFor: async (ids: string[]) => {
      load(ids);
      return fake.membersForIds(ids);
    },
    listMembers: async (listId: number) => fake.loadRecordsFor(listIds(listId)),
    everyoneMembers: async () => fake.loadRecordsFor(everyoneIds()),
    filterSelection: async (request: ComposerFilterSelectionRequest): Promise<ComposerFilterSelection> => {
      const memberIds = options.selection ? options.selection(request) : everyoneIds();
      fake.filterCandidateCount = members.length;
      return {candidateCount: members.length, memberIds, keptMemberIds: request.keepMemberIds ?? [], priorSendExclusions: []};
    },
    refreshAfterMemberChanges: async () => undefined,
    unsubscribeReferenceListId: () => null,
    configHasPostSendAction: (action: WorkflowAction) => configActions().includes(action),
    bulkDeletionPending: () => configActions().includes(WorkflowAction.BULK_DELETE_GROUP_MEMBER),
    memberDisablePending: () => configActions().includes(WorkflowAction.DISABLE_GROUP_MEMBER),
    workflowRemovesRecipients: () => configActions().includes(WorkflowAction.BULK_DELETE_GROUP_MEMBER) || configActions().includes(WorkflowAction.DISABLE_GROUP_MEMBER),
    requiresConsent: () => options.state?.recipientMode === RecipientMode.SELECTED_MEMBERS && options.mailMessagingConfig?.mailConfig?.respectHeadOfficeConsent !== false,
    respectsBlocks: () => options.mailMessagingConfig?.mailConfig?.respectEmailBlocks === true,
    bulkLoadFilterInUse: () => false,
    loadMemberBulkLoadDateMapIfNeeded: async () => undefined,
    reloadMemberBulkLoadDateMap: async () => undefined,
    sendRules: (): MemberSendRules => ({respectEmailBlocks: fake.respectsBlocks(), respectHeadOfficeConsent: fake.requiresConsent(), referenceListId: null})
  };
  return fake as unknown as EmailComposerRecipientSourcesService;
}
