import {inject, Injectable} from "@angular/core";
import {isNumber} from "es-toolkit/compat";
import {NgxLoggerLevel} from "ngx-logger";
import {Member, MemberBulkLoadDateMap} from "../../models/member.model";
import {
    COMPOSER_MEMBER_LOOKUP_LIMIT,
    ComposerAudienceDefinition,
    ComposerAudienceScope,
    ComposerFilterSelection,
    ComposerFilterSelectionRequest,
    ComposerListCount,
    MemberSendRules,
    RecipientMode
} from "../../models/email-composer.model";
import {BULK_LOAD_MEMBER_SELECTIONS, COMMITTEE_ROLE_CAMPAIGN_EXCLUSION_LIST_NAME, ListInfo, MailMessagingConfig, WorkflowAction} from "../../models/mail.model";
import {MemberBulkLoadAuditService} from "../member/member-bulk-load-audit.service";
import {CommitteeReferenceData} from "../committee/committee-reference-data";
import {StringUtilsService} from "../string-utils.service";
import {EM_DASH} from "../../models/content-text.model";
import {EmailComposerSessionService} from "./email-composer-session.service";
import {EmailComposerAudienceService} from "./email-composer-audience.service";
import {EmailComposerMemberDirectoryService} from "./email-composer-member-directory.service";
import {LoggerFactory} from "../logger-factory.service";

const EVERYONE_KEY = "everyone";

@Injectable()
export class EmailComposerRecipientSourcesService {
    private logger = inject(LoggerFactory).createLogger("EmailComposerRecipientSourcesService", NgxLoggerLevel.ERROR);
    private session = inject(EmailComposerSessionService);
    private audienceService = inject(EmailComposerAudienceService);
    private directory = inject(EmailComposerMemberDirectoryService);
    private stringUtils = inject(StringUtilsService);
    private memberBulkLoadAuditService = inject(MemberBulkLoadAuditService);
    private memberBulkLoadDateMapLoad: Promise<void> | null = null;
    committeeReferenceData: CommitteeReferenceData | null = null;
    mailMessagingConfig: MailMessagingConfig | null = null;
    memberBulkLoadDateMap: MemberBulkLoadDateMap | null = null;
    membersRevision = 0;
    filterCandidateCount: number | null = null;
    private listFacts: ComposerListCount[] = [];
    private listFactsLoaded = false;
    private listFactsToken = 0;
    private failedSetLoads = new Set<string>();
    private setIds = new Map<string, string[]>();
    private setIdLoads = new Map<string, Promise<string[]>>();
    private pending: Promise<unknown>[] = [];

