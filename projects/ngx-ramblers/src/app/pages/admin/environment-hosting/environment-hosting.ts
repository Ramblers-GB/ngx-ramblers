import { Component, inject, OnDestroy, OnInit } from "@angular/core";
import { Subscription } from "rxjs";
import { faCircleCheck, faCircleExclamation } from "@fortawesome/free-solid-svg-icons";
import { PageComponent } from "../../../page/page.component";
import { EnvironmentHostingSettings } from "../../../modules/common/environment-settings/environment-hosting-settings";
import { FormSaveActionsComponent } from "../../../modules/common/form-save-actions/form-save-actions";
import { AlertPanelComponent } from "../../../modules/common/alert-panel/alert-panel";
import { AlertPanelVariant } from "../../../models/alert-panel.model";
import { FormSaveActions } from "../../../models/form-save-actions.model";
import { EnvironmentsConfig } from "../../../models/environment-config.model";
import { AdminPlatformPath } from "../../../models/admin-route-paths.model";
import { EnvironmentConfigService } from "../../../services/environment-config.service";
import { UrlService } from "../../../services/url.service";

@Component({
  selector: "app-environment-hosting",
  imports: [PageComponent, EnvironmentHostingSettings, FormSaveActionsComponent, AlertPanelComponent],
  template: `
    <app-page autoTitle pageTitle="Hosting">
      @if (errorMessage) {
        <app-alert-panel class="mb-3"
                         [title]="errorTitle"
                         [icon]="faCircleExclamation"
                         [variant]="AlertPanelVariant.DANGER">
          {{ errorMessage }}
        </app-alert-panel>
      } @else if (savedMessage) {
        <app-alert-panel class="mb-3"
                         title="Hosting saved"
                         [icon]="faCircleCheck"
                         [variant]="AlertPanelVariant.SUCCESS">
          {{ savedMessage }}
        </app-alert-panel>
      }
      @if (config) {
        <app-environment-hosting-settings [config]="config"/>
      }
      <div class="mt-3">
        <app-form-save-actions [disabled]="saving || !config" [actions]="formSaveActions"/>
      </div>
    </app-page>
  `
})
export class EnvironmentHostingComponent implements OnInit, OnDestroy {
  private environmentConfigService = inject(EnvironmentConfigService);
  private urlService = inject(UrlService);
  private subscriptions: Subscription[] = [];

  protected readonly faCircleCheck = faCircleCheck;
  protected readonly faCircleExclamation = faCircleExclamation;
  protected readonly AlertPanelVariant = AlertPanelVariant;

  config: EnvironmentsConfig | null = null;
  saving = false;
  errorTitle = "";
  errorMessage = "";
  savedMessage = "";

  formSaveActions: FormSaveActions = {
    save: () => this.save(),
    saveAndExit: () => this.save().then(() => this.exit()),
    undo: () => this.environmentConfigService.refresh(),
    cancel: () => this.exit()
  };

  ngOnInit() {
    this.subscriptions.push(this.environmentConfigService.events().subscribe({
      next: config => {
        this.config = JSON.parse(JSON.stringify(config));
        this.errorMessage = "";
      },
      error: error => {
        this.errorTitle = "Could not load the platform configuration";
        this.errorMessage = error?.message || String(error);
      }
    }));
  }

  ngOnDestroy() {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
  }

  async save(): Promise<void> {
    this.saving = true;
    this.savedMessage = "";
    this.errorMessage = "";
    try {
      await this.environmentConfigService.saveConfig(this.config);
      this.savedMessage = "Site status, notes, Fly machine and estate deploy settings have been saved.";
    } catch (error) {
      this.errorTitle = "Could not save hosting settings";
      this.errorMessage = error?.message || String(error);
      throw error;
    } finally {
      this.saving = false;
    }
  }

  private exit() {
    this.urlService.navigateTo([AdminPlatformPath.ENVIRONMENT_MANAGEMENT]);
  }
}
