import debug from "debug";
import { pluraliseWithCount } from "../shared/string-utils";
import { ChildProcess, spawn } from "child_process";
import * as fs from "fs/promises";
import { createWriteStream } from "fs";
import * as path from "path";
import mongoose from "mongoose";
import { envConfig } from "../env-config/env-config";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client
} from "@aws-sdk/client-s3";
import { uploadDirectoryToS3 } from "../aws/s3-utils";
import { dateTimeNow } from "../shared/dates";
import { backupSession, BackupSession } from "../mongo/models/backup-session";
import { BackupNotificationService } from "./backup-notification-service";
import {
  ACTIVE_BACKUP_SESSION_STATUSES,
  BackupConfig,
  BackupListItem,
  BackupLocation,
  BackupSessionStatus,
  BackupSessionTrigger,
  BackupSessionType,
  EnvironmentBackupConfig
} from "../../../projects/ngx-ramblers/src/app/models/backup-session.model";
import {
  RamblersWalksManagerDateFormat as DateFormat
} from "../../../projects/ngx-ramblers/src/app/models/date-format.model";
import { environmentConfigFor } from "./backup-config";
import type { EnvironmentConfig } from "../../deploy/deploy.model";
import { NamedError } from "../../../projects/ngx-ramblers/src/app/models/api-response.model";
import { AWS_DEFAULTS, AwsConfig, FLYIO_DEFAULTS } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { backupListAwsTargets } from "../environment-setup/backup-archive";
import { buildMongoUri } from "../shared/mongodb-uri";
import { isUndefined } from "es-toolkit/compat";
import {
  buildS3KeyForBackup,
  buildS3LocationUrl,
  extractSourceEnvironmentFromBackupName,
  extractTimestampFromBackupName,
  parseS3BackupPrefix,
  parseTimestampToDate
} from "./backup-paths";
import { availableSites, completedManifestStatusByTimestamp, externaliseEmbeddedManifestEntries, isBackupAbortedError, manifestByTimestamp, startS3Backup, startS3Restore } from "./s3-backup-service";
import { backupEvents } from "./backup-events";
import { withBackupSlot } from "./backup-concurrency";
import { stripTrailingSlash } from "../../../projects/ngx-ramblers/src/app/functions/strings";

const debugLog = debug(envConfig.logNamespace("backup-and-restore-service"));
debugLog.enabled = true;

const SERVER_START_TIME = dateTimeNow().toJSDate();
const sessionLogLimit = 200;

export interface BackupOptions {
  environment: string;
  database?: string;
  collections?: string[];
  scaleDown?: boolean;
  upload?: boolean;
  includeS3?: boolean;
  s3ObjectBackupConcurrency?: number;
  user?: string;
  triggeredBy?: BackupSessionTrigger;
  executeLocally?: boolean;
}

export interface RestoreOptions {
  environment: string;
  from: string;
  database?: string;
  collections?: string[];
  drop?: boolean;
  dryRun?: boolean;
  includeS3?: boolean;
  user?: string;
  executeLocally?: boolean;
}

export class BackupAndRestoreService {
  private configs: EnvironmentConfig[];
  private dumpBaseDir: string;
  private notificationService?: BackupNotificationService;
  private backupConfig: BackupConfig;

  constructor(configs: EnvironmentConfig[], backupConfig: BackupConfig, dumpBaseDir?: string, notificationService?: BackupNotificationService) {
    this.configs = configs;
    this.backupConfig = backupConfig;
    this.dumpBaseDir = dumpBaseDir || path.join(process.cwd(), "../non-vcs/dump");
    this.notificationService = notificationService;
  }

  private preferredBucket(envBackupConfig?: EnvironmentBackupConfig): string | undefined {
    return this.backupConfig.aws?.bucket || envBackupConfig?.aws?.bucket;
  }

  private preferredRegion(envBackupConfig?: EnvironmentBackupConfig): string {
    return this.backupConfig.aws?.region || envBackupConfig?.aws?.region || AWS_DEFAULTS.REGION;
  }

  private preferredCredentials(envBackupConfig?: EnvironmentBackupConfig): { accessKeyId: string; secretAccessKey: string } | undefined {
    if (this.backupConfig.aws?.accessKeyId && this.backupConfig.aws?.secretAccessKey) {
      return {
        accessKeyId: this.backupConfig.aws.accessKeyId,
        secretAccessKey: this.backupConfig.aws.secretAccessKey
      };
    } else if (envBackupConfig?.aws?.accessKeyId && envBackupConfig?.aws?.secretAccessKey) {
      return {
        accessKeyId: envBackupConfig.aws.accessKeyId,
        secretAccessKey: envBackupConfig.aws.secretAccessKey
      };
    } else {
      return undefined;
    }
  }

  private findEnvironmentConfig(environmentName: string): EnvironmentConfig | null {
    const flyConfig = this.configs.find(c => c.name === environmentName);
    const backupEnv = this.backupConfig.environments?.find(e => e.environment === environmentName);

    if (backupEnv && (backupEnv.mongo?.cluster || backupEnv.mongo?.db)) {
      return {
        name: environmentName,
        appName: backupEnv.flyio?.appName || flyConfig?.appName || environmentName,
        apiKey: backupEnv.flyio?.apiKey || flyConfig?.apiKey || "",
        memory: backupEnv.flyio?.memory || flyConfig?.memory || FLYIO_DEFAULTS.MEMORY,
        scaleCount: backupEnv.flyio?.scaleCount || flyConfig?.scaleCount || FLYIO_DEFAULTS.SCALE_COUNT,
        organisation: backupEnv.flyio?.organisation || flyConfig?.organisation || "",
        mongo: backupEnv.mongo ? {
          cluster: backupEnv.mongo.cluster || "",
          db: backupEnv.mongo.db || "",
          username: backupEnv.mongo.username || "",
          password: backupEnv.mongo.password || ""
        } : flyConfig?.mongo
      };
    }

    return flyConfig || null;
  }

