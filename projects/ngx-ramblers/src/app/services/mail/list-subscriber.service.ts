import { inject, Injectable } from "@angular/core";
import { Member } from "../../models/member.model";
import { MailListUpdaterService } from "./mail-list-updater.service";
import { StringUtilsService } from "../string-utils.service";

const TOOLTIP_NAME_PREVIEW_LIMIT = 30;

@Injectable({providedIn: "root"})
export class ListSubscriberService {

  private mailListUpdaterService = inject(MailListUpdaterService);
  private stringUtils = inject(StringUtilsService);

  private subscribedByMembers = new WeakMap<Member[], Map<number, Member[]>>();

  subscribers(members: Member[], listId: number): Member[] {
    const source = members ?? [];
    const byList = this.subscribedByMembers.get(source) ?? new Map<number, Member[]>();
    if (!byList.has(listId)) {
      byList.set(listId, this.mailListUpdaterService.subscribedMembers(source, listId));
      this.subscribedByMembers.set(source, byList);
    }
    return byList.get(listId);
  }

  subscriberCount(members: Member[], listId: number): number {
    return this.subscribers(members, listId).length;
  }

  subscriberCountLabel(members: Member[], listId: number): string {
    return this.stringUtils.pluraliseWithCount(this.subscriberCount(members, listId), "subscriber");
  }

  subscriberNamesTooltip(members: Member[], listId: number): string {
    const names = this.subscribers(members, listId)
      .map(member => `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim())
      .filter(name => name.length > 0)
      .sort();
    return this.namesTooltip(names, names.length);
  }

  namesTooltip(names: string[], total: number): string {
    const preview = names.slice(0, TOOLTIP_NAME_PREVIEW_LIMIT).join(", ");
    if (total === 0 || names.length === 0) {
      return "No members subscribed";
    } else if (total > TOOLTIP_NAME_PREVIEW_LIMIT) {
      return `${preview} and ${total - TOOLTIP_NAME_PREVIEW_LIMIT} more`;
    } else {
      return preview;
    }
  }
}
