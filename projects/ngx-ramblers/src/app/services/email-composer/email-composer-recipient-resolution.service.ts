import {inject} from "@angular/core";
import {isNumber, uniq} from "es-toolkit/compat";
import {Member} from "../../models/member.model";
import {
  BrandingMode,
  BatchRecipientSelection,
  ComposerAudienceDefinition,
  ComposerAudienceScope,
  COMPOSER_MEMBER_LOOKUP_LIMIT,
  ComposerExternalRecipient,
  ComposerHeaderExpansion,
  EmailComposerRecipientEntry,
  RECIPIENT_PRE_FILTERS,
  RecipientMode
} from "../../models/email-composer.model";
import {
  COMPOSER_EVERYONE_FILTER_EMAIL,
  composerCampaignListId,
  composerCommitteeRoleSendOffered,
  composerNeedsPerMemberSend,
  composerRecipientFromMember,
  composerRecipientIsExpandableSet,
  composerRecipientsForAddressMode,
  composerSelectedMembersAreCommitteeAudience,
  composerSendsAsCampaign,
  composerWholeMailingListSelected
} from "../../functions/email-composer";
import {MemberSelection} from "../../models/mail.model";
import {StringUtilsService} from "../string-utils.service";
import {DateUtilsService} from "../date-utils.service";
import {CommitteeMember, roleEmailAddresses} from "../../models/committee.model";
import {DateRangeUnit, NO_DATE_FILTER} from "../../models/search.model";
import {Injectable} from "@angular/core";
import {EmailComposerSessionService} from "./email-composer-session.service";
import {EmailComposerRecipientSourcesService} from "./email-composer-recipient-sources.service";
import {RecipientAddressMode} from "../../models/email-composer.model";

@Injectable()
export class EmailComposerRecipientResolutionService {
  private session = inject(EmailComposerSessionService);
  pool = inject(EmailComposerRecipientSourcesService);
  private memberIndexes = new WeakMap<Member[], {byId: Map<string, Member>; byEmail: Map<string, Member>}>();
  protected stringUtils = inject(StringUtilsService);
  protected dateUtils = inject(DateUtilsService);

  campaignListId(): number | null {
    return composerCampaignListId({
      recipientMode: this.session.state.recipientMode,
      selectedListId: this.session.state.selectedListId,
      narrowListId: this.session.state.narrowListId
    });
  }

  wholeMailingListSelected(): boolean {
    const listId = this.campaignListId();
    return composerWholeMailingListSelected({
      listId,
      preFilterKey: this.session.state.preFilterKey,
      selectedMemberIds: this.session.state.selectedMemberIds ?? [],
      subscribedMemberIds: listId === null ? [] : this.pool.knownListMemberIds(listId) ?? [],
      toRecipients: this.session.state.externalRecipients ?? []
    });
  }

  committeeOnlyAudience(): boolean {
    const listId = this.campaignListId();
    const expansion = this.expandHeaders(this.headerRecipients());
    const roles = this.pool.committeeReferenceData?.committeeMembers() ?? [];
    if (expansion.unresolvedMemberIds.length > 0) {
      return false;
    } else if (listId !== null && (this.session.state.recipientMode === RecipientMode.ENTIRE_LIST || this.wholeMailingListSelected())) {
      return this.pool.committeeOnlyLists().some(list => list.id === listId)
        && expansion.recipients.every(header => !!this.memberMatchingHeader(header, roles)?.committee);
    } else {
      const headers = expansion.recipients;
      const members = this.recipientsForAddressMode();
      const memberChips = headers.filter(header => header.memberId && !header.committeeRoleType);
      const people = memberChips.length > 0
        ? members.filter(member => memberChips.some(chip => chip.memberId === member.id))
        : members;
      const roleChipCount = headers.filter(header => !!header.committeeRoleType).length;
      const headerCount = headers.length;
      const recipientCount = headerCount > 0 ? headerCount : people.length + this.unresolvedSelectedMemberIds().length;
      return composerSelectedMembersAreCommitteeAudience(people, recipientCount, roleChipCount);
    }
  }

