import expect from "expect";
import sinon from "sinon";
import { describe, afterEach, beforeEach, it } from "mocha";
import { MongoClient } from "mongodb";
import { EnvironmentMigrationService } from "./environment-migration-service";
import { environmentMigration } from "../mongo/models/environment-migration";
import * as configController from "../mongo/controllers/config";
import * as awsSetup from "../environment-setup/aws-setup";
import * as flyMachines from "../fly/fly-machines";
import * as siteDatabaseCheck from "../environment-setup/site-database-check";
import * as ghostDatabases from "../environment-setup/atlas-ghost-databases";
import { SiteDatabaseState } from "../../../projects/ngx-ramblers/src/app/models/atlas-cluster.model";
import {
  EnvironmentMigrationAudit,
  EnvironmentMigrationAwsSummary,
  EnvironmentMigrationMode,
  EnvironmentMigrationPhase,
  EnvironmentMigrationStatus
} from "../../../projects/ngx-ramblers/src/app/models/environment-migration.model";
import { EnvironmentConfig } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { dateTimeFromIso } from "../shared/dates";

describe("environment-migration-service", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(siteDatabaseCheck, "confirmRunningSiteDatabase").resolves(SiteDatabaseState.MATCHES);
    sandbox.stub(ghostDatabases, "removeLeftoverLoginsFor").resolves([]);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("reconcileOrphanedMigrations", () => {
    it("marks active migrations from a prior server lifetime as orphaned", async () => {
      const findStub = sandbox.stub(environmentMigration, "find").resolves([
        {
          migrationId: "environment-migration-2026-06-08-17-36-11-staging",
          environment: "staging",
          mode: EnvironmentMigrationMode.MONGO_ONLY,
          status: EnvironmentMigrationStatus.RESTORING,
          phase: EnvironmentMigrationPhase.RESTORE_TARGET,
          dryRun: false,
          startTime: dateTimeFromIso("2026-06-08T16:36:11.000Z").toJSDate(),
          sourceMongo: { cluster: "old", db: "source", username: "source", uriSummary: "source@old/source" },
          targetMongo: { cluster: "new", db: "target", username: "target", uriSummary: "target@new/target" }
        }
      ] as any);
      const updateStub = sandbox.stub(environmentMigration, "updateOne").resolves({} as any);

      const service = new EnvironmentMigrationService();
      const count = await service.reconcileOrphanedMigrations();

      expect(count).toEqual(1);
      expect(findStub.calledOnce).toEqual(true);
      expect(updateStub.calledOnce).toEqual(true);
      expect(updateStub.firstCall.args[0]).toEqual({ migrationId: "environment-migration-2026-06-08-17-36-11-staging" });
      expect(updateStub.firstCall.args[1].$set.status).toEqual(EnvironmentMigrationStatus.ORPHANED);
      expect(updateStub.firstCall.args[1].$set.error).toContain("interrupted by a prior server restart");
    });
  });

  describe("live AWS copy", () => {
    it("exposes a copy-s3 phase for destination-account cutover", () => {
      expect(EnvironmentMigrationPhase.COPY_S3).toEqual("copy-s3");
    });
  });

  describe("rotateCredentials", () => {
    const auditedAws: EnvironmentMigrationAwsSummary = { bucket: "destination-bucket", region: "eu-west-2", accessKeyId: "NEWKEY" };
    const targetMongo = { cluster: "new", db: "target", username: "target", password: "target-password" };
    const previousEnvironment: EnvironmentConfig = {
      environment: "staging",
      mongo: { cluster: "old", db: "source", username: "source", password: "source-password" },
      aws: { bucket: "old-bucket", region: "eu-west-2", accessKeyId: "OLDKEY", secretAccessKey: "old-secret" }
    };

    function readyMigration(targetAws: EnvironmentMigrationAwsSummary | null): EnvironmentMigrationAudit {
      return {
        migrationId: "environment-migration-2026-09-16-10-00-00-staging",
        environment: "staging",
        mode: EnvironmentMigrationMode.MONGO_AND_S3,
        status: EnvironmentMigrationStatus.READY_FOR_CUTOVER,
        phase: EnvironmentMigrationPhase.VERIFY_TARGET,
        dryRun: false,
        startTime: dateTimeFromIso("2026-09-16T10:00:00.000Z").toJSDate(),
        sourceMongo: { cluster: "old", db: "source", username: "source", uriSummary: "source@old/source" },
        targetMongo: { cluster: "new", db: "target", username: "target", uriSummary: "target@new/target" },
        ...(targetAws ? { targetAws } : {}),
        rollbackInfo: {
          oldMongo: { cluster: "old", db: "source", username: "source", uriSummary: "source@old/source" },
          targetMongo: { cluster: "new", db: "target", username: "target", uriSummary: "target@new/target" },
          timestamp: dateTimeFromIso("2026-09-16T10:05:00.000Z").toJSDate()
        }
      };
    }

    function stubRotation(migration: EnvironmentMigrationAudit, targetMongoPassword?: string) {
      sandbox.stub(environmentMigration, "findOne").returns({
        lean: () => Promise.resolve(migration),
        select: () => ({ lean: () => Promise.resolve(targetMongoPassword ? { targetMongoPassword } : {}) })
      } as any);
      const updateOne = sandbox.stub(environmentMigration, "updateOne").resolves({} as any);
      sandbox.stub(configController, "queryKey").resolves({ value: { environments: [previousEnvironment] } } as any);
      const createOrUpdateKey = sandbox.stub(configController, "createOrUpdateKey").resolves({} as any);
      const bucketExists = sandbox.stub(awsSetup, "bucketExists").resolves(true);
      sandbox.stub(awsSetup, "adminConfigFromEnvironment").returns({
        accessKeyId: "ADMINKEY",
        secretAccessKey: "admin-secret",
        region: "eu-west-2"
      });
      const setupAwsForBucket = sandbox.stub(awsSetup, "setupAwsForBucket").resolves({
        bucket: "destination-bucket",
        region: "eu-west-2",
        iamUserName: "ngx-ramblers-staging-user",
        accessKeyId: "SITEKEY",
        secretAccessKey: "site-secret",
        policyArn: "arn:aws:iam::1:policy/ngx-ramblers-staging-policy"
      });
      sandbox.stub(awsSetup, "createS3Client").returns({
        send: sandbox.stub().resolves({})
      } as any);
      sandbox.stub(flyMachines, "setCurrentMachineSecrets").resolves({ ok: true });
      sandbox.stub(flyMachines, "restartCurrentMachine").resolves({ ok: true });
      const service = new EnvironmentMigrationService();
      sandbox.stub(service as any, "validateMongoCredentials").resolves();
      const scopedAwsCredentials = sandbox.stub(service as any, "scopedAwsCredentials").resolves({ bucket: "old-bucket", region: "eu-west-2", accessKeyId: "SCOPEDKEY", secretAccessKey: "scoped-secret" });
      return { service, updateOne, createOrUpdateKey, bucketExists, scopedAwsCredentials, setupAwsForBucket };
    }

    it("refuses to rotate a live S3 migration when the destination bucket does not match the audited one", async () => {
      const { service, createOrUpdateKey } = stubRotation(readyMigration(auditedAws));

      await expect(service.rotateCredentials({
        migrationId: "environment-migration-2026-09-16-10-00-00-staging",
        confirmEnvironment: "staging",
        targetMongo,
        targetAws: { bucket: "other-bucket", region: "eu-west-2", accessKeyId: "NEWKEY", secretAccessKey: "new-secret" }
      })).rejects.toThrow(/do not match the verified migration target/);
      expect(createOrUpdateKey.called).toEqual(false);
    });

    it("provisions a site IAM user on the destination account instead of falling back to the current account", async () => {
      const { service, createOrUpdateKey, scopedAwsCredentials, setupAwsForBucket } = stubRotation(readyMigration(auditedAws));

      await service.rotateCredentials({
        migrationId: "environment-migration-2026-09-16-10-00-00-staging",
        confirmEnvironment: "staging",
        targetMongo
      });
      expect(scopedAwsCredentials.called).toEqual(false);
      expect(setupAwsForBucket.calledOnce).toEqual(true);
      expect(setupAwsForBucket.firstCall.args[4]).toEqual({ replaceAccessKeys: false, keepAccessKeyId: "OLDKEY" });
      expect(createOrUpdateKey.called).toEqual(true);
      expect(createOrUpdateKey.firstCall.args[1].environments[0].aws.accessKeyId).toEqual("SITEKEY");
    });

    it("rotates to the matching destination account and records the previous AWS keys for rollback", async () => {
      const { service, updateOne, createOrUpdateKey, bucketExists } = stubRotation(readyMigration(auditedAws));

      const rotated = await service.rotateCredentials({
        migrationId: "environment-migration-2026-09-16-10-00-00-staging",
        confirmEnvironment: "staging",
        targetMongo,
        targetAws: { bucket: "destination-bucket", region: "eu-west-2", accessKeyId: "NEWKEY", secretAccessKey: "new-secret" }
      });

      expect(rotated.migrationId).toEqual("environment-migration-2026-09-16-10-00-00-staging");
      expect(bucketExists.calledOnce).toEqual(true);
      expect(bucketExists.firstCall.args[1]).toEqual("destination-bucket");
      const written = createOrUpdateKey.firstCall.args[1].environments[0];
      expect(written.aws).toEqual({ bucket: "destination-bucket", region: "eu-west-2", accessKeyId: "SITEKEY", secretAccessKey: "site-secret" });
      expect(written.mongo).toEqual({ cluster: "new", db: "target", username: "target", password: "target-password" });
      const rotatedSet = updateOne.lastCall.args[1].$set;
      expect(rotatedSet.status).toEqual(EnvironmentMigrationStatus.ROTATED);
      expect(rotatedSet.rollbackInfo.oldAws).toEqual({ bucket: "old-bucket", region: "eu-west-2", accessKeyId: "OLDKEY" });
      expect(rotatedSet.rollbackInfo.targetAws).toEqual({ bucket: "destination-bucket", region: "eu-west-2", accessKeyId: "SITEKEY" });
      expect(rotatedSet.rollbackInfo.oldMongo).toEqual({ cluster: "old", db: "source", username: "source", uriSummary: "source@old/source" });
    });

    it("does not mark the migration rotated when Fly secrets are not updated", async () => {
      const { service, createOrUpdateKey, updateOne } = stubRotation(readyMigration(auditedAws));
      (flyMachines.setCurrentMachineSecrets as sinon.SinonStub).onFirstCall().resolves({ ok: false, error: "Fly secrets update failed: 401" });

      await expect(service.rotateCredentials({
        migrationId: "environment-migration-2026-09-16-10-00-00-staging",
        confirmEnvironment: "staging",
        targetMongo,
        targetAws: { bucket: "destination-bucket", region: "eu-west-2", accessKeyId: "NEWKEY", secretAccessKey: "new-secret" }
      })).rejects.toThrow(/Fly secrets update failed/);
      expect(createOrUpdateKey.called).toEqual(false);
      expect(updateOne.lastCall.args[1].$set.status).toEqual(EnvironmentMigrationStatus.READY_FOR_CUTOVER);
      expect(updateOne.lastCall.args[1].$set.rollbackInfo.oldMongo.cluster).toBe("old");
    });

    it("restores the source secrets when the target restart fails without changing platform configuration", async () => {
      const {service, createOrUpdateKey, updateOne} = stubRotation(readyMigration(null));
      (flyMachines.restartCurrentMachine as sinon.SinonStub).onFirstCall().resolves({ok: false, error: "Restart failed"});
      await expect(service.rotateCredentials({migrationId: "migration", confirmEnvironment: "staging", targetMongo})).rejects.toThrow("Restart failed");
      expect(createOrUpdateKey.called).toBe(false);
      const secrets = (flyMachines.setCurrentMachineSecrets as sinon.SinonStub).secondCall.args[0];
      expect(secrets.MONGODB_URI).toContain("source:source-password@old");
      expect(secrets.AWS_ACCESS_KEY_ID).toBe("OLDKEY");
      expect(updateOne.lastCall.args[1].$set.status).toBe(EnvironmentMigrationStatus.READY_FOR_CUTOVER);
      expect(updateOne.lastCall.args[1].$set.rollbackInfo.oldMongo.cluster).toBe("old");
    });

    it("restores platform configuration if saving the cutover audit fails", async () => {
      const {service, createOrUpdateKey, updateOne} = stubRotation(readyMigration(null));
      updateOne.onCall(2).rejects(new Error("Audit failed"));
      await expect(service.rotateCredentials({migrationId: "migration", confirmEnvironment: "staging", targetMongo})).rejects.toThrow("Audit failed");
      expect(createOrUpdateKey.secondCall.args[1].environments[0]).toEqual(previousEnvironment);
      expect(updateOne.lastCall.args[1].$set.rollbackInfo.oldMongo.cluster).toBe("old");
    });

    it("restores the source configuration when a platform write reports a failure", async () => {
      const {service, createOrUpdateKey} = stubRotation(readyMigration(null));
      createOrUpdateKey.onFirstCall().rejects(new Error("Configuration acknowledgement lost"));
      await expect(service.rotateCredentials({migrationId: "migration", confirmEnvironment: "staging", targetMongo})).rejects.toThrow("acknowledgement lost");
      expect(createOrUpdateKey.secondCall.args[1].environments[0]).toEqual(previousEnvironment);
    });

    it("retries cutover after a failed secrets confirmation when the restore was verified", async () => {
      const failed = {
        ...readyMigration(null),
        status: EnvironmentMigrationStatus.FAILED,
        phase: EnvironmentMigrationPhase.ROTATE_CREDENTIALS,
        verification: {collections: ["config"], totalDocumentCount: 1, keyCollectionCounts: []},
        error: "Fly did not confirm a secrets release for cutover"
      };
      const {service, createOrUpdateKey} = stubRotation(failed);
      await service.rotateCredentials({migrationId: "migration", confirmEnvironment: "staging", targetMongo});
      expect(createOrUpdateKey.calledOnce).toBe(true);
    });

    it("switches over with the saved target login when the page no longer holds the password", async () => {
      const {service, createOrUpdateKey, updateOne} = stubRotation(readyMigration(null), "target-password");
      await service.rotateCredentials({migrationId: "migration", confirmEnvironment: "staging"});
      expect(createOrUpdateKey.firstCall.args[1].environments[0].mongo).toEqual(targetMongo);
      const rotatedUpdate = updateOne.getCalls().find(call => call.args[1].$set?.status === EnvironmentMigrationStatus.ROTATED);
      expect(rotatedUpdate.args[1].$unset).toEqual({targetMongoPassword: ""});
    });

    it("records that the restarted site confirmed it is on the new database", async () => {
      const {service, updateOne} = stubRotation(readyMigration(null), "target-password");
      await service.rotateCredentials({migrationId: "migration", confirmEnvironment: "staging"});
      const rotatedUpdate = updateOne.getCalls().find(call => call.args[1].$set?.status === EnvironmentMigrationStatus.ROTATED);
      expect(rotatedUpdate.args[1].$set.siteDatabaseConfirmed).toBe(true);
    });

    it("removes the old database logins once the restarted site confirms the new database", async () => {
      const {service} = stubRotation(readyMigration(null), "target-password");
      await service.rotateCredentials({migrationId: "migration", confirmEnvironment: "staging"});
      await new Promise(resolve => setImmediate(resolve));
      expect((ghostDatabases.removeLeftoverLoginsFor as sinon.SinonStub).calledOnceWith("staging")).toBe(true);
    });

    [SiteDatabaseState.UNKNOWN, SiteDatabaseState.ASLEEP].forEach(state => {
      it(`keeps the old database logins when the restarted site reports ${state}`, async () => {
        const {service, updateOne} = stubRotation(readyMigration(null), "target-password");
        (siteDatabaseCheck.confirmRunningSiteDatabase as sinon.SinonStub).resolves(state);
        await service.rotateCredentials({migrationId: "migration", confirmEnvironment: "staging"});
        await new Promise(resolve => setImmediate(resolve));
        const rotatedUpdate = updateOne.getCalls().find(call => call.args[1].$set?.status === EnvironmentMigrationStatus.ROTATED);
        expect(rotatedUpdate.args[1].$set.siteDatabaseConfirmed).toBe(false);
        expect((ghostDatabases.removeLeftoverLoginsFor as sinon.SinonStub).called).toBe(false);
      });
    });

    it("undoes the move when the restarted site is still on its old database", async () => {
      const {service, createOrUpdateKey, updateOne} = stubRotation(readyMigration(null), "target-password");
      (siteDatabaseCheck.confirmRunningSiteDatabase as sinon.SinonStub).resolves(SiteDatabaseState.DIFFERS);
      await expect(service.rotateCredentials({migrationId: "migration", confirmEnvironment: "staging"})).rejects.toThrow("still connected to its old database");
      expect(createOrUpdateKey.called).toBe(false);
      expect((flyMachines.setCurrentMachineSecrets as sinon.SinonStub).callCount).toBe(2);
      expect(updateOne.lastCall.args[1].$set.status).toBe(EnvironmentMigrationStatus.READY_FOR_CUTOVER);
    });

    it("explains when no target login was saved and the page no longer holds the password", async () => {
      const {service, createOrUpdateKey} = stubRotation(readyMigration(null));
      await expect(service.rotateCredentials({migrationId: "migration", confirmEnvironment: "staging"})).rejects.toThrow("was not saved");
      expect(createOrUpdateKey.called).toBe(false);
    });

    it("records an incomplete rollback as failed and retains the original rollback identity", async () => {
      const {service, updateOne} = stubRotation(readyMigration(null));
      (flyMachines.setCurrentMachineSecrets as sinon.SinonStub).resolves({ok: false, error: "Secrets unavailable"});
      await expect(service.rotateCredentials({migrationId: "migration", confirmEnvironment: "staging", targetMongo})).rejects.toThrow("could not be fully restored");
      expect(updateOne.lastCall.args[1].$set.status).toBe(EnvironmentMigrationStatus.FAILED);
      expect(updateOne.lastCall.args[1].$set.rollbackInfo.oldMongo.cluster).toBe("old");
    });

    it("rotates AWS only for an S3-only migration and leaves Mongo credentials unchanged", async () => {
      const s3Only = {
        ...readyMigration(auditedAws),
        mode: EnvironmentMigrationMode.S3_ONLY,
        sourceMongo: undefined,
        targetMongo: undefined
      };
      const { service, createOrUpdateKey, bucketExists } = stubRotation(s3Only);

      await service.rotateCredentials({
        migrationId: "environment-migration-2026-09-16-10-00-00-staging",
        confirmEnvironment: "staging",
        rotateS3Credentials: true,
        targetAws: { bucket: "destination-bucket", region: "eu-west-2", accessKeyId: "NEWKEY", secretAccessKey: "new-secret" }
      });

      expect(bucketExists.calledOnce).toEqual(true);
      const written = createOrUpdateKey.firstCall.args[1].environments[0];
      expect(written.aws).toEqual({ bucket: "destination-bucket", region: "eu-west-2", accessKeyId: "SITEKEY", secretAccessKey: "site-secret" });
      expect(written.mongo).toEqual(previousEnvironment.mongo);
      const secrets = (flyMachines.setCurrentMachineSecrets as sinon.SinonStub).firstCall.args[0];
      expect(secrets.AWS_BUCKET).toEqual("destination-bucket");
      expect(secrets.MONGODB_URI).toBeUndefined();
    });

    it("keeps bucket-scoped rotation for a snapshot migration that has no destination account", async () => {
      const { service, createOrUpdateKey, scopedAwsCredentials, bucketExists } = stubRotation(readyMigration(null));

      await service.rotateCredentials({
        migrationId: "environment-migration-2026-09-16-10-00-00-staging",
        confirmEnvironment: "staging",
        targetMongo
      });

      expect(scopedAwsCredentials.calledOnce).toEqual(true);
      expect(bucketExists.called).toEqual(false);
      expect(createOrUpdateKey.firstCall.args[1].environments[0].aws.accessKeyId).toEqual("SCOPEDKEY");
    });
  });

  describe("validateMongoCredentials", () => {
    it("waits for Atlas to activate the user with the same login waiter as registration", async () => {
      sandbox.stub(environmentMigration, "updateOne").resolves({} as any);
      const waitConnect = sandbox.stub(MongoClient, "connect").resolves({
        db: () => ({command: sandbox.stub().resolves({ok: 1})}),
        close: sandbox.stub().resolves()
      } as any);
      sandbox.stub(MongoClient.prototype, "connect").resolves();
      sandbox.stub(MongoClient.prototype, "db").returns({
        command: sandbox.stub().resolves({ok: 1}),
        listCollections: () => ({toArray: sandbox.stub().resolves([])}),
        collection: () => ({insertOne: sandbox.stub().resolves(), drop: sandbox.stub().resolves()})
      } as any);
      sandbox.stub(MongoClient.prototype, "close").resolves();

      const service = new EnvironmentMigrationService();
      await (service as any).validateMongoCredentials({
        cluster: "hillside.mongodb.net",
        db: "ngx-ramblers-hillside",
        username: "ngx_hillside_migration_user",
        password: "secret"
      }, true, "environment-migration-1");

      expect(waitConnect.calledOnce).toEqual(true);
      expect(String(waitConnect.firstCall.args[0])).toContain("ngx_hillside_migration_user");
      expect(String(waitConnect.firstCall.args[0])).toContain("hillside.mongodb.net");
    });
  });
});