  private buildMongoUriForConfig(cluster: string, username: string, password: string, database: string): string {
    const baseUri = buildMongoUri({ cluster, username, password, database });
    return `${baseUri}&socketTimeoutMS=300000&connectTimeoutMS=30000&serverSelectionTimeoutMS=30000&compressors=zlib`;
  }

  async startBackup(options: BackupOptions): Promise<BackupSession> {
    const config = this.findEnvironmentConfig(options.environment);
    if (!config) {
      throw new Error(`Environment "${options.environment}" not found`);
    }

    if (!config.mongo) {
      throw new Error(`Environment "${options.environment}" has no mongo config`);
    }

    const activeBackup = await backupSession.findOne({
      type: BackupSessionType.BACKUP,
      environment: options.environment,
      status: { $in: ACTIVE_BACKUP_SESSION_STATUSES },
      startTime: { $gte: SERVER_START_TIME }
    }).select({ status: 1 }).lean() as Pick<BackupSession, "status"> | null;
    if (activeBackup) {
      throw new Error(`A backup for ${options.environment} is already ${activeBackup.status === BackupSessionStatus.PENDING ? "queued" : "running"}`);
    }

    const envBackupConfig = environmentConfigFor(this.backupConfig, options.environment);
    const dbName = options.database || config.mongo.db;
    const timestampStr = dateTimeNow().toFormat(DateFormat.FILE_TIMESTAMP);
    const backupName = `${timestampStr}-${config.name}-${dbName}`;
    const sessionId = `backup-${backupName}`;

    const session: BackupSession = {
      sessionId,
      type: BackupSessionType.BACKUP,
      environment: options.environment,
      database: dbName,
      collections: options.collections,
      status: BackupSessionStatus.PENDING,
      startTime: dateTimeNow().toJSDate(),
      options: {
        scaleDown: options.scaleDown,
        upload: options.upload,
        s3Bucket: options.upload ? this.preferredBucket(envBackupConfig) : undefined,
        s3Region: options.upload ? this.preferredRegion(envBackupConfig) : undefined,
        s3Prefix: "backups",
        includeS3: options.includeS3 !== false
      },
      logs: [],
      metadata: {
        user: options.user,
        triggeredBy: options.triggeredBy ?? BackupSessionTrigger.WEB
      }
    };

    const savedSession = await backupSession.create(session);
    backupEvents.emit("session-updated", { session: savedSession.toObject() as BackupSession });

    if (this.notificationService) {
      await this.notificationService.notifyBackupStarted(savedSession);
    }

    if (options.executeLocally !== false) {
      withBackupSlot(`backup ${options.environment}`, () =>
        this.executeBackup(savedSession._id!.toString(), config, options, backupName, envBackupConfig)
      ).catch(err => {
        this.updateSessionError(savedSession._id!.toString(), err.message);
      });
    }

    return savedSession;
  }

  async executeQueuedBackup(mongoId: string, options: BackupOptions): Promise<void> {
    const config = this.findEnvironmentConfig(options.environment);
    if (!config || !config.mongo) {
      throw new Error(`Environment "${options.environment}" is not configured for backup`);
    } else {
      const savedSession = await backupSession.findById(mongoId);
      if (!savedSession) {
        throw new Error(`Backup session ${mongoId} was not found`);
      } else if (savedSession.type !== BackupSessionType.BACKUP || savedSession.environment !== options.environment) {
        throw new Error(`Backup session ${mongoId} does not match environment "${options.environment}"`);
      } else if (savedSession.status === BackupSessionStatus.PENDING) {
        const envBackupConfig = environmentConfigFor(this.backupConfig, options.environment);
        const backupName = savedSession.sessionId.replace(/^backup-/, "");
        await withBackupSlot(`backup ${options.environment}`, () =>
          this.executeBackup(mongoId, config, options, backupName, envBackupConfig)
        );
      }
    }
  }

  async executeQueuedRestore(mongoId: string, options: RestoreOptions): Promise<void> {
    const config = this.findEnvironmentConfig(options.environment);
    const savedSession = config?.mongo ? await backupSession.findById(mongoId) : null;
    if (!config?.mongo) {
      throw new Error(`Environment "${options.environment}" is not configured for restore`);
    } else if (!savedSession) {
      throw new Error(`Restore session ${mongoId} was not found`);
    } else if (savedSession.type !== BackupSessionType.RESTORE || savedSession.environment !== options.environment) {
      throw new Error(`Restore session ${mongoId} does not match environment "${options.environment}"`);
    } else if (savedSession.status === BackupSessionStatus.PENDING) {
      await this.executeRestore(mongoId, config, options);
    }
  }