  headerRecipients(): ComposerExternalRecipient[] {
    return [
      ...(this.session.state.externalRecipients ?? []),
      ...(this.session.state.ccRecipients ?? []),
      ...(this.session.state.bccRecipients ?? [])
    ];
  }

  recipientListIds(): number[] {
    const listIds = this.headerRecipients().map(recipient => recipient.listId).filter(isNumber);
    const selectedListId = this.session.state.recipientMode === RecipientMode.ENTIRE_LIST
      ? this.session.state.selectedListId
      : null;
    return [...new Set([...listIds, ...(isNumber(selectedListId) ? [selectedListId] : [])])];
  }

  unbrandedListsAllowed(): boolean {
    return this.session.state.brandingMode !== BrandingMode.UNBRANDED
      || this.recipientListIds().every(id => this.pool.unbrandedCommitteeLists().some(list => list.id === id));
  }

  selectedListTokenPresent(): boolean {
    const listId = this.session.state.selectedListId;
    return listId !== null && this.headerRecipients().some(recipient => recipient.listId === listId);
  }

  unbrandedListExpanded(): boolean {
    return this.session.state.brandingMode === BrandingMode.UNBRANDED
      && this.session.state.recipientMode === RecipientMode.ENTIRE_LIST
      && this.session.state.selectedListId !== null
      && !this.selectedListTokenPresent();
  }

  unbrandedSelectedListId(): number | null {
    const to = this.session.state.externalRecipients ?? [];
    const listIds = to.map(recipient => recipient.listId).filter((listId): listId is number => isNumber(listId));
    if (to.length > 0 && listIds.length === to.length && new Set(listIds).size === 1) {
      return listIds[0];
    } else if (this.session.state.recipientMode === RecipientMode.ENTIRE_LIST) {
      return this.session.state.selectedListId;
    } else {
      return null;
    }
  }

  cachedCommitteeAddresses: ComposerExternalRecipient[] = [];

  committeeRecipientAddresses(): ComposerExternalRecipient[] {
    return this.cachedCommitteeAddresses;
  }

  headerEmailSet(): Set<string> {
    return new Set(this.expandedHeaderRecipients(this.headerRecipients()).map(recipient => recipient.email.toLowerCase()));
  }

  memberSelectionChipLabel(key: MemberSelection): string {
    const amount = isNumber(this.session.state.notificationConfig?.monthsInPast)
      ? this.session.state.notificationConfig.monthsInPast
      : 1;
    const timeUnit = this.session.state.notificationConfig?.timeUnit ?? DateRangeUnit.MONTHS;
    const noSuffix = timeUnit === NO_DATE_FILTER || amount === 0;
    const unit = timeUnit.replace(/s$/, "");
    const window = this.stringUtils.pluraliseWithCount(amount, unit);
    if (key === MemberSelection.RECENTLY_ADDED) {
      return noSuffix ? "Added recently" : `Added in last ${window}`;
    } else if (key === MemberSelection.EXPIRED_MEMBERS) {
      return noSuffix ? "Expired" : `Expired (${window} past expiry)`;
    } else if (key === MemberSelection.MISSING_FROM_BULK_LOAD_MEMBERS) {
      return noSuffix ? "Missing from bulk load" : `Missing from bulk load (${window} or more)`;
    } else {
      return RECIPIENT_PRE_FILTERS.find(filter => filter.key === key)?.label ?? key;
    }
  }

  memberRecipientsForIds(ids: string[]): ComposerExternalRecipient[] {
    return this.pool.membersForIds(uniq(ids ?? []))
      .map(member => composerRecipientFromMember(member))
      .filter((recipient): recipient is ComposerExternalRecipient => !!recipient);
  }

  committeeRoleSendOffered(): boolean {
    return composerCommitteeRoleSendOffered({
      recipients: this.expandedHeaderRecipients(this.headerRecipients()),
      members: this.pool.members(),
      roles: this.pool.committeeReferenceData?.committeeMembers() ?? [],
      committeeOnlyAudience: this.committeeOnlyAudience(),
      recipientCount: this.totalRecipientCount(),
      brandingMode: this.session.state.brandingMode
    });
  }

