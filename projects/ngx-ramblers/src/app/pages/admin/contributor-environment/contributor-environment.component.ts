import { Component, inject, OnDestroy, OnInit } from "@angular/core";
import { DOCUMENT } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";
import { faDownload, faSpinner, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { Subject } from "rxjs";
import { filter, takeUntil } from "rxjs/operators";
import { NgxLoggerLevel } from "ngx-logger";
import { Logger, LoggerFactory } from "../../../services/logger-factory.service";
import { EnvironmentSetupService } from "../../../services/environment-setup/environment-setup.service";
import { AlertInstance, NotifierService } from "../../../services/notifier.service";
import { AlertTarget } from "../../../models/alert-target.model";
import { PageComponent } from "../../../page/page.component";
import { LoginRequiredComponent } from "../../../modules/common/login-required/login-required";
import { AuthService } from "../../../auth/auth.service";
import { WebSocketClientService } from "../../../services/websockets/websocket-client.service";
import { EventType, MessageType } from "../../../models/websocket.model";
import { ContributorBundleWsComplete, ContributorBundleWsError, ContributorBundleWsProgress } from "../../../models/environment-setup.model";

function toKebabCase(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

@Component({
  selector: "app-contributor-environment",
  template: `
    <app-page>
      <app-login-required/>
      <div class="row">
        <div class="col-sm-12">
          <h1>Contributor Environment</h1>
          <p>Generate a developer environment bundle so a contributor can run NGX on their
            own machine against this group's data. A fresh AUTH_SECRET is generated for the
            bundle; no platform or other group's secrets are included.</p>
          <div class="form-group">
            <label for="environmentName">Environment name</label>
            <input id="environmentName" class="form-control" [ngModel]="environmentName"
                   (ngModelChange)="onEnvironmentNameChange($event)" (blur)="normaliseEnvironmentName()">
            <small class="text-muted">Kebab-case - this is the name used to start the environment
              locally via <code>ngx-cli local dev &lt;environment&gt;</code>.</small>
          </div>
          <div class="form-group">
            <label>Database</label>
            <div class="form-check">
              <input class="form-check-input" type="radio" id="modeCurrent" name="databaseMode"
                     [value]="false" [ngModel]="clone" (ngModelChange)="onCloneChange($event)">
              <label class="form-check-label" for="modeCurrent">
                Develop against the current database@if (currentDatabase) { ({{ currentDatabase }})}
              </label>
            </div>
            <div class="form-check">
              <input class="form-check-input" type="radio" id="modeClone" name="databaseMode"
                     [value]="true" [ngModel]="clone" (ngModelChange)="onCloneChange($event)">
              <label class="form-check-label" for="modeClone">
                Clone the current database into a new schema
              </label>
            </div>
          </div>
          @if (!clone) {
            <div class="alert alert-warning">
              <fa-icon [icon]="faTriangleExclamation"></fa-icon>
              <strong> Live data: </strong>
              the bundle holds this site's own database and storage credentials. Anything changed
              locally changes the live site, including members and sent email. Use a clone unless
              the contributor needs the live data.
            </div>
          }
          @if (clone) {
            <div class="alert alert-warning">
              <fa-icon [icon]="faTriangleExclamation"></fa-icon>
              <strong> Clone: </strong>
              the copy gets a database user that can only reach the clone, and read-only storage
              keys. Sending email is switched off, live mail, Walks Manager and inbox credentials are
              cleared, inbox and audit history are left out, and every member except you is
              anonymised. Copying a large group can take a few minutes.
            </div>
            <div class="form-group">
              <label for="schema">Schema</label>
              <input id="schema" class="form-control" [ngModel]="schema"
                     (ngModelChange)="onSchemaChange($event)" (blur)="checkSchema()">
              <small class="text-muted">
                A new schema on the same server, populated with a copy of the current data. The name must start with {{ currentDatabase }}-.
              </small>
              @if (clone && schema.trim() && currentDatabase && !schema.startsWith(currentDatabase + "-")) {
                <small class="d-block text-danger">Schema must start with {{ currentDatabase }}-.</small>
              }
              @if (schemaExists) {
                <small class="d-block text-danger">Schema {{ schema }} already exists - choose a new name.</small>
              }
            </div>
          }
          <button class="btn btn-primary"
                  [disabled]="generating || !environmentName.trim() || (clone && (!schema.trim() || schemaExists || !schemaAllowed()))"
                  (click)="generate()">
            <fa-icon [icon]="generating ? faSpinner : faDownload" [animation]="generating ? 'spin' : undefined"></fa-icon>
            {{ generating ? "Generating..." : "Generate developer environment" }}
          </button>
          @if (notifyTarget.showAlert) {
            <div class="mt-3 alert {{ notifyTarget.alert.class }}">
              <fa-icon [icon]="notifyTarget.alert.icon"></fa-icon>
              @if (notifyTarget.alertTitle) {
                <strong>{{ notifyTarget.alertTitle }}: </strong>
              }
              {{ notifyTarget.alertMessage }}
            </div>
          }
        </div>
      </div>
    </app-page>
  `,
  styleUrls: ["../admin/admin.component.sass"],
  imports: [PageComponent, LoginRequiredComponent, FormsModule, FontAwesomeModule]
})
export class ContributorEnvironmentComponent implements OnInit, OnDestroy {
  private logger: Logger = inject(LoggerFactory).createLogger(ContributorEnvironmentComponent, NgxLoggerLevel.ERROR);
  private environmentSetupService = inject(EnvironmentSetupService);
  private notifierService = inject(NotifierService);
  private document = inject(DOCUMENT);
  private webSocketClientService = inject(WebSocketClientService);
  private authService = inject(AuthService);
  private destroy$ = new Subject<void>();
  private requestId: string | null = null;
  protected readonly faDownload = faDownload;
  protected readonly faSpinner = faSpinner;
  protected readonly faTriangleExclamation = faTriangleExclamation;

  environmentName = "";
  currentDatabase = "";
  schema = "";
  clone = false;
  schemaExists = false;
  generating = false;
  notifyTarget: AlertTarget = {};
  notify: AlertInstance = this.notifierService.createAlertInstance(this.notifyTarget);

  async ngOnInit(): Promise<void> {
    this.subscribeToBundleMessages();
    try {
      const context = await this.environmentSetupService.contributorBundleContext();
      if (context?.environment) {
        this.environmentName = context.environment;
      }
      if (context?.database) {
        this.currentDatabase = context.database;
      }
    } catch (error) {
      this.logger.error("Could not load contributor bundle context:", error);
    }
    this.recomputeSchema();
  }

  onEnvironmentNameChange(value: string): void {
    this.environmentName = value;
    this.recomputeSchema();
  }

  normaliseEnvironmentName(): void {
    this.environmentName = toKebabCase(this.environmentName);
    this.recomputeSchema();
  }

  onCloneChange(value: boolean): void {
    this.clone = value;
    this.recomputeSchema();
  }

  recomputeSchema(): void {
    if (this.clone && this.currentDatabase) {
      const environment = toKebabCase(this.environmentName);
      const liveName = this.currentDatabase.replace(/^ngx-ramblers-/, "");
      if (environment && environment !== liveName) {
        this.schema = `${this.currentDatabase}-${environment}`;
      } else {
        this.schema = `${this.currentDatabase}-clone`;
      }
    } else if (this.clone) {
      this.schema = `ngx-ramblers-${toKebabCase(this.environmentName)}`;
    } else {
      this.schema = this.currentDatabase;
    }
    void this.checkSchema();
  }

  schemaAllowed(): boolean {
    return !!this.currentDatabase && this.schema.trim().startsWith(`${this.currentDatabase}-`);
  }

  onSchemaChange(value: string): void {
    this.schema = value;
    this.schemaExists = false;
  }

  async checkSchema(): Promise<void> {
    const schema = this.schema.trim();
    if (!this.clone || !schema) {
      this.schemaExists = false;
      return;
    }
    try {
      this.schemaExists = await this.environmentSetupService.schemaExists(schema);
    } catch (error) {
      this.logger.error("Could not check schema existence:", error);
      this.schemaExists = false;
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async generate(): Promise<void> {
    const environment = toKebabCase(this.environmentName);
    const requestId = crypto.randomUUID();
    this.environmentName = environment;
    this.requestId = requestId;
    this.generating = true;
    this.notify.progress({title: "Contributor environment", message: this.clone ? "Starting the clone" : "Building the bundle"}, true);
    try {
      await this.webSocketClientService.connect();
      this.webSocketClientService.sendMessage(EventType.CONTRIBUTOR_BUNDLE, {requestId, environmentName: environment, schema: this.schema.trim(), clone: this.clone}, this.authService.authToken());
    } catch (error) {
      this.logger.error("Could not connect to generate contributor bundle:", error);
      this.bundleFailed("Could not connect to the server. Try again.");
    }
  }

  private subscribeToBundleMessages(): void {
    this.webSocketClientService.receiveMessages<ContributorBundleWsProgress>(MessageType.PROGRESS)
      .pipe(filter(data => this.isCurrentRequest(data?.requestId)), takeUntil(this.destroy$))
      .subscribe(data => this.notify.progress({title: "Contributor environment", message: data.message}, true));
    this.webSocketClientService.receiveMessages<ContributorBundleWsComplete>(MessageType.COMPLETE)
      .pipe(filter(data => this.isCurrentRequest(data?.requestId)), takeUntil(this.destroy$))
      .subscribe(data => this.bundleReady(data));
    this.webSocketClientService.receiveMessages<ContributorBundleWsError>(MessageType.ERROR)
      .pipe(filter(data => this.isCurrentRequest(data?.requestId)), takeUntil(this.destroy$))
      .subscribe(data => this.bundleFailed(data.message));
  }

  private isCurrentRequest(requestId: string | null | undefined): boolean {
    return !!requestId && requestId === this.requestId;
  }

  private bundleReady(data: ContributorBundleWsComplete): void {
    this.requestId = null;
    this.generating = false;
    this.triggerDownload(this.zipBlob(data.zipBase64), data.fileName);
    this.notify.success({
      title: "Bundle ready",
      message: `Bundle downloaded. Unpack it into an ngx-ramblers checkout and run: ./bin/ngx-cli local dev ${this.environmentName} --no-docker-worker`
    });
  }

  private bundleFailed(message: string): void {
    this.requestId = null;
    this.generating = false;
    this.notify.error({
      title: "Bundle generation failed",
      message: message || "Could not generate the bundle - check the details and try again.",
      continue: true
    });
  }

  private zipBlob(zipBase64: string): Blob {
    const binary = atob(zipBase64);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new Blob([bytes], {type: "application/zip"});
  }

  private triggerDownload(bundle: Blob, fileName: string): void {
    const url = URL.createObjectURL(bundle);
    const link = this.document.createElement("a");
    link.href = url;
    link.download = fileName;
    this.document.body.appendChild(link);
    link.click();
    this.document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