  async startRestore(options: RestoreOptions): Promise<BackupSession> {
    const config = this.findEnvironmentConfig(options.environment);
    if (!config) {
      throw new Error(`Environment "${options.environment}" not found`);
    }

    if (!config.mongo) {
      throw new Error(`Environment "${options.environment}" has no mongo config`);
    }

    const isS3 = options.from?.startsWith("s3://") || options.from?.startsWith("s3:/");
    if (isS3) {
      if (options.from.startsWith("s3:/") && !options.from.startsWith("s3://")) {
        options.from = options.from.replace(/^s3:\/\//, "s3://").replace(/^s3:\//, "s3://");
      }
    } else {
      const fromPath = path.join(this.dumpBaseDir, options.from);
      try {
        await fs.access(fromPath);
      } catch {
        throw new Error(`Dump directory not found: ${fromPath}`);
      }
    }

    const dbName = options.database || config.mongo.db;
    const sessionId = `restore-${dateTimeNow().toFormat(DateFormat.FILE_TIMESTAMP)}`;

    const session: BackupSession = {
      sessionId,
      type: BackupSessionType.RESTORE,
      environment: options.environment,
      database: dbName,
      collections: options.collections,
      status: BackupSessionStatus.PENDING,
      startTime: dateTimeNow().toJSDate(),
      options: {
        from: options.from,
        drop: options.drop !== false,
        dryRun: options.dryRun,
        includeS3: options.includeS3 !== false
      },
      logs: [],
      metadata: {
        user: options.user,
        triggeredBy: BackupSessionTrigger.WEB
      }
    };

    const savedSession = await backupSession.create(session);
    backupEvents.emit("session-updated", { session: savedSession.toObject() as BackupSession });

    if (this.notificationService) {
      await this.notificationService.notifyRestoreStarted(savedSession);
    }

    if (!options.dryRun && options.executeLocally !== false) {
      this.executeRestore(savedSession._id!.toString(), config, options).catch(err => {
        this.updateSessionError(savedSession._id!.toString(), err.message);
      });
    } else if (!options.dryRun) {
      debugLog("startRestore: %s left for the integration worker", savedSession.sessionId);
    } else {
      await this.updateSession(savedSession._id!.toString(), {
        status: BackupSessionStatus.COMPLETED,
        endTime: dateTimeNow().toJSDate(),
        logs: ["DRY RUN - No changes made"]
      });
    }

    return savedSession;
  }

  private async executeBackup(
    sessionId: string,
    config: EnvironmentConfig,
    options: BackupOptions,
    backupName: string,
    envBackupConfig?: ReturnType<typeof environmentConfigFor>
  ): Promise<void> {
    if (await this.beginSession(sessionId)) {
      await this.runBackup(sessionId, config, options, backupName, envBackupConfig);
    } else {
      debugLog(`Backup session ${sessionId} for ${options.environment} is no longer pending, so it was not started`);
    }
  }

  private async runBackup(
    sessionId: string,
    config: EnvironmentConfig,
    options: BackupOptions,
    backupName: string,
    envBackupConfig?: ReturnType<typeof environmentConfigFor>
  ): Promise<void> {
    let originalScaleCount: number | undefined;
    const dbName = options.database || config.mongo!.db;
    const outDir = path.join(this.dumpBaseDir, "backups", backupName);
    try {
      await fs.mkdir(outDir, { recursive: true });
      if (dbName === mongoose.connection.name) {
        await this.externaliseS3ManifestEntriesBeforeDump(sessionId);
      }

      const mongoUri = this.buildMongoUriForConfig(config.mongo!.cluster, config.mongo!.username, config.mongo!.password, dbName);

      const dumpArgs = [
        "--uri", mongoUri,
        "--gzip",
        "--numParallelCollections=1",
        "--out", outDir
      ];

      if (options.collections && options.collections.length > 0) {
        for (const collection of options.collections) {
          dumpArgs.push("--collection", collection.trim());
        }
      }

      if (options.scaleDown) {
        originalScaleCount = config.scaleCount;
        await this.scaleApp(config, 0);
        await this.addLog(sessionId, `Scaled down ${config.name}`);
      }

      await this.addLog(sessionId, `Starting mongodump to ${outDir}`);
      await this.execCommand("mongodump", dumpArgs, sessionId);

      await this.updateSession(sessionId, { backupPath: `backups/${backupName}` });
      await this.addLog(sessionId, `Backup completed: ${outDir}`);

      if (options.upload) {
        const bucket = this.preferredBucket(envBackupConfig);
        if (!bucket) {
          throw new Error(`No S3 bucket configured. Set a global backup bucket in Settings, or configure AWS settings for environment ${options.environment}.`);
        }

        const region = this.preferredRegion(envBackupConfig);
        const credentials = this.preferredCredentials(envBackupConfig);

        if (!credentials) {
          throw new Error(`No AWS credentials configured. Set global AWS credentials in Settings, or configure AWS settings for environment ${options.environment}.`);
        }

        const s3Key = buildS3KeyForBackup(options.environment, backupName);
        const s3Location = buildS3LocationUrl(bucket, s3Key);

        const client = new S3Client({
          region,
          credentials,
          followRegionRedirects: true
        });

        await this.ensureBucket(client, bucket, region);
        await this.addLog(sessionId, `Starting S3 upload to ${bucket} (region: ${region})`);
        debugLog(`Starting S3 upload to ${bucket} (region: ${region})`);
        await uploadDirectoryToS3(client, outDir, bucket, s3Key, (bucketName, key) => {
          const message = `Uploaded: s3://${bucketName}/${key}`;
          debugLog(message);
          return this.addLog(sessionId, message);
        });
        await this.updateSession(sessionId, { s3Location });
        await this.addLog(sessionId, `Uploaded to ${s3Location}`);
        debugLog(`Uploaded to ${s3Location}`);
      }

      if (options.includeS3 !== false) {
        const mongoTimestamp = extractTimestampFromBackupName(backupName);
        const configuredSites = await availableSites().catch(() => [] as string[]);
        if (configuredSites.includes(options.environment)) {
          await this.addLog(sessionId, `Starting S3 object backup for site ${options.environment} aligned with timestamp ${mongoTimestamp}`);
          try {
            const s3Results = await startS3Backup(
              { site: options.environment, mongoTimestamp, concurrency: options.s3ObjectBackupConcurrency },
              (msg) => this.addLog(sessionId, msg),
              async () => {
                const current = await this.sessionStatus(sessionId);
                return current?.status === BackupSessionStatus.ABORTED;
              }
            );
            await this.updateSession(sessionId, { s3Backups: s3Results });
            const summary = s3Results.map(result => {
              const base = `${result.site}: ${result.copiedObjects} copied, ${result.skippedObjects} skipped, ${this.formatBytes(result.copiedSizeBytes)} (${result.status})`;
              return result.error ? `${base}, error: ${result.error}` : base;
            }).join("; ");
            await this.addLog(sessionId, `S3 object backup completed: ${summary}`);
          } catch (error: any) {
            if (isBackupAbortedError(error)) {
              await this.addLog(sessionId, `S3 object backup stopped: ${error.message}. Objects already copied stay in the archive and the next backup will skip them.`);
            } else {
              await this.addLog(sessionId, `S3 object backup failed: ${error.message} (Mongo backup is still valid)`);
            }
          }
        } else {
          await this.addLog(sessionId, `No S3 source bucket configured for site ${options.environment}, skipping S3 object backup`);
        }
      }

      const latest = await this.session(sessionId);
      if (latest?.status === BackupSessionStatus.ABORTED) {
        await this.addLog(sessionId, "Backup stopped. The Mongo dump and any objects already copied remain usable.");
      } else {
        await this.updateSession(sessionId, { status: BackupSessionStatus.COMPLETED, endTime: dateTimeNow().toJSDate() });
        if (this.notificationService) {
          const completedSession = await this.session(sessionId);
          if (completedSession) {
            await this.notificationService.notifyBackupCompleted(completedSession);
          }
        }
      }
    } catch (error: any) {
      await this.addLog(sessionId, `Error during backup: ${error.message}`);
      await this.updateSessionError(sessionId, error.message);
      throw error;
    } finally {
      if (options.upload) {
        await this.removeLocalDump(outDir, sessionId);
      }
      if (options.scaleDown && !isUndefined(originalScaleCount)) {
        try {
          await this.scaleApp(config, originalScaleCount);
          await this.addLog(sessionId, `Restored scale count for ${config.name}`);
        } catch (scaleError: any) {
          await this.addLog(sessionId, `Warning: Failed to restore scale count: ${scaleError.message}`);
        }
      }
    }
  }

  private async removeLocalDump(outDir: string, sessionId: string): Promise<void> {
    try {
      await fs.rm(outDir, { recursive: true, force: true });
      await this.addLog(sessionId, `Removed local dump after upload: ${outDir}`);
    } catch (error: any) {
      await this.addLog(sessionId, `Warning: failed to remove local dump ${outDir}: ${error.message}`);
    }
  }

  private async externaliseS3ManifestEntriesBeforeDump(sessionId: string): Promise<void> {
    try {
      await this.addLog(sessionId, "Checking S3 backup manifests before Mongo dump");
      const result = await externaliseEmbeddedManifestEntries("", 0, (message) => this.addLog(sessionId, message));
      if (result.externalised > 0) {
        await this.addLog(sessionId, `Optimised ${pluraliseWithCount(result.externalised, "embedded S3 manifest")} before Mongo dump`);
      } else if (result.failed === 0) {
        await this.addLog(sessionId, "S3 backup manifests already optimised");
      }
      if (result.failed > 0) {
        await this.addLog(sessionId, `Warning: ${pluraliseWithCount(result.failed, "S3 manifest")} could not be optimised before Mongo dump`);
      }
    } catch (error: any) {
      await this.addLog(sessionId, `Warning: S3 manifest optimisation skipped before Mongo dump: ${error.message}`);
    }
  }

  private async ensureBucket(s3: S3Client, bucket: string, region: string): Promise<void> {
    const bucketExists = await this.bucketExists(s3, bucket);
    if (bucketExists) {
      return;
    }
    try {
      const input: any = { Bucket: bucket };
      if (region && region !== "us-east-1") {
        input.CreateBucketConfiguration = { LocationConstraint: region };
      }
      await s3.send(new CreateBucketCommand(input));
    } catch (e: any) {
      const code = e?.Code || e?.name;
      if (code === "BucketAlreadyOwnedByYou" || code === "BucketAlreadyExists") {
        return;
      }
      throw new Error(`Failed to ensure bucket ${bucket} exists: ${code || e?.message || "Unknown error"}`);
    }
  }

  private async bucketExists(s3: S3Client, bucket: string): Promise<boolean> {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
      return true;
    } catch (e: any) {
      const code = e?.Code || e?.name || e?.$metadata?.httpStatusCode;
      if (code === "NotFound" || code === 404) {
        return false;
      }
      return true;
    }
  }