  membersInHeader(list: ComposerExternalRecipient[]): Member[] {
    const expanded = this.expandedHeaderRecipients(list);
    const emails = new Set(expanded.map(recipient => recipient.email.toLowerCase()));
    const ids = new Set(expanded.map(recipient => recipient.memberId).filter((id): id is string => !!id));
    return this.pool.members().filter(member =>
      (member.id && ids.has(member.id)) || (!!member.email && emails.has(member.email.toLowerCase()))
    );
  }

  useCommitteeRoleAddresses(): boolean {
    return this.committeeRoleSendOffered() && this.session.state.recipientAddressMode === RecipientAddressMode.COMMITTEE_ROLE;
  }

  recipientsForAddressMode(): Member[] {
    if (this.session.state.recipientMode === RecipientMode.ENTIRE_LIST) {
      const listId = this.session.state.selectedListId;
      return listId === null ? [] : this.listMembersKnown(listId);
    } else if (this.session.state.brandingMode === BrandingMode.UNBRANDED) {
      return this.membersInHeader(this.headerRecipients());
    } else {
      return this.selectedMembersKnown();
    }
  }

  totalRecipientCount(): number {
    if (this.session.state.recipientMode === RecipientMode.ENTIRE_LIST && !this.unbrandedListExpanded()) {
      const list = this.pool.availableLists().find(item => item.id === this.session.state.selectedListId);
      return list ? this.pool.subscribedMemberCount(list) : 0;
    } else {
      return this.sendEntryCount();
    }
  }

  sendEntryCount(): number {
    return this.uniqueSendEntries().length + this.unresolvedSendMemberIds().length;
  }

  uniqueSendEntries(): EmailComposerRecipientEntry[] {
    const campaignListId = this.campaignListId();
    if (this.campaignEntriesApply(campaignListId)) {
      return this.listMembersKnown(campaignListId).map(member => ({name: this.previewMemberName(member), member}));
    } else {
      const fromTo = this.uniqueEntriesFrom(this.session.state.externalRecipients ?? []);
      return fromTo.length > 0
        ? fromTo
        : this.selectedMembersKnown().map(member => ({name: this.previewMemberName(member), member}));
    }
  }

  private previewInputs: unknown[] = [];
  private previewEntriesCache: EmailComposerRecipientEntry[] = [];

  previewSendEntries(): EmailComposerRecipientEntry[] {
    const listId = this.campaignListId();
    const listIds = this.headerRecipients().map(recipient => recipient.listId).filter(isNumber);
    const inputs = [this.pool.members(), this.session.state.selectedMemberIds, this.session.state.externalRecipients,
      this.session.state.ccRecipients, this.session.state.bccRecipients, this.session.state.recipientMode,
      this.session.state.brandingMode, this.session.state.recipientAddressMode, this.session.state.preFilterKey,
      this.session.state.notificationConfig, listId, listId === null ? null : this.pool.knownListMemberIds(listId),
      ...listIds.map(id => this.pool.knownListMemberIds(id))];
    if (inputs.length !== this.previewInputs.length || inputs.some((input, index) => input !== this.previewInputs[index])) {
      this.previewInputs = inputs;
      this.previewEntriesCache = [...this.uniqueSendEntries(), ...this.unresolvedSendMemberIds().map(id => ({name: "", member: {id} as Member}))];
    }
    return this.previewEntriesCache;
  }

  unresolvedSendMemberIds(): string[] {
    const campaignListId = this.campaignListId();
    if (this.campaignEntriesApply(campaignListId)) {
      return this.idsWithoutRecords(this.pool.knownListMemberIds(campaignListId) ?? []);
    } else {
      const toExpansion = this.expandHeaders(this.session.state.externalRecipients ?? []);
      return toExpansion.recipients.length > 0 || toExpansion.unresolvedMemberIds.length > 0
        ? toExpansion.unresolvedMemberIds
        : this.unresolvedSelectedMemberIds();
    }
  }

