import { inject, Injectable } from "@angular/core";
import { NgxLoggerLevel } from "ngx-logger";
import { abbreviatedWalksManagerContactName, firstAndLastNameFrom, memberFullName } from "../../functions/member-names";
import { defaultDisplayName } from "../../functions/walks/ramblers-event.mapper";
import {
  createDisplayNameFromMember,
  createUniqueDisplayName,
  createUniqueUserName,
  createUniqueValueFrom,
  createUserName,
  removeCharactersNotPartOfName,
  removeSpacesAndLower
} from "../../functions/member-naming";
import { FirstAndLastName, HasEmailFirstAndLastName, Member, RamblersMember } from "../../models/member.model";
import { Logger, LoggerFactory } from "../logger-factory.service";

@Injectable({
  providedIn: "root"
})
export class MemberNamingService {

  private logger: Logger = inject(LoggerFactory).createLogger("MemberNamingService", NgxLoggerLevel.ERROR);

  createDisplayNameFromContactName(contactName: string): string {
    return contactName ? defaultDisplayName(contactName) : null;
  }

  public firstAndLastNameFrom(contactName: string | null): FirstAndLastName | null {
    return firstAndLastNameFrom(contactName);
  }

  public memberFullName(member: Member, defaultValue = ""): string {
    return memberFullName(member, defaultValue);
  }

  public abbreviatedWalksManagerContactName(contactName: string): boolean {
    return abbreviatedWalksManagerContactName(contactName);
  }

  createUniqueUserName(member: RamblersMember | Member, members: Member[]) {
    return createUniqueUserName(member, members);
  }

  createUniqueDisplayName(member: HasEmailFirstAndLastName, members: Member[]) {
    return createUniqueDisplayName(member, members);
  }

  public createUniqueValueFrom(value: string, field: string, members: Member[]) {
    return createUniqueValueFrom(value, field, members);
  }

  public createUserName(member: RamblersMember | Member): string {
    return createUserName(member);
  }

  public removeSpacesAndLower(value: string): string {
    return removeSpacesAndLower(value);
  }

  public removeCharactersNotPartOfName(value: string): string {
    return removeCharactersNotPartOfName(value);
  }

  public createDisplayNameFromMember(member: Member): string {
    return createDisplayNameFromMember(member);
  }

}