  private async executeRestore(
    sessionId: string,
    config: EnvironmentConfig,
    options: RestoreOptions
  ): Promise<void> {
    try {
      const selectedArchive = options.from.startsWith("s3://") ? this.archiveBackupAt(options.from) : null;
      if (selectedArchive) {
        const {bucket, prefix: s3Prefix, client} = selectedArchive;
        const archivePath = path.join("database-backups", bucket, s3Prefix);
        const destDir = path.join(this.dumpBaseDir, archivePath);
        await this.addLog(sessionId, `Downloading backup from s3://${bucket}/${s3Prefix} to ${destDir}`);
        const downloaded = await this.downloadS3Prefix(client, bucket, s3Prefix, destDir, sessionId);
        if (downloaded === 0) {
          throw new Error(`No objects found at s3://${bucket}/${s3Prefix}`);
        }
        options = { ...options, from: archivePath };
      }
      if (!(await this.beginSession(sessionId))) {
        throw new Error("Restore is no longer pending, so it was not started");
      }

      const fromPath = path.join(this.dumpBaseDir, options.from);
      const dbName = options.database || config.mongo!.db;

      async function containsBsonFiles(dir: string): Promise<boolean> {
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const e of entries) {
            if (e.isFile() && (e.name.endsWith(".bson") || e.name.endsWith(".bson.gz"))) return true;
          }
          return false;
        } catch {
          return false;
        }
      }

      let restoreDir = fromPath;
      if (!(await containsBsonFiles(restoreDir))) {
        try {
          const children = await fs.readdir(fromPath, { withFileTypes: true });
          const dbDir = children.find(d => d.isDirectory() && d.name === dbName)?.name
            || children.find(d => d.isDirectory())?.name;
          if (dbDir) {
            const candidate = path.join(fromPath, dbDir);
            if (await containsBsonFiles(candidate)) {
              restoreDir = candidate;
            }
          }
        } catch {
        }
      }

      const mongoUri = this.buildMongoUriForConfig(config.mongo!.cluster, config.mongo!.username, config.mongo!.password, dbName);

      const restoreArgs = [
        "--uri", mongoUri,
        "--gzip",
        "--verbose"
      ];