    members(): Member[] {
        return this.directory.members();
    }
    memberById(id: string | null | undefined): Member | null {
        return this.directory.memberById(id);
    }
    membersForIds(ids: string[]): Member[] {
        return this.directory.membersForIds(ids);
    }
    hasAllIds(ids: string[]): boolean {
        return this.directory.hasAllIds(ids);
    }
    hasEmail(email: string | null | undefined): boolean {
        return this.directory.hasEmail(email);
    }
    ensureMembers(ids: string[], emails: string[] = []): Promise<void> {
        return this.directory.ensureMembers(ids, emails);
    }
    async loadCommitteeMembers(): Promise<void> {
        await Promise.all([this.directory.loadCommitteeMembers(), this.loadCommitteeRoleHolders()]);
    }
    loadCommitteeRoleHolders(): Promise<void> {
        const roleMemberIds = (this.committeeReferenceData?.committeeMembers() ?? [])
            .map(role => role.memberId)
            .filter((id): id is string => !!id);
        return this.directory.ensureMembers(roleMemberIds);
    }
    async settled(): Promise<void> {
        const pending = [...this.pending];
        await Promise.all([...pending, this.directory.settled()]);
        if (this.pending.length > 0 && this.pending.some(item => !pending.includes(item))) {
            await this.settled();
        }
    }
    private track<T>(work: Promise<T>): Promise<T> {
        this.pending = [...this.pending, work];
        return work.finally(() => {
            this.pending = this.pending.filter(item => item !== work);
        });
    }
    availableLists(): ListInfo[] {
        return this.mailMessagingConfig?.brevo?.lists?.lists ?? [];
    }
    audienceFactsLoaded(): boolean {
        return this.listFactsLoaded;
    }
    loadListFacts(): Promise<void> {
        const token = ++this.listFactsToken;
        const listIds = this.availableLists().map(list => list.id);
        return this.track(this.audienceService.listCounts(listIds)
            .then(facts => {
                if (token === this.listFactsToken) {
                    this.listFacts = facts;
                    this.listFactsLoaded = this.listFactsLoaded || listIds.length > 0 || !!this.mailMessagingConfig;
                }
            })
            .catch(error => this.logger.error("list counts failed:", error)));
    }
    private listFact(listId: number): ComposerListCount | null {
        return this.listFacts.find(fact => fact.listId === listId) ?? null;
    }
    nonEmptyLists(): ListInfo[] {
        return this.availableLists()
            .filter(list => list.name !== COMMITTEE_ROLE_CAMPAIGN_EXCLUSION_LIST_NAME)
            .filter(list => (this.listFact(list.id)?.subscriberCount ?? 0) > 0);
    }
    unbrandedCommitteeLists(): ListInfo[] {
        return this.nonEmptyLists().filter(list => !!this.listFact(list.id)?.committeeOnly);
    }
    committeeOnlyLists(): ListInfo[] {
        return this.unbrandedCommitteeLists();
    }
    listSubscriberCount(list: ListInfo): string {
        return this.stringUtils.pluraliseWithCount(this.subscribedMemberCount(list), "subscriber");
    }
    listNameAndCount(list: ListInfo): string {
        return `${list.name}${EM_DASH}${this.listSubscriberCount(list)}`;
    }
    subscribedMemberCount(list: ListInfo): number {
        return this.listFact(list.id)?.subscriberCount ?? 0;
    }
    private loadSetIds(key: string, definition: ComposerAudienceDefinition): Promise<string[]> {
        const cached = this.setIds.get(key);
        const loading = this.setIdLoads.get(key);
        if (cached) {
            return Promise.resolve(cached);
        } else if (loading) {
            return loading;
        } else {
            this.failedSetLoads.delete(key);
            const revision = this.membersRevision;
            const load = this.track(this.audienceService.memberIds(definition).then(ids => {
                if (revision === this.membersRevision) {
                    this.setIds.set(key, ids);
                    if (ids.length <= COMPOSER_MEMBER_LOOKUP_LIMIT) {
                        void this.directory.ensureMembers(ids);
                    }
                }
                return ids;
            }).catch(error => {
                this.failedSetLoads.add(key);
                throw error;
            }).finally(() => {
                if (this.setIdLoads.get(key) === load) {
                    this.setIdLoads.delete(key);
                }
            }));
            this.setIdLoads.set(key, load);
            return load;
        }
    }
    private listDefinition(listId: number): ComposerAudienceDefinition {
        return {scope: ComposerAudienceScope.MAILING_LIST, recipientMode: RecipientMode.ENTIRE_LIST, listId};
    }
    listMemberIdsForList(listId: number): Promise<string[]> {
        return this.loadSetIds(`list:${listId}`, this.listDefinition(listId));
    }
    everyoneMemberIds(): Promise<string[]> {
        return this.loadSetIds(EVERYONE_KEY, {scope: ComposerAudienceScope.EVERYONE, recipientMode: RecipientMode.SELECTED_MEMBERS});
    }
    knownListMemberIds(listId: number): string[] | null {
        const ids = this.setIds.get(`list:${listId}`) ?? null;
        if (!ids && !this.failedSetLoads.has(`list:${listId}`)) {
            void this.listMemberIdsForList(listId).catch(error => this.logger.error("mailing list audience lookup failed:", error));
        }
        return ids;
    }
    knownEveryoneMemberIds(): string[] | null {
        const ids = this.setIds.get(EVERYONE_KEY) ?? null;
        if (!ids && !this.failedSetLoads.has(EVERYONE_KEY)) {
            void this.everyoneMemberIds().catch(error => this.logger.error("member audience lookup failed:", error));
        }
        return ids;
    }
    async loadRecordsFor(ids: string[]): Promise<Member[]> {
        await this.directory.ensureMembers(ids);
        return this.directory.membersForIds(ids);
    }
    async listMembers(listId: number): Promise<Member[]> {
        return this.loadRecordsFor(await this.listMemberIdsForList(listId));
    }
    async everyoneMembers(): Promise<Member[]> {
        return this.loadRecordsFor(await this.everyoneMemberIds());
    }
    async filterSelection(request: ComposerFilterSelectionRequest): Promise<ComposerFilterSelection> {
        const selection = await this.track(this.audienceService.filterSelection(request));
        this.filterCandidateCount = selection.candidateCount;
        return selection;
    }
    async refreshAfterMemberChanges(): Promise<void> {
        this.membersRevision++;
        this.setIds.clear();
        this.setIdLoads.clear();
        this.failedSetLoads.clear();
        this.directory.forget();
        await Promise.all([this.loadCommitteeMembers(), this.loadListFacts(), this.reloadMemberBulkLoadDateMap()]);
    }
    unsubscribeReferenceListId(): number | null {
        const narrowListId = this.session.state.narrowListId;
        if (isNumber(narrowListId)) {
            return narrowListId;
        }
        else {
            const defaultListId = this.session.state.notificationConfig?.defaultListId;
            return isNumber(defaultListId) ? defaultListId : null;
        }
    }
    configHasPostSendAction(action: WorkflowAction): boolean {
        return (this.session.state.notificationConfig?.postSendActions ?? []).includes(action);
    }
    bulkDeletionPending(): boolean {
        return this.configHasPostSendAction(WorkflowAction.BULK_DELETE_GROUP_MEMBER);
    }
    memberDisablePending(): boolean {
        return this.configHasPostSendAction(WorkflowAction.DISABLE_GROUP_MEMBER);
    }
    workflowRemovesRecipients(): boolean {
        return this.bulkDeletionPending() || this.memberDisablePending();
    }
    requiresConsent(): boolean {
        if (this.session.state.recipientMode !== RecipientMode.SELECTED_MEMBERS) {
            return false;
        }
        else {
            return this.mailMessagingConfig?.mailConfig?.respectHeadOfficeConsent !== false;
        }
    }
    respectsBlocks(): boolean {
        return this.mailMessagingConfig?.mailConfig?.respectEmailBlocks === true;
    }
    bulkLoadFilterInUse(): boolean {
        const keys = [this.session.state.preFilterKey, this.session.state.notificationConfig?.defaultMemberSelection];
        return keys.some(key => !!key && BULK_LOAD_MEMBER_SELECTIONS.includes(key));
    }
    loadMemberBulkLoadDateMapIfNeeded(): Promise<void> {
        if (this.bulkLoadFilterInUse() && !this.memberBulkLoadDateMap && !this.memberBulkLoadDateMapLoad) {
            this.memberBulkLoadDateMapLoad = this.memberBulkLoadAuditService.createMemberBulkLoadDateMap()
                .then(dateMap => {
                    this.memberBulkLoadDateMap = dateMap;
                })
                .catch(() => {
                    this.memberBulkLoadDateMap = null;
                })
                .finally(() => {
                    this.memberBulkLoadDateMapLoad = null;
                });
        }
        return this.memberBulkLoadDateMapLoad ?? Promise.resolve();
    }
    reloadMemberBulkLoadDateMap(): Promise<void> {
        this.memberBulkLoadDateMap = null;
        return this.loadMemberBulkLoadDateMapIfNeeded();
    }
    sendRules(): MemberSendRules {
        return {respectEmailBlocks: this.respectsBlocks(), respectHeadOfficeConsent: this.requiresConsent(), referenceListId: this.unsubscribeReferenceListId()};
    }
}