  private campaignEntriesApply(campaignListId: number | null): boolean {
    const namedPeopleOnTo = (this.session.state.externalRecipients ?? [])
      .some(recipient => !composerRecipientIsExpandableSet(recipient));
    return this.sendingAsCampaign() && campaignListId !== null && !namedPeopleOnTo;
  }

  private listMembersKnown(listId: number): Member[] {
    const ids = this.pool.knownListMemberIds(listId) ?? [];
    return this.pool.membersForIds(ids);
  }

  private selectedMembersKnown(): Member[] {
    const ids = this.session.state.selectedMemberIds ?? [];
    this.requestRecords(ids);
    return this.pool.membersForIds(ids);
  }

  private unresolvedSelectedMemberIds(): string[] {
    return this.idsWithoutRecords(this.session.state.selectedMemberIds ?? []);
  }

  private idsWithoutRecords(ids: string[]): string[] {
    return uniq(ids.filter(id => !!id && !this.pool.memberById(id)));
  }

  private requestRecords(ids: string[]): void {
    if (ids.length > 0 && ids.length <= COMPOSER_MEMBER_LOOKUP_LIMIT && !this.pool.hasAllIds(ids)) {
      void this.pool.ensureMembers(ids);
    }
  }

  uniqueEntriesFrom(list: ComposerExternalRecipient[]): EmailComposerRecipientEntry[] {
    const headers = this.expandedHeaderRecipients(list);
    const roles = this.pool.committeeReferenceData?.committeeMembers() ?? [];
    const seenEmails = new Set<string>();
    return headers
      .filter(external => {
        const email = (external.email || "").toLowerCase();
        const firstSeen = !email || !seenEmails.has(email);
        seenEmails.add(email);
        return firstSeen;
      })
      .map(external => {
        const member = this.memberMatchingHeader(external, roles);
        return {
          name: external.name?.trim() || (member ? this.previewMemberName(member) : external.email),
          member: member ?? undefined,
          external
        };
      });
  }

  memberMatchingHeader(header: ComposerExternalRecipient, roles: CommitteeMember[]): Member | null {
    if (header.memberId) {
      return this.memberIndex().byId.get(header.memberId) ?? null;
    } else {
      const email = (header.email || "").toLowerCase();
      const byPersonal = this.memberIndex().byEmail.get(email) ?? null;
      if (byPersonal) {
        return byPersonal;
      } else {
        const role = roles.find(candidate => roleEmailAddresses(candidate).some(address => address.toLowerCase() === email));
        return role?.memberId ? this.memberIndex().byId.get(role.memberId) ?? null : null;
      }
    }
  }

  private memberIndex(): {byId: Map<string, Member>; byEmail: Map<string, Member>} {
    const members = this.pool.members();
    if (!this.memberIndexes.has(members)) {
      this.memberIndexes.set(members, {
        byId: new Map(members.filter(member => member.id).map(member => [member.id, member])),
        byEmail: new Map([...members].reverse().filter(member => member.email).map(member => [member.email.toLowerCase(), member]))
      });
    }
    return this.memberIndexes.get(members);
  }

