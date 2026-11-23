import { StoredValue } from "../../../models/ui-actions.model";
import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, Router } from "@angular/router";
import { LoggerTestingModule } from "ngx-logger/testing";
import { of, throwError } from "rxjs";
import { EnvironmentMigrationComponent } from "./environment-migration";
import {
  EnvironmentMigrationAudit,
  EnvironmentMigrationMode,
  EnvironmentMigrationPhase,
  resumableMove,
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

  it("honours an S3-only link when the database has not moved", () => {
    TestBed.inject(ActivatedRoute).snapshot.queryParams[StoredValue.MIGRATION_MODE] = EnvironmentMigrationMode.S3_ONLY;
    state.page.request.environment = "hillside";
    state.page.environmentsWithMongo = [{name: "hillside"}] as never;
    state.page.environmentsConfig = {environments: [{environment: "hillside", aws: {bucket: "hillside-files"}}]} as never;
    (state.page as any).selectRemainingMigration();
    expect(state.page.request.mode).toBe(EnvironmentMigrationMode.S3_ONLY);
    expect(state.page.includeMongo()).toBe(false);
    expect(state.page.showDatabaseTarget()).toBe(false);
    expect(state.page.moveLabel()).toBe("Move photos and files");
    expect(state.page.moveReady()).toBe(true);
    expect((state.page as any).requestToSend().targetMongo).toBeUndefined();
  });

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

  it("lets an S3-only move start without Mongo target credentials", () => {
    state.page.request.environment = "hillside";
    state.page.request.mode = EnvironmentMigrationMode.S3_ONLY;
    state.page.request.targetMongo = {cluster: "", db: "", username: "", password: ""};
    state.page.request.targetAws = {bucket: "ngx-ramblers-hillside", region: "eu-west-2", accessKeyId: "AKIATEST", secretAccessKey: "secret"};
    expect(state.page.moveReady()).toBe(true);
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

  it("keeps Mongo required when Mongo is included", () => {
    state.page.request.environment = "hillside";
    state.page.request.mode = EnvironmentMigrationMode.MONGO_AND_S3;
    state.page.request.targetMongo = {cluster: "", db: "", username: "", password: ""};
    state.page.request.targetAws = {bucket: "ngx-ramblers-hillside", region: "eu-west-2", accessKeyId: "AKIATEST", secretAccessKey: "secret"};
    expect(state.page.moveReady()).toBe(false);
  });

  it("rotates the credentials when moving a migration ready for cutover, even after a reload", async () => {
    state.page.request.environment = "hillside";
    state.page.request.mode = EnvironmentMigrationMode.MONGO_ONLY;
    state.page.request.targetMongo = {cluster: "ngx-demo.abc123", db: "hillside-database", username: "", password: ""};
    const migration = {
      migrationId: "environment-migration-hillside",
      environment: "hillside",
      mode: EnvironmentMigrationMode.MONGO_ONLY,
      status: EnvironmentMigrationStatus.READY_FOR_CUTOVER,
      phase: EnvironmentMigrationPhase.VERIFY_TARGET,
      dryRun: false,
      startTime: 0,
      targetMongo: {cluster: "ngx-demo.abc123", db: "hillside-database", username: "hillside-user", uriSummary: "hillside-user@ngx-demo.abc123/hillside-database"}
    };
    state.page.history = [migration];
    state.page.selectedMigration = migration;
    const rotate = vi.spyOn(state.page, "rotate").mockResolvedValue();
    await state.page.moveNow();
    expect(rotate).toHaveBeenCalled();
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

  describe("moving a database that has been moved before", () => {
    const switched = {
      migrationId: "first-move",
      environment: "hillside",
      mode: EnvironmentMigrationMode.MONGO_ONLY,
      status: EnvironmentMigrationStatus.ROTATED,
      phase: EnvironmentMigrationPhase.ROTATE_CREDENTIALS,
      dryRun: false,
      startTime: 1000
    };

    beforeEach(() => {
      state.page.environmentsWithMongo = [{name: "hillside"}] as never;
      state.page.environmentsConfig = {atlas: {defaultCluster: "group-sites.abc123"}, environments: [{environment: "hillside", mongo: {cluster: "busy-sites.abc123"}}]} as never;
      state.page.request.environment = "hillside";
    });

    const spareServer = {cluster: "spare-sites.abc123", username: "", password: "", databases: [], environments: []};
    const newLogin = {cluster: "spare-sites.abc123", db: "hillside-database", username: "hillside-new-user", password: "secret"};
    const withFilesLeft = () => {
      state.page.environmentsConfig = {atlas: {defaultCluster: "group-sites.abc123"}, environments: [{environment: "hillside", mongo: {cluster: "busy-sites.abc123"}, aws: {bucket: "hillside-live-bucket", region: "eu-west-2"}}]} as never;
      state.page.history = [switched];
      (state.page as any).selectRemainingMigration();
    };
    const migrationService = () => TestBed.inject(EnvironmentMigrationService);
    const record = (overrides: Partial<EnvironmentMigrationAudit>): EnvironmentMigrationAudit => ({...switched, migrationId: "second-move", startTime: 2000, targetMongo: {cluster: "spare-sites.abc123", db: "hillside-database", username: "hillside-new-user", uriSummary: "hillside-new-user@spare-sites.abc123/hillside-database"}, ...overrides});

    it("moves the photos and files only when no server is chosen, and says so", () => {
      withFilesLeft();
      expect(state.page.request.mode).toBe(EnvironmentMigrationMode.S3_ONLY);
      expect(state.page.request.targetMongo.cluster).toBe("");
      expect(state.page.moveLabel()).toBe("Move photos and files");
      expect(state.page.moveHint()).toContain("Choose a server to move the database");
    });

    it("makes Move a database move as soon as a server is chosen, even with files still to move", () => {
      withFilesLeft();
      state.page.targetClusterChanged(spareServer);
      expect(state.page.request.mode).toBe(EnvironmentMigrationMode.MONGO_ONLY);
      expect(state.page.moveLabel()).toBe("Move database");
      expect(state.page.moveReady()).toBe(true);
      state.page.targetClusterChanged(null);
      expect(state.page.request.mode).toBe(EnvironmentMigrationMode.S3_ONLY);
    });

    it("runs the whole database move from one press, sending the environment name the server asks for", async () => {
      withFilesLeft();
      state.page.targetClusterChanged(spareServer);
      vi.spyOn(state.page as any, "pollMigration").mockImplementation(() => undefined);
      vi.spyOn(migrationService(), "provisionMongoTarget").mockReturnValue(of(newLogin));
      const plan = vi.spyOn(migrationService(), "planMongoOnlyMigration").mockReturnValue(of(record({status: EnvironmentMigrationStatus.VALIDATED, dryRun: true})));
      const execute = vi.spyOn(migrationService(), "executeMongoOnlyMigration").mockReturnValue(of(record({status: EnvironmentMigrationStatus.READY_FOR_CUTOVER})));
      const rotate = vi.spyOn(migrationService(), "rotateMongoCredentials").mockReturnValue(of(record({status: EnvironmentMigrationStatus.ROTATED})));
      await state.page.moveNow();
      expect(state.page.error).toBe("");
      expect(plan).toHaveBeenCalledWith(expect.objectContaining({mode: EnvironmentMigrationMode.MONGO_ONLY, dryRun: true}));
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({mode: EnvironmentMigrationMode.MONGO_ONLY, confirmEnvironment: "hillside", dryRun: false}));
      expect(execute.mock.calls[0][0].targetAws).toBeUndefined();
      expect(rotate).toHaveBeenCalledWith(expect.objectContaining({migrationId: "second-move", confirmEnvironment: "hillside", rotateS3Credentials: false}));
      expect(state.page.moveCompleted).toContain("the database is now on spare-sites.");
      expect(state.page.moveCompleted).not.toContain("abc123");
      expect(state.page.request.confirmEnvironment).toBe("");
      expect(state.page.moving).toBe(false);
    });

    it("stops at the first stage that fails and shows why", async () => {
      withFilesLeft();
      state.page.targetClusterChanged(spareServer);
      vi.spyOn(migrationService(), "provisionMongoTarget").mockReturnValue(throwError(() => ({error: {error: "Atlas would not create the login"}})));
      const plan = vi.spyOn(migrationService(), "planMongoOnlyMigration");
      const execute = vi.spyOn(migrationService(), "executeMongoOnlyMigration");
      const rotate = vi.spyOn(migrationService(), "rotateMongoCredentials");
      await state.page.moveNow();
      expect(state.page.error).toBe("Atlas would not create the login");
      expect(plan).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(rotate).not.toHaveBeenCalled();
    });

    it("does not switch the site over when the copy fails", async () => {
      withFilesLeft();
      state.page.targetClusterChanged(spareServer);
      vi.spyOn(state.page as any, "pollMigration").mockImplementation(() => undefined);
      vi.spyOn(migrationService(), "provisionMongoTarget").mockReturnValue(of(newLogin));
      vi.spyOn(migrationService(), "planMongoOnlyMigration").mockReturnValue(of(record({status: EnvironmentMigrationStatus.VALIDATED, dryRun: true})));
      vi.spyOn(migrationService(), "executeMongoOnlyMigration").mockReturnValue(of(record({status: EnvironmentMigrationStatus.FAILED, error: "Restore failed: target full"})));
      const rotate = vi.spyOn(migrationService(), "rotateMongoCredentials");
      await state.page.moveNow();
      expect(rotate).not.toHaveBeenCalled();
      expect(state.page.error).toBe("Restore failed: target full");
    });

    it("carries on from a copy that is ready to switch over instead of creating another login", async () => {
      withFilesLeft();
      state.page.history = [record({status: EnvironmentMigrationStatus.READY_FOR_CUTOVER}), switched];
      state.page.targetClusterChanged(spareServer);
      const provision = vi.spyOn(migrationService(), "provisionMongoTarget");
      const rotate = vi.spyOn(migrationService(), "rotateMongoCredentials").mockReturnValue(of(record({status: EnvironmentMigrationStatus.ROTATED})));
      await state.page.moveNow();
      expect(provision).not.toHaveBeenCalled();
      expect(rotate).toHaveBeenCalledWith(expect.objectContaining({migrationId: "second-move", confirmEnvironment: "hillside"}));
    });

    it("only carries on from a genuine unfinished move to the same server", () => {
      const migrations = [
        record({migrationId: "old-dry-run", status: EnvironmentMigrationStatus.VALIDATED, dryRun: true, startTime: 3000}),
        record({migrationId: "failed", status: EnvironmentMigrationStatus.FAILED, startTime: 3000}),
        record({migrationId: "before-switch", status: EnvironmentMigrationStatus.READY_FOR_CUTOVER, startTime: 500}),
        record({migrationId: "other-server", status: EnvironmentMigrationStatus.READY_FOR_CUTOVER, startTime: 3000, targetMongo: {cluster: "other.abc123", db: "hillside-database", username: "hillside-new-user", uriSummary: "other"}}),
        switched
      ];
      expect(resumableMove(migrations, EnvironmentMigrationMode.MONGO_ONLY, "spare-sites.abc123")).toBeNull();
      const genuine = record({migrationId: "genuine", status: EnvironmentMigrationStatus.RESTORING, startTime: 2500});
      expect(resumableMove([genuine, ...migrations], EnvironmentMigrationMode.MONGO_ONLY, "spare-sites.abc123")?.migrationId).toBe("genuine");
    });

    it("picks up a second move after a reload instead of showing the site as moved", () => {
      const copied = {...switched, migrationId: "second-move", status: EnvironmentMigrationStatus.READY_FOR_CUTOVER, phase: EnvironmentMigrationPhase.VERIFY_TARGET, startTime: 2000};
      state.page.history = [copied, switched];
      (state.page as any).selectRemainingMigration();
      expect(state.page.request.mode).toBe(EnvironmentMigrationMode.MONGO_ONLY);
      expect(state.page.selectedMigration.migrationId).toBe("second-move");
      expect(state.page.nextStep()).toBe(EnvironmentMigrationStepKey.SWITCH);
    });

    it("ignores unfinished attempts from before the last switch over", () => {
      const abandoned = {...switched, migrationId: "abandoned", status: EnvironmentMigrationStatus.FAILED, phase: EnvironmentMigrationPhase.VALIDATE_TARGET, startTime: 500};
      state.page.history = [switched, abandoned];
      (state.page as any).selectRemainingMigration();
      expect(state.page.selectedMigration.migrationId).toBe("first-move");
      expect(state.page.nextStepState()).toBe(EnvironmentMigrationStepState.DONE);
    });

    it("shows the second move as done once the site is switched over", async () => {
      const ready = {...switched, migrationId: "second-move", status: EnvironmentMigrationStatus.READY_FOR_CUTOVER, phase: EnvironmentMigrationPhase.VERIFY_TARGET, startTime: 2000};
      const rotatedAgain = {...ready, status: EnvironmentMigrationStatus.ROTATED, phase: EnvironmentMigrationPhase.ROTATE_CREDENTIALS};
      state.page.request.mode = EnvironmentMigrationMode.MONGO_ONLY;
      state.page.history = [switched];
      state.page.selectedMigration = ready;
      vi.spyOn(TestBed.inject(EnvironmentMigrationService), "rotateMongoCredentials").mockReturnValue(of(rotatedAgain));
      vi.mocked(state.page.loadHistory).mockImplementation(async () => {
        state.page.history = [rotatedAgain, switched];
      });
      await state.page.rotate();
      expect(state.page.selectedMigration.migrationId).toBe("second-move");
      expect(state.page.nextStepState()).toBe(EnvironmentMigrationStepState.DONE);
    });
  });
});
