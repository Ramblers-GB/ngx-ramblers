import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, Router } from "@angular/router";
import { LoggerTestingModule } from "ngx-logger/testing";
import { of } from "rxjs";
import { EnvironmentMigrationComponent } from "./environment-migration";
import { EnvironmentMigrationMode, EnvironmentMigrationPhase, EnvironmentMigrationStatus } from "../../../models/environment-migration.model";
import { BackupAndRestoreService } from "../../../services/backup-and-restore.service";
import { EnvironmentConfigService } from "../../../services/environment-config.service";
import { EnvironmentMigrationService } from "../../../services/environment-migration.service";
import { LoggerFactory } from "../../../services/logger-factory.service";
import { EnvironmentsConfig } from "../../../models/environment-config.model";

describe("migration target credentials", () => {
  const config: EnvironmentsConfig = {environments: [], atlas: {defaultCluster: "group-sites.abc123"}};
  const state = {page: null as EnvironmentMigrationComponent | null};

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LoggerTestingModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        EnvironmentMigrationService,
        {provide: BackupAndRestoreService, useValue: {}},
        {provide: EnvironmentConfigService, useValue: {events: () => of(config)}},
        {provide: LoggerFactory, useValue: {createLogger: () => ({error: vi.fn()})}},
        {provide: ActivatedRoute, useValue: {snapshot: {queryParams: {}}, queryParams: of({})}},
        {provide: Router, useValue: {navigate: vi.fn().mockResolvedValue(true)}}
      ]
    });
    state.page = TestBed.runInInjectionContext(() => new EnvironmentMigrationComponent());
    vi.spyOn(state.page, "loadHistory").mockResolvedValue();
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it("prefills the default cluster without creating a user or changing existing credentials", async () => {
    state.page.request.targetMongo.username = "saved-user";
    await state.page.loadEnvironmentConfig();
    expect(state.page.request.targetMongo.cluster).toBe("group-sites.abc123");
    expect(state.page.request.targetMongo.username).toBe("saved-user");
  });

  it("keeps a manually selected target cluster when settings load", async () => {
    state.page.request.targetMongo.cluster = "other-target.abc123";
    await state.page.loadEnvironmentConfig();
    expect(state.page.request.targetMongo.cluster).toBe("other-target.abc123");
  });

  it("clears credentials and typed confirmation when changing the source environment", async () => {
    state.page.environments = [{name: "hillside", database: "hillside-database"}] as never;
    state.page.request.environment = "hillside";
    state.page.request.targetMongo = {cluster: "group-sites.abc123", db: "previous-database", username: "previous-user", password: "fictional-password"};
    state.page.request.confirmEnvironment = "previous-environment";
    await state.page.onEnvironmentChange();
    expect(state.page.request.targetMongo).toEqual({cluster: "group-sites.abc123", db: "hillside-database", username: "", password: ""});
    expect(state.page.request.confirmEnvironment).toBe("");
    expect(state.page.selectedMigration).toBeNull();
  });

  it("fills the target fields from the NGX provisioning response without starting a migration", async () => {
    state.page.request.environment = "hillside";
    state.page.request.targetMongo.cluster = "group-sites.abc123";
    const pending = state.page.provisionMongoTarget();
    const request = TestBed.inject(HttpTestingController).expectOne("api/environment-migration/mongo/provision");
    expect(request.request.body).toEqual({environment: "hillside", cluster: "group-sites.abc123"});
    expect(request.request.method).toBe("POST");
    request.flush({cluster: "group-sites.abc123", db: "hillside-database", username: "hillside-user", password: "fictional-password"});
    await pending;
    expect(state.page.request.targetMongo.username).toBe("hillside-user");
    expect(state.page.busy).toBe(false);
    expect(state.page.selectedMigration).toBeNull();
  });

  it("fills destination AWS from platform credentials without starting a copy", async () => {
    state.page.request.environment = "hillside";
    state.page.request.mode = EnvironmentMigrationMode.S3_ONLY;
    state.page.copyToDestinationAws = true;
    const pending = state.page.usePlatformAws();
    const request = TestBed.inject(HttpTestingController).expectOne("api/environment-migration/aws/platform-target?environment=hillside");
    expect(request.request.method).toBe("GET");
    request.flush({bucket: "ngx-ramblers-hillside-eu-west-2", region: "eu-west-2", accessKeyId: "AKIATEST", secretAccessKey: "secret"});
    await pending;
    expect(state.page.request.targetAws.bucket).toBe("ngx-ramblers-hillside-eu-west-2");
    expect(state.page.request.targetAws.region).toBe("eu-west-2");
    expect(state.page.busy).toBe(false);
  });

  it("lets an S3-only plan run without Mongo target credentials", () => {
    state.page.request.environment = "hillside";
    state.page.request.mode = EnvironmentMigrationMode.S3_ONLY;
    state.page.copyToDestinationAws = true;
    state.page.request.targetMongo = {cluster: "", db: "", username: "", password: ""};
    state.page.request.targetAws = {bucket: "ngx-ramblers-hillside", region: "eu-west-2", accessKeyId: "AKIATEST", secretAccessKey: "secret"};
    expect(state.page.formReady()).toBe(true);
    expect(state.page.includeMongo()).toBe(false);
    expect(state.page.executeButtonLabel()).toBe("Copy S3 objects");
  });

  it("keeps Mongo required when Mongo is included", () => {
    state.page.request.environment = "hillside";
    state.page.request.mode = EnvironmentMigrationMode.MONGO_AND_S3;
    state.page.copyToDestinationAws = true;
    state.page.request.targetMongo = {cluster: "", db: "", username: "", password: ""};
    state.page.request.targetAws = {bucket: "ngx-ramblers-hillside", region: "eu-west-2", accessKeyId: "AKIATEST", secretAccessKey: "secret"};
    expect(state.page.formReady()).toBe(false);
  });

  it("lets Rotate Credentials run again after a verified restore whose cutover failed", () => {
    state.page.request.environment = "hillside";
    state.page.request.confirmEnvironment = "hillside";
    state.page.request.mode = EnvironmentMigrationMode.MONGO_ONLY;
    state.page.request.targetMongo = {cluster: "ngx-demo.abc123", db: "hillside-database", username: "hillside-user", password: "fictional-password"};
    state.page.selectedMigration = {
      migrationId: "environment-migration-hillside",
      environment: "hillside",
      mode: EnvironmentMigrationMode.MONGO_ONLY,
      status: EnvironmentMigrationStatus.FAILED,
      phase: EnvironmentMigrationPhase.ROTATE_CREDENTIALS,
      dryRun: false,
      startTime: 0,
      sourceMongo: {cluster: "old", db: "hillside-database", username: "old-user", uriSummary: "old-user@old/hillside-database"},
      targetMongo: {cluster: "ngx-demo.abc123", db: "hillside-database", username: "hillside-user", uriSummary: "hillside-user@ngx-demo.abc123/hillside-database"},
      verification: {collections: ["config"], totalDocumentCount: 1, keyCollectionCounts: []}
    };
    expect(state.page.canRotate()).toBe(true);
  });

  it("keeps the target fields and shows a provisioning failure", async () => {
    state.page.request.environment = "hillside";
    state.page.request.targetMongo.cluster = "group-sites.abc123";
    const pending = state.page.provisionMongoTarget();
    TestBed.inject(HttpTestingController).expectOne("api/environment-migration/mongo/provision").flush({error: "Target user already exists"}, {status: 400, statusText: "Bad Request"});
    await pending;
    expect(state.page.error).toBe("Target user already exists");
    expect(state.page.request.targetMongo.username).toBe("");
    expect(state.page.busy).toBe(false);
  });
});