      if (options.drop !== false) {
        restoreArgs.push("--drop");
      }

      if (options.collections && options.collections.length > 0) {
        const partialRoot = path.join(this.dumpBaseDir, "partial", sessionId, dbName);
        await fs.mkdir(partialRoot, { recursive: true });

        const tryCopy = async (src: string, dest: string) => {
          try {
            await fs.copyFile(src, dest);
            return true;
          } catch {
            return false;
          }
        };

        for (const collection of options.collections) {
          const name = collection.trim();
          if (!name) continue;
          const patterns = [
            { src: path.join(restoreDir, `${name}.bson.gz`), dest: path.join(partialRoot, `${name}.bson.gz`) },
            { src: path.join(restoreDir, `${name}.bson`), dest: path.join(partialRoot, `${name}.bson`) }
          ];
          const metaPatterns = [
            { src: path.join(restoreDir, `${name}.metadata.json.gz`), dest: path.join(partialRoot, `${name}.metadata.json.gz`) },
            { src: path.join(restoreDir, `${name}.metadata.json`), dest: path.join(partialRoot, `${name}.metadata.json`) }
          ];

          for (const p of patterns) {
            const copied = await tryCopy(p.src, p.dest);
            if (copied) break;
          }
          for (const p of metaPatterns) {
            const copied = await tryCopy(p.src, p.dest);
            if (copied) break;
          }
          restoreArgs.push("--nsInclude", `${dbName}.${name}`);
        }
        restoreDir = partialRoot;
      }
      restoreArgs.push("--dir", restoreDir);

      await this.addLog(sessionId, `Starting mongorestore from ${restoreDir}`);
      await this.execCommandWithRetry("mongorestore", restoreArgs, sessionId, 3);
      await this.addLog(sessionId, `Restore completed to ${options.environment}`);

      if (options.includeS3 !== false) {
        const baseName = path.basename(options.from);
        const timestamp = extractTimestampFromBackupName(baseName);
        const sourceSite = selectedArchive?.environment || extractSourceEnvironmentFromBackupName(baseName, dbName) || options.environment;
        const targetSite = options.environment;
        const crossEnvironment = sourceSite !== targetSite;
        const matchingManifest = await manifestByTimestamp(sourceSite, timestamp, selectedArchive?.bucket).catch(() => null);
        if (matchingManifest) {
          const crossEnvNote = crossEnvironment ? ` (cross-environment: ${sourceSite} -> ${targetSite})` : "";
          await this.addLog(sessionId, `Starting S3 object restore for site ${targetSite} at timestamp ${timestamp}${crossEnvNote}`);
          try {
            const s3Results = await startS3Restore(
              {
                site: sourceSite,
                targetSite: crossEnvironment ? targetSite : undefined,
                backupBucket: selectedArchive?.bucket,
                timestamp
              },
              (msg) => this.addLog(sessionId, msg)
            );
            await this.updateSession(sessionId, { s3Restores: s3Results });
            const summary = s3Results.map(result => `${result.site}: ${result.copiedObjects} restored, ${result.skippedObjects} skipped, ${this.formatBytes(result.copiedSizeBytes)} (${result.status})`).join("; ");
            await this.addLog(sessionId, `S3 object restore completed: ${summary}`);
          } catch (error: any) {
            await this.addLog(sessionId, `S3 object restore failed: ${error.message} (Mongo restore is still valid)`);
          }
        } else {
          await this.addLog(sessionId, `No S3 manifest found for site ${sourceSite} at timestamp ${timestamp}, skipping S3 object restore`);
        }
      }

      await this.updateSession(sessionId, { status: BackupSessionStatus.COMPLETED, endTime: dateTimeNow().toJSDate() });

