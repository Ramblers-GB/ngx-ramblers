import { DOCUMENT } from "@angular/common";
import { inject, Injectable } from "@angular/core";
import { EMAILED_ACCESS_COOKIE, EmailedAccessKey } from "../../models/committee.model";
import { StoredValue } from "../../models/ui-actions.model";
import { emailedAccessCookieValue, emailedAccessKeysFromCookieHeader, mergedEmailedAccessKeys, unexpiredEmailedAccessKeys } from "../../functions/emailed-access";
import { DateUtilsService } from "../date-utils.service";

@Injectable({
  providedIn: "root"
})
export class EmailedAccessService {

  private documentRef = inject(DOCUMENT);
  private dateUtils = inject(DateUtilsService);
  private lastCapturedKey: string = null;

  active(): boolean {
    return this.keys().length > 0;
  }

  grantsFile(committeeFileId: string): boolean {
    return !!committeeFileId && this.keys().some(entry => entry.payload.committeeFileId === committeeFileId);
  }

  captureKeyFromAddress(): void {
    const key = new URLSearchParams(this.documentRef.location?.search || "").get(StoredValue.ACCESS);
    if (key && key !== this.lastCapturedKey) {
      this.lastCapturedKey = key;
      const merged = mergedEmailedAccessKeys(this.storedKeys(), key, this.nowSeconds());
      const secure = this.documentRef.location?.protocol === "https:" ? "; Secure" : "";
      this.documentRef.cookie = `${EMAILED_ACCESS_COOKIE}=${emailedAccessCookieValue(merged)}; Path=/; SameSite=Lax${secure}`;
    }
  }

  private keys(): EmailedAccessKey[] {
    this.captureKeyFromAddress();
    return unexpiredEmailedAccessKeys(this.storedKeys(), this.nowSeconds());
  }

  private storedKeys(): string[] {
    return emailedAccessKeysFromCookieHeader(this.documentRef.cookie);
  }

  private nowSeconds(): number {
    return Math.floor(this.dateUtils.nowAsValue() / 1000);
  }
}