  previewMemberName(member: Member): string {
    const fullName = `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim();
    return fullName || member.displayName?.trim() || member.email || "";
  }

  sendingAsCampaign(): boolean {
    if (this.session.state.brandingMode === BrandingMode.UNBRANDED) {
      return false;
    } else {
      return composerSendsAsCampaign(
        this.session.state.recipientMode,
        this.session.state.brandingMode,
        this.committeeOnlyAudience(),
        this.wholeMailingListSelected(),
        composerNeedsPerMemberSend(this.session.state.notificationConfig?.preSendActions)
      );
    }
  }

  setMemberIds(recipient: ComposerExternalRecipient): string[] | null {
    if (recipient.filterKey || recipient.email === COMPOSER_EVERYONE_FILTER_EMAIL) {
      const selected = (this.session.state.selectedMemberIds ?? []).filter(Boolean);
      return selected.length > 0 ? selected : this.pool.knownEveryoneMemberIds();
    } else if (isNumber(recipient.listId)) {
      return this.pool.knownListMemberIds(recipient.listId);
    } else {
      return null;
    }
  }

  headerSetMemberIds(list: ComposerExternalRecipient[]): string[] {
    return uniq((list ?? []).filter(composerRecipientIsExpandableSet).flatMap(recipient => this.setMemberIds(recipient) ?? []));
  }

  expandHeaders(list: ComposerExternalRecipient[]): ComposerHeaderExpansion {
    const recipients = list ?? [];
    const setIds = recipients.filter(composerRecipientIsExpandableSet).map(recipient => this.setMemberIds(recipient) ?? []);
    const pendingSets = recipients.filter(composerRecipientIsExpandableSet).some(recipient => this.setMemberIds(recipient) === null);
    this.requestHeaderPeople(recipients.filter(recipient => !composerRecipientIsExpandableSet(recipient)));
    const expanded = recipients.flatMap(recipient => composerRecipientIsExpandableSet(recipient)
      ? this.setRecipients(this.setMemberIds(recipient) ?? [])
      : [recipient]);
    return {
      recipients: composerRecipientsForAddressMode(expanded, this.pool.members(),
        this.pool.committeeReferenceData?.committeeMembers() ?? [], this.session.state.recipientAddressMode),
      unresolvedMemberIds: this.idsWithoutRecords(setIds.flat()),
      pendingSets
    };
  }

  private requestHeaderPeople(people: ComposerExternalRecipient[]): void {
    const ids = people.map(recipient => recipient.memberId).filter((id): id is string => !!id);
    const emails = people.filter(recipient => !recipient.memberId && !recipient.committeeRoleType).map(recipient => recipient.email);
    const missingIds = ids.filter(id => !this.pool.hasAllIds([id]));
    const missingEmails = emails.filter(email => !this.pool.hasEmail(email));
    if (missingIds.length > 0 || missingEmails.length > 0) {
      void this.pool.ensureMembers(missingIds, missingEmails);
    }
  }

  private setRecipients(ids: string[]): ComposerExternalRecipient[] {
    this.requestRecords(ids);
    return this.memberRecipientsForIds(ids).map(person => ({...person, fromBulkAudience: true}));
  }

  expandedHeaderRecipients(list: ComposerExternalRecipient[]): ComposerExternalRecipient[] {
    return this.expandHeaders(list).recipients;
  }

  batchRecipientSelection(): BatchRecipientSelection {
    const definitionFor = (recipient: ComposerExternalRecipient): ComposerAudienceDefinition => isNumber(recipient.listId)
      ? {scope: ComposerAudienceScope.MAILING_LIST, recipientMode: this.session.state.recipientMode, listId: recipient.listId}
      : {scope: ComposerAudienceScope.NAMED_MEMBERS, recipientMode: this.session.state.recipientMode, memberIds: this.session.state.selectedMemberIds ?? []};
    const to = this.session.state.externalRecipients ?? [];
    const cc = this.session.state.ccRecipients ?? [];
    const bcc = this.session.state.bccRecipients ?? [];
    const hasHeaders = to.length > 0 || cc.length > 0 || bcc.length > 0;
    const fallback = this.session.state.recipientMode === RecipientMode.ENTIRE_LIST && this.session.state.selectedListId !== null
      ? [{scope: ComposerAudienceScope.MAILING_LIST, recipientMode: this.session.state.recipientMode, listId: this.session.state.selectedListId}]
      : [{scope: ComposerAudienceScope.NAMED_MEMBERS, recipientMode: this.session.state.recipientMode, memberIds: this.session.state.selectedMemberIds ?? []}];
    return {
      audiences: {
        to: hasHeaders ? to.filter(composerRecipientIsExpandableSet).map(definitionFor) : fallback,
        cc: cc.filter(composerRecipientIsExpandableSet).map(definitionFor),
        bcc: bcc.filter(composerRecipientIsExpandableSet).map(definitionFor)
      },
      memberIds: [],
      externalRecipients: to.filter(recipient => !composerRecipientIsExpandableSet(recipient)),
      ccRecipients: cc.filter(recipient => !composerRecipientIsExpandableSet(recipient)),
      bccRecipients: bcc.filter(recipient => !composerRecipientIsExpandableSet(recipient))
    };
  }

}
