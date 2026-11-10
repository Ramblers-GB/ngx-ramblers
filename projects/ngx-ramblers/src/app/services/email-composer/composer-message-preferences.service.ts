import {inject, Injectable} from "@angular/core";
import {StoredValue} from "../../models/ui-actions.model";
import {UiActionsService} from "../ui-actions.service";

@Injectable()
export class ComposerMessagePreferencesService {
  private ui = inject(UiActionsService);
  remember = this.ui.initialBooleanValueFor(StoredValue.COMPOSER_REMEMBER_DISMISSALS, false);
  private dismissed = this.ui.initialObjectValueFor<string[]>(StoredValue.COMPOSER_DISMISSED_MESSAGES, []) || [];
  revision = 0;
  blocking = (): boolean => false;

  setRemember(value: boolean): void {
    this.remember = value;
    this.revision += 1;
    this.ui.saveValueFor(StoredValue.COMPOSER_REMEMBER_DISMISSALS, value);
  }

  hidden(title: string): boolean {
    return this.remember && !this.blocking() && !!title && this.dismissed.includes(title);
  }

  dismiss(title: string): void {
    if (this.remember && !this.blocking() && title) {
      this.dismissed = [...new Set([...this.dismissed, title])];
      this.ui.saveValueFor(StoredValue.COMPOSER_DISMISSED_MESSAGES, this.dismissed);
    }
  }

  restore(): void {
    this.revision += 1;
    this.dismissed = [];
    this.ui.saveValueFor(StoredValue.COMPOSER_DISMISSED_MESSAGES, []);
  }
}
