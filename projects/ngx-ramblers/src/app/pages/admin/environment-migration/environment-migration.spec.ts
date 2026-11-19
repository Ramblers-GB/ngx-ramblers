import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, Router } from "@angular/router";
import { LoggerTestingModule } from "ngx-logger/testing";
import { of } from "rxjs";
import { EnvironmentMigrationComponent } from "./environment-migration";
import {
  EnvironmentMigrationMode,
  EnvironmentMigrationPhase,
  EnvironmentMigrationStatus,
  EnvironmentMigrationStepKey,
  EnvironmentMigrationStepState
} from "../../../models/environment-migration.model";
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
    TestBed.inject(HttpTestingController).expectOne("api/environment-migration/aws/platform-target?environment=hillside")
      .flush({bucket: "ngx-ramblers-hillside-eu-west-2", region: "eu-west-2", accessKeyId: "AKIATEST", secretAccessKey: "secret"});
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

  it("fills destination AWS from Ramblers storage without starting a copy", async () => {
    state.page.request.environment = "hillside";
    state.page.request.mode = EnvironmentMigrationMode.S3_ONLY;
    const pending = state.page.useRamblersStorage();
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
    state.page.request.targetMongo = {cluster: "", db: "", username: "", password: ""};
    state.page.request.targetAws = {bucket: "ngx-ramblers-hillside", region: "eu-west-2", accessKeyId: "AKIATEST", secretAccessKey: "secret"};
    expect(state.page.formReady()).toBe(true);
    expect(state.page.includeMongo()).toBe(false);
    expect(state.page.stepKeys()).toEqual([
      EnvironmentMigrationStepKey.CHECK,
      EnvironmentMigrationStepKey.COPY,
      EnvironmentMigrationStepKey.SWITCH
    ]);
  });

  it("shows every step for a full move and starts at the first unfinished one", () => {
    state.page.request.environment = "hillside";
    state.page.request.mode = EnvironmentMigrationMode.MONGO_AND_S3;
    state.page.request.targetMongo = {cluster: "group-sites.abc123", db: "hillside-database", username: "", password: ""};
    expect(state.page.stepKeys()).toEqual([
      EnvironmentMigrationStepKey.PREPARE,
      EnvironmentMigrationStepKey.CHECK,
      EnvironmentMigrationStepKey.COPY,
      EnvironmentMigrationStepKey.SWITCH
    ]);
    expect(state.page.nextStep()).toBe(EnvironmentMigrationStepKey.PREPARE);
  });

  it("does not allow copying until the check has passed", () => {
    state.page.request.environment = "hillside";
    state.page.request.confirmEnvironment = "hillside";
    state.page.request.mode = EnvironmentMigrationMode.MONGO_ONLY;
    state.page.request.targetMongo = {cluster: "group-sites.abc123", db: "hillside-database", username: "hillside-user", password: "fictional-password"};
    expect(state.page.canStartCopy()).toBe(false);
    state.page.selectedMigration = {
      migrationId: "environment-migration-hillside",
      environment: "hillside",
      mode: EnvironmentMigrationMode.MONGO_ONLY,
      status: EnvironmentMigrationStatus.VALIDATED,
      phase: EnvironmentMigrationPhase.VERIFY_TARGET,
      dryRun: true,
      startTime: 0
    };
    expect(state.page.stepState(EnvironmentMigrationStepKey.CHECK)).toBe(EnvironmentMigrationStepState.DONE);
    expect(state.page.canStartCopy()).toBe(true);
  });

  it("keeps Mongo required when Mongo is included", () => {
    state.page.request.environment = "hillside";
    state.page.request.mode = EnvironmentMigrationMode.MONGO_AND_S3;
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

  it("lets the switch over run after a reload, when the page no longer holds the new login", () => {
    state.page.request.environment = "hillside";
    state.page.request.confirmEnvironment = "hillside";
    state.page.request.mode = EnvironmentMigrationMode.MONGO_ONLY;
    state.page.request.targetMongo = {cluster: "ngx-demo.abc123", db: "hillside-database", username: "", password: ""};
    state.page.selectedMigration = {
      migrationId: "environment-migration-hillside",
      environment: "hillside",
      mode: EnvironmentMigrationMode.MONGO_ONLY,
      status: EnvironmentMigrationStatus.READY_FOR_CUTOVER,
      phase: EnvironmentMigrationPhase.VERIFY_TARGET,
      dryRun: false,
      startTime: 0,
      targetMongo: {cluster: "ngx-demo.abc123", db: "hillside-database", username: "hillside-user", uriSummary: "hillside-user@ngx-demo.abc123/hillside-database"}
    };
    expect(state.page.stepState(EnvironmentMigrationStepKey.PREPARE)).toBe(EnvironmentMigrationStepState.DONE);
    expect(state.page.nextStep()).toBe(EnvironmentMigrationStepKey.SWITCH);
    expect(state.page.canRotate()).toBe(true);
  });

  it("offers the files as the next step when only the database has been moved", async () => {
    state.page.environmentsWithMongo = [{name: "hillside"}] as never;
    state.page.environmentsConfig = {environments: [{environment: "hillside", aws: {bucket: "ngx-ramblers-hillside", region: "eu-west-1"}}]} as never;
    state.page.request.environment = "hillside";
    state.page.history = [{
      migrationId: "environment-migration-hillside",
      environment: "hillside",
      mode: EnvironmentMigrationMode.MONGO_ONLY,
      status: EnvironmentMigrationStatus.ROTATED,
      phase: EnvironmentMigrationPhase.ROTATE_CREDENTIALS,
      dryRun: false,
      startTime: 0
    }];
    (state.page as any).selectRemainingMigration();
    expect(state.page.request.mode).toBe(EnvironmentMigrationMode.S3_ONLY);
    expect(state.page.selectedMigration).toBeNull();
    expect(state.page.nextStep()).toBe(EnvironmentMigrationStepKey.CHECK);
  });

  it("picks up a copy that is still running after a reload instead of asking for a new login", () => {
    state.page.environmentsWithMongo = [{name: "hillside"}] as never;
    state.page.environmentsConfig = {environments: [{environment: "hillside"}]} as never;
    state.page.request.environment = "hillside";
    state.page.history = [{
      migrationId: "environment-migration-hillside",
      environment: "hillside",
      mode: EnvironmentMigrationMode.MONGO_ONLY,
      status: EnvironmentMigrationStatus.RESTORING,
      phase: EnvironmentMigrationPhase.RESTORE_TARGET,
      dryRun: false,
      startTime: 0
    }];
    const poll = vi.spyOn(state.page as any, "pollMigration").mockImplementation(() => undefined);
    (state.page as any).selectRemainingMigration();
    expect(state.page.stepState(EnvironmentMigrationStepKey.PREPARE)).toBe(EnvironmentMigrationStepState.DONE);
    expect(state.page.nextStep()).toBe(EnvironmentMigrationStepKey.COPY);
    expect(state.page.nextStepState()).toBe(EnvironmentMigrationStepState.RUNNING);
    expect(poll).toHaveBeenCalledWith("environment-migration-hillside");
  });

  it("offers the files after a database-only switch over without a reload", async () => {
    state.page.environmentsWithMongo = [{name: "hillside"}] as never;
    state.page.environmentsConfig = {environments: [{environment: "hillside", aws: {bucket: "ngx-ramblers-hillside", region: "eu-west-1"}}]} as never;
    state.page.request.environment = "hillside";
    state.page.request.mode = EnvironmentMigrationMode.MONGO_ONLY;
    state.page.request.confirmEnvironment = "hillside";
    const rotated = {
      migrationId: "environment-migration-hillside",
      environment: "hillside",
      mode: EnvironmentMigrationMode.MONGO_ONLY,
      status: EnvironmentMigrationStatus.ROTATED,
      phase: EnvironmentMigrationPhase.ROTATE_CREDENTIALS,
      dryRun: false,
      startTime: 0
    };
    state.page.selectedMigration = {...rotated, status: EnvironmentMigrationStatus.READY_FOR_CUTOVER};
    const migrationService = TestBed.inject(EnvironmentMigrationService);
    vi.spyOn(migrationService, "rotateMongoCredentials").mockReturnValue(of(rotated));
    vi.mocked(state.page.loadHistory).mockImplementation(async () => {
      state.page.history = [rotated];
    });
    const pending = state.page.rotate();
    await pending;
    TestBed.inject(HttpTestingController).expectOne("api/environment-migration/aws/platform-target?environment=hillside")
      .flush({bucket: "ngx-ramblers-hillside-eu-west-2", region: "eu-west-2", accessKeyId: "AKIATEST", secretAccessKey: "secret"});
    expect(state.page.request.mode).toBe(EnvironmentMigrationMode.S3_ONLY);
    expect(state.page.nextStep()).toBe(EnvironmentMigrationStepKey.CHECK);
  });

  it("ignores progress for a site that is no longer selected, and stops older progress checks", async () => {
    vi.useFakeTimers();
    const running = (migrationId: string, environment: string) => ({
      migrationId,
      environment,
      mode: EnvironmentMigrationMode.MONGO_ONLY,
      status: EnvironmentMigrationStatus.RESTORING,
      phase: EnvironmentMigrationPhase.RESTORE_TARGET,
      dryRun: false,
      startTime: 0
    });
    const migrationService = TestBed.inject(EnvironmentMigrationService);
    const migration = vi.spyOn(migrationService, "migration").mockImplementation(migrationId => of(running(migrationId, migrationId === "first" ? "hillside" : "valley")));
    state.page.request.environment = "hillside";
    (state.page as any).pollMigration("first");
    state.page.request.environment = "valley";
    (state.page as any).pollMigration("second");
    await vi.advanceTimersByTimeAsync(5000);
    expect(migration).toHaveBeenCalledTimes(1);
    expect(state.page.selectedMigration.migrationId).toBe("second");
    state.page.request.environment = "hillside";
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.page.selectedMigration.migrationId).toBe("second");
    expect((state.page as any).pollingMigrationId).toBeNull();
    vi.useRealTimers();
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
