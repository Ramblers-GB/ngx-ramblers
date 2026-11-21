import { inject, Injectable } from "@angular/core";
import { chunk, uniq } from "es-toolkit/compat";
import { NgxLoggerLevel } from "ngx-logger";
import { Member } from "../../models/member.model";
import { COMPOSER_MEMBER_LOOKUP_LIMIT } from "../../models/email-composer.model";
import { EmailComposerAudienceService } from "./email-composer-audience.service";
import { LoggerFactory } from "../logger-factory.service";

@Injectable()
export class EmailComposerMemberDirectoryService {
  private logger = inject(LoggerFactory).createLogger("EmailComposerMemberDirectoryService", NgxLoggerLevel.ERROR);
  private audienceService = inject(EmailComposerAudienceService);
  private byId = new Map<string, Member>();
  private byEmail = new Map<string, Member>();
  private missingIds = new Set<string>();
  private missingEmails = new Set<string>();
  private loadingIds = new Map<string, Promise<void>>();
  private loadingEmails = new Map<string, Promise<void>>();
  private pending: Promise<void>[] = [];
  private cachedMembers: Member[] = [];
  revision = 0;

  members(): Member[] {
    return this.cachedMembers;
  }

  memberById(id: string | null | undefined): Member | null {
    return id ? this.byId.get(id) ?? null : null;
  }

  memberByEmail(email: string | null | undefined): Member | null {
    const key = (email || "").trim().toLowerCase();
    return key ? this.byEmail.get(key) ?? null : null;
  }

  membersForIds(ids: string[]): Member[] {
    return (ids ?? []).map(id => this.byId.get(id)).filter((member): member is Member => !!member);
  }

  hasAllIds(ids: string[]): boolean {
    return (ids ?? []).every(id => this.byId.has(id) || this.missingIds.has(id));
  }

  ensureMembers(ids: string[], emails: string[] = []): Promise<void> {
    const loading = uniq([
      ...(ids ?? []).map(id => this.loadingIds.get(id)),
      ...(emails ?? []).map(email => this.loadingEmails.get((email || "").trim().toLowerCase()))
    ].filter((work): work is Promise<void> => !!work));
    const wantedIds = uniq((ids ?? []).filter(id => !!id && !this.byId.has(id) && !this.missingIds.has(id) && !this.loadingIds.has(id)));
    const wantedEmails = uniq((emails ?? []).map(email => (email || "").trim().toLowerCase())
      .filter(email => !!email && !this.byEmail.has(email) && !this.missingEmails.has(email) && !this.loadingEmails.has(email)));
    if (wantedIds.length === 0 && wantedEmails.length === 0) {
      return Promise.all(loading).then(() => null);
    } else {
      const work = this.track(this.fetch(wantedIds, wantedEmails));
      wantedIds.forEach(id => this.loadingIds.set(id, work));
      wantedEmails.forEach(email => this.loadingEmails.set(email, work));
      return Promise.all([...loading, work]).then(() => null).finally(() => {
        wantedIds.forEach(id => this.loadingIds.delete(id));
        wantedEmails.forEach(email => this.loadingEmails.delete(email));
      });
    }
  }

  loadCommitteeMembers(): Promise<void> {
    return this.track(this.audienceService.members({committee: true}).then(members => this.store(members)));
  }

  settled(): Promise<void> {
    const pending = [...this.pending];
    return Promise.all(pending).then(() => this.pending.some(item => !pending.includes(item)) ? this.settled() : null);
  }

  forget(): void {
    this.byId.clear();
    this.byEmail.clear();
    this.missingIds.clear();
    this.missingEmails.clear();
    this.publish();
  }

  private async fetch(ids: string[], emails: string[]): Promise<void> {
    const batches = [
      ...chunk(ids, COMPOSER_MEMBER_LOOKUP_LIMIT).map(memberIds => ({memberIds})),
      ...chunk(emails, COMPOSER_MEMBER_LOOKUP_LIMIT).map(batch => ({emails: batch}))
    ];
    const results = await batches.reduce(async (pending, request) => [...await pending, await this.audienceService.members(request)], Promise.resolve([] as Member[][]));
    this.store(results.flat());
    ids.filter(id => !this.byId.has(id)).forEach(id => this.missingIds.add(id));
    emails.filter(email => !this.byEmail.has(email)).forEach(email => this.missingEmails.add(email));
  }

  private track(work: Promise<void>): Promise<void> {
    const tracked = work.catch(error => this.logger.error("member lookup failed:", error));
    this.pending = [...this.pending, tracked];
    return tracked.finally(() => {
      this.pending = this.pending.filter(item => item !== tracked);
    });
  }

  private store(members: Member[]): void {
    members.filter(member => !!member?.id).forEach(member => {
      this.byId.set(member.id, member);
      const email = (member.email || "").trim().toLowerCase();
      if (email && !this.byEmail.has(email)) {
        this.byEmail.set(email, member);
      }
    });
    this.publish();
  }

  private publish(): void {
    this.cachedMembers = [...this.byId.values()];
    this.revision++;
  }
}