      if (this.notificationService) {
        const completedSession = await this.session(sessionId);
        if (completedSession) {
          await this.notificationService.notifyRestoreCompleted(completedSession);
        }
      }
    } catch (error: any) {
      await this.addLog(sessionId, `Error during restore: ${error.message}`);
      await this.updateSessionError(sessionId, error.message);
      throw error;
    }
  }

  private async addLogs(sessionId: string, messages: string[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }
    messages.forEach(message => debugLog(message));
    await backupSession.updateOne(
      { _id: sessionId },
      { $push: { logs: { $each: messages, $slice: -sessionLogLimit } }, $currentDate: { updatedAt: true } }
    );
    await this.emitSessionUpdated(sessionId);
  }

  private async emitSessionUpdated(sessionId: string): Promise<void> {
    if (backupEvents.listenerCount("session-updated") > 0) {
      try {
        const fresh = await backupSession.findById(sessionId).select({ logs: { $slice: -sessionLogLimit } }).lean() as BackupSession | null;
        if (fresh) {
          backupEvents.emit("session-updated", { session: fresh });
        }
      } catch (error) {
        debugLog(`emitSessionUpdated failed for ${sessionId}:`, error);
      }
    }
  }

  private async execCommand(cmd: string, args: string[], sessionId: string): Promise<void> {
    const redactedArgs = args.map((arg, i) => i > 0 && args[i - 1] === "--uri" ? "[REDACTED-URI]" : arg);
    await this.addLog(sessionId, `Executing: ${cmd} ${redactedArgs.join(" ")}`);
    return new Promise((resolve, reject) => {
      const proc: ChildProcess = spawn(cmd, args);

      const pending: string[] = [];
      let stdoutBuffer = "";
      let stderrBuffer = "";
      let flushTimer: NodeJS.Timeout | null = null;
      let closed = false;

      const scheduleFlush = () => {
        if (flushTimer || closed) {
          return;
        }
        flushTimer = setTimeout(() => {
          flushTimer = null;
          const drained = pending.splice(0, pending.length);
          this.addLogs(sessionId, drained).catch(error => {
            debugLog(`addLogs failed for session ${sessionId}:`, error);
          });
        }, 500);
      };

      const sessionTag = sessionId.slice(-6);
      const appendLine = (line: string) => {
        if (!line.trim()) {
          return;
        }
        debugLog(`[${cmd}:${sessionTag}] ${line}`);
        pending.push(line);
        scheduleFlush();
      };

      const consume = (buffer: string, chunk: Buffer): string => {
        const combined = buffer + chunk.toString();
        const lines = combined.split(/\r?\n/);
        const remainder = lines.pop() || "";
        lines.forEach(appendLine);
        return remainder;
      };

      if (proc.stdout) {
        proc.stdout.on("data", data => {
          stdoutBuffer = consume(stdoutBuffer, data);
        });
      }

      if (proc.stderr) {
        proc.stderr.on("data", data => {
          stderrBuffer = consume(stderrBuffer, data);
        });
      }

      proc.on("close", async (code: number) => {
        closed = true;
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        if (stdoutBuffer.trim()) {
          pending.push(stdoutBuffer);
        }
        if (stderrBuffer.trim()) {
          pending.push(stderrBuffer);
        }
        if (pending.length > 0) {
          try {
            await this.addLogs(sessionId, pending.splice(0, pending.length));
          } catch (error) {
            debugLog(`final addLogs failed for session ${sessionId}:`, error);
          }
        }
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${cmd} exited with code ${code}`));
        }
      });

      proc.on("error", error => {
        reject(error);
      });
    });
  }

  private async execCommandWithRetry(cmd: string, args: string[], sessionId: string, maxAttempts: number): Promise<void> {
    const attempt = async (remaining: number, lastError?: Error): Promise<void> => {
      if (remaining <= 0) {
        throw lastError || new Error(`${cmd} failed after ${maxAttempts} attempts`);
      }
      try {
        await this.execCommand(cmd, args, sessionId);
      } catch (error: any) {
        if (remaining > 1) {
          const attemptNumber = maxAttempts - remaining + 1;
          await this.addLog(sessionId, `Attempt ${attemptNumber} failed: ${error.message}. Retrying in 5 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          return attempt(remaining - 1, error);
        }
        throw error;
      }
    };
    return attempt(maxAttempts);
  }

  private async downloadS3Prefix(
    s3: S3Client,
    bucket: string,
    prefix: string,
    destDir: string,
    sessionId: string
  ): Promise<number> {
    await fs.mkdir(destDir, { recursive: true });
    const downloadPage = async (token: string | undefined, count: number): Promise<number> => {
      const resp = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
      const contents = resp.Contents || [];
      let pageCount = count;
      for (const obj of contents) {
        const key = obj.Key!;
        if (key.endsWith("/")) continue;
        const relative = key.startsWith(prefix) ? key.slice(prefix.length).replace(/^\//, "") : key;
        const targetPath = path.join(destDir, relative);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        const get = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const body: any = get.Body;
        await new Promise<void>((resolve, reject) => {
          const ws = createWriteStream(targetPath);
          body.pipe(ws);
          body.on("error", (e: any) => reject(e));
          ws.on("finish", () => resolve());
          ws.on("error", (e: any) => reject(e));
        });
        await this.addLog(sessionId, `Downloaded: s3://${bucket}/${key}`);
        pageCount++;
      }
      if (resp.IsTruncated) return downloadPage(resp.NextContinuationToken, pageCount);
      return pageCount;
    };
    return downloadPage(undefined, 0);
  }

  private formatBytes(bytes: number): string {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const exp = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = (bytes / Math.pow(1024, exp)).toFixed(1);
    return `${size} ${units[exp]}`;
  }

  private async scaleApp(config: EnvironmentConfig, count: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn("flyctl", ["scale", "count", count.toString(), "--app", config.appName]);
      proc.on("close", (code: number) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`flyctl scale exited with code ${code}`));
        }
      });
    });
  }

  private async updateSession(sessionId: string, updates: Partial<BackupSession>): Promise<void> {
    const update: Record<string, any> = { $set: updates, $currentDate: { updatedAt: true } };
    if (updates.status === BackupSessionStatus.COMPLETED) {
      update.$unset = { error: "" };
    }
    const filter = updates.status ? { _id: sessionId, status: { $ne: BackupSessionStatus.ABORTED } } : { _id: sessionId };
    await backupSession.updateOne(filter, update);
    await this.emitSessionUpdated(sessionId);
  }

  private async beginSession(sessionId: string): Promise<boolean> {
    const result = await backupSession.updateOne(
      { _id: sessionId, status: BackupSessionStatus.PENDING },
      { $set: { status: BackupSessionStatus.IN_PROGRESS }, $currentDate: { updatedAt: true } }
    );
    await this.emitSessionUpdated(sessionId);
    return result.modifiedCount > 0;
  }

  async abortSession(sessionId: string, user: string): Promise<BackupSession | null> {
    const abortedSet = {
      $set: { status: BackupSessionStatus.ABORTED, error: `Aborted by ${user}`, endTime: dateTimeNow().toJSDate() },
      $currentDate: { updatedAt: true }
    };
    const queued = await backupSession.updateOne(
      { _id: sessionId, status: BackupSessionStatus.PENDING },
      abortedSet
    );
    if (queued.modifiedCount > 0) {
      await this.emitSessionUpdated(sessionId);
      return backupSession.findById(sessionId).select("-logs").lean() as unknown as BackupSession;
    } else {
      const running = await backupSession.updateOne(
        { _id: sessionId, status: BackupSessionStatus.IN_PROGRESS },
        abortedSet
      );
      if (running.modifiedCount > 0) {
        await this.emitSessionUpdated(sessionId);
        return backupSession.findById(sessionId).select("-logs").lean() as unknown as BackupSession;
      } else {
        return null;
      }
    }
  }

  async failPendingBackup(sessionId: string, error: string): Promise<void> {
    await this.updateSessionError(sessionId, error, BackupSessionStatus.PENDING, BackupSessionType.BACKUP);
  }

  async failPendingRestore(sessionId: string, error: string): Promise<void> {
    await this.updateSessionError(sessionId, error, BackupSessionStatus.PENDING, BackupSessionType.RESTORE);
  }

  private async updateSessionError(sessionId: string, error: string, expectedStatus?: BackupSessionStatus, expectedType: BackupSessionType = BackupSessionType.BACKUP): Promise<void> {
    const result = await backupSession.updateOne(
      { _id: sessionId, ...(expectedStatus ? {status: expectedStatus, type: expectedType} : {status: {$ne: BackupSessionStatus.ABORTED}}) },
      { $set: { status: BackupSessionStatus.FAILED, error, endTime: dateTimeNow().toJSDate() }, $currentDate: { updatedAt: true } }
    );
    if (result.modifiedCount > 0) {
      await this.emitSessionUpdated(sessionId);
      if (this.notificationService) {
        const failedSession = await this.session(sessionId);
        if (failedSession) {
          if (failedSession.type === BackupSessionType.BACKUP) {
            await this.notificationService.notifyBackupCompleted(failedSession);
          } else {
            await this.notificationService.notifyRestoreCompleted(failedSession);
          }
        }
      }
    }
  }

  private async addLog(sessionId: string, message: string): Promise<void> {
    await this.addLogs(sessionId, [message]);
  }

  async cleanupStuckSessions(): Promise<number> {
    const candidates = await backupSession.find({
      status: { $in: ACTIVE_BACKUP_SESSION_STATUSES },
      startTime: { $lt: SERVER_START_TIME }
    });

    let cleanedCount = 0;
    for (const candidate of candidates) {
      await this.updateSessionError(
        candidate._id!.toString(),
        "Session orphaned by a prior server restart. The underlying operation may have completed before the restart; check S3 or the backup directory to confirm."
      );
      cleanedCount++;
    }

    return cleanedCount;
  }

  async sessions(limit: number = 50, environments?: string[]): Promise<BackupSession[]> {
    const query = environments && environments.length > 0
      ? { environment: { $in: environments } }
      : {};
    return backupSession.find(query).sort({startTime: -1}).limit(limit).select("-logs").lean() as unknown as BackupSession[];
  }

  async session(sessionId: string): Promise<BackupSession | null> {
    return backupSession.findById(sessionId);
  }

  async sessionStatus(sessionId: string): Promise<Pick<BackupSession, "status" | "error"> | null> {
    return backupSession.findById(sessionId).select({ status: 1, error: 1, _id: 0 }).lean();
  }

  async listEnvironments(): Promise<{ name: string; appName: string; database?: string; hasMongoConfig: boolean }[]> {
    const environments: { name: string; appName: string; database?: string; hasMongoConfig: boolean }[] = [];
    const processedNames = new Set<string>();

    if (this.backupConfig.environments) {
      for (const backupEnv of this.backupConfig.environments) {
        const flyConfig = this.configs.find(c => c.name === backupEnv.environment);
        const hasMongoConfig = !!(backupEnv.mongo?.cluster || backupEnv.mongo?.db);

        environments.push({
          name: backupEnv.environment,
          appName: backupEnv.flyio?.appName || flyConfig?.appName || backupEnv.environment,
          database: backupEnv.mongo?.db || flyConfig?.mongo?.db,
          hasMongoConfig
        });
        processedNames.add(backupEnv.environment);
      }
    }

    for (const config of this.configs) {
      if (!processedNames.has(config.name)) {
        environments.push({
          name: config.name,
          appName: config.appName,
          database: config.mongo?.db,
          hasMongoConfig: !!config.mongo
        });
      }
    }

    return environments;
  }

  async listBackups(): Promise<BackupListItem[]> {
    const backupsDir = path.join(this.dumpBaseDir, "backups");
    try {
      const entries = await fs.readdir(backupsDir);
      const backups: BackupListItem[] = [];

      for (const entry of entries) {
        const entryPath = path.join(backupsDir, entry);
        const stat = await fs.stat(entryPath);
        if (stat.isDirectory()) {
          let database: string | undefined = undefined;
          try {
            const dirents = await fs.readdir(entryPath, { withFileTypes: true });
            const dbDir = dirents.find(d => d.isDirectory())?.name;
            if (dbDir) {
              database = dbDir;
            }
          } catch {}

          let environment: string | undefined = undefined;
          try {
            const yyyyMmDdHhMmSsLength = 19;
            const tsPrefixLen = yyyyMmDdHhMmSsLength;
            if (entry.length > tsPrefixLen + 1) {
              const remainder = entry.slice(tsPrefixLen + 1);
              if (database && remainder.endsWith(`-${database}`)) {
                environment = remainder.slice(0, remainder.length - (database.length + 1));
              }
            }
          } catch {}

          backups.push({
            name: entry,
            path: `backups/${entry}`,
            timestamp: stat.mtime,
            status: BackupSessionStatus.COMPLETED,
            outcome: "completed",
            location: BackupLocation.LOCAL,
            environment,
            database
          });
        }
      }

      return backups.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
    } catch {
      return [];
    }
  }

  async listS3Backups(): Promise<BackupListItem[]> {
    if (!this.backupConfig.environments) {
      return [];
    }

    const errors: string[] = [];
    const globalRegion = this.backupConfig.aws?.region || AWS_DEFAULTS.REGION;
    const targets = this.s3ListTargets(this.backupConfig.aws, globalRegion, errors);
    const collected = await Promise.all(targets.map(target =>
      this.collectBackupsForEnvironment(errors, target.s3, target.bucket, target.environment)));
    const results = collected.flat();

    if (results.length === 0 && errors.length > 0) {
      throw new Error(errors.join("; "));
    }
    return results;
  }

  private s3ListTargets(aws: AwsConfig | undefined, globalRegion: string, errors: string[]): Array<{ environment: string; s3: S3Client; bucket: string }> {
    const environments = this.backupConfig.environments || [];
    const archives = backupListAwsTargets(aws);
    if (archives.length > 0) {
      return archives.flatMap(archive => {
        const s3 = new S3Client({
          region: archive.region || globalRegion,
          credentials: { accessKeyId: archive.accessKeyId, secretAccessKey: archive.secretAccessKey },
          followRegionRedirects: true
        });
        return environments.map(env => ({ environment: env.environment, bucket: archive.bucket, s3 }));
      });
    } else {
      const targets = environments
        .filter(env => env.aws?.bucket && env.aws?.accessKeyId && env.aws?.secretAccessKey)
        .map(env => ({
          environment: env.environment,
          bucket: env.aws.bucket,
          s3: new S3Client({
            region: env.aws.region || AWS_DEFAULTS.REGION,
            credentials: { accessKeyId: env.aws.accessKeyId, secretAccessKey: env.aws.secretAccessKey },
            followRegionRedirects: true
          })
        }));
      if (targets.length === 0) {
        errors.push("No S3 bucket configured — set a global bucket or per-environment AWS settings");
      }
      return targets;
    }
  }

  private async collectBackupsForEnvironment(errors: string[], s3: S3Client, bucket: string, environment: string): Promise<BackupListItem[]> {
    try {
      const envPrefix = `${environment}/`;
      const [tsPrefixes, manifestStatuses] = await Promise.all([
        this.listPrefixes(s3, bucket, envPrefix),
        completedManifestStatusByTimestamp(environment, this.backupConfig)
      ]);
      return tsPrefixes.flatMap(tsPrefix => {
        const trimmed = stripTrailingSlash(tsPrefix);
        const parsed = parseS3BackupPrefix(trimmed);
        if (!parsed) {
          return [];
        }
        const status = manifestStatuses.get(parsed.timestamp);
        return [{
          name: trimmed,
          path: buildS3LocationUrl(bucket, trimmed),
          timestamp: parseTimestampToDate(parsed.timestamp)!,
          environment,
          location: BackupLocation.S3,
          ...(status ? { status } : {}),
          outcome: status || "missing manifest"
        }];
      });
    } catch (error) {
      const message = `Failed to list S3 backups for ${environment}: ${error?.message || error}`;
      debugLog(message);
      errors.push(message);
      return [];
    }
  }

  private async listPrefixes(s3: S3Client, bucket: string, prefix: string): Promise<string[]> {
    const collectPrefixes = async (acc: string[], token: string | undefined, abortSignal: AbortSignal): Promise<string[]> => {
      const resp = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, Delimiter: "/", ContinuationToken: token }), { abortSignal });
      const newAcc = [...acc, ...(resp.CommonPrefixes || []).map(p => p.Prefix!)];
      if (resp.IsTruncated) return collectPrefixes(newAcc, resp.NextContinuationToken, abortSignal);
      return newAcc;
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      return await collectPrefixes([], undefined, controller.signal);
    } finally {
      clearTimeout(timeout);
    }
  }

  private archiveBackupAt(location: string): {bucket: string; prefix: string; environment: string; client: S3Client} {
    const [, bucket, pathPrefix] = /^s3:\/\/([^/]+)\/(.+)$/.exec(location) ?? [];
    const prefix = pathPrefix ? stripTrailingSlash(pathPrefix) : "";
    const backup = parseS3BackupPrefix(prefix);
    const environment = backup && environmentConfigFor(this.backupConfig, backup.environment);
    if (!environment || !backup || !parseTimestampToDate(backup.timestamp)) {
      throw new Error("Select a valid S3 backup location");
    } else {
      const archives = backupListAwsTargets(this.backupConfig.aws);
      const targets = archives.length > 0 ? archives : backupListAwsTargets(environment.aws);
      const archive = targets.find(target => target.bucket === bucket);
      if (!archive) {
        throw new Error("The selected backup bucket is not configured for this environment");
      } else {
        return {
          bucket,
          prefix,
          environment: backup.environment,
          client: new S3Client({
            region: archive.region,
            credentials: {accessKeyId: archive.accessKeyId, secretAccessKey: archive.secretAccessKey},
            followRegionRedirects: true
          })
        };
      }
    }
  }

  async deleteS3Backups(names: string[]): Promise<{ deleted: string[]; errors: NamedError[] }> {
    const deleted: string[] = [];
    const errors: NamedError[] = [];
    for (const name of names) {
      try {
        const {bucket, prefix, client: s3} = this.archiveBackupAt(name);
        const deletePage = async (token: string | undefined): Promise<void> => {
          const resp = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${prefix}/`, ContinuationToken: token }));
          for (const obj of (resp.Contents || [])) {
            await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key! }));
          }
          if (resp.IsTruncated) return deletePage(resp.NextContinuationToken);
        };
        await deletePage(undefined);
        deleted.push(name);
      } catch (e: any) {
        errors.push({ name, error: e.message });
      }
    }
    return { deleted, errors };
  }

  async listCollections(environmentName: string): Promise<string[]> {
    const config = this.findEnvironmentConfig(environmentName);
    if (!config || !config.mongo) {
      throw new Error(`Environment "${environmentName}" not found or has no mongo config`);
    }

    const mongoUri = this.buildMongoUriForConfig(config.mongo.cluster, config.mongo.username, config.mongo.password, config.mongo.db);
    const connection = await mongoose.createConnection(mongoUri, {
      serverSelectionTimeoutMS: 30000,
      maxPoolSize: 1
    }).asPromise();

    try {
      const collections = await connection.db.listCollections({}, { nameOnly: true }).toArray();
      return collections.map(collection => collection.name).filter(name => name.length > 0);
    } finally {
      await connection.close();
    }
  }

  async deleteBackups(names: string[]): Promise<{ deleted: string[]; errors: NamedError[] }> {
    const backupsDir = path.join(this.dumpBaseDir, "backups");
    const deleted: string[] = [];
    const errors: NamedError[] = [];

    for (const name of names) {
      try {
        const target = path.join(backupsDir, name);
        await fs.rm(target, { recursive: true, force: true });
        deleted.push(name);
      } catch (e: any) {
        errors.push({ name, error: e.message });
      }
    }

    return { deleted, errors };
  }
}
