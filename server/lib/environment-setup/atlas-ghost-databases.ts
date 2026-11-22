import debug from "debug";
import { randomBytes } from "crypto";
import { MongoClient } from "mongodb";
import { isDate, isNumber, isString, uniqBy } from "es-toolkit/compat";
import { envConfig } from "../env-config/env-config";
import { configuredEnvironments } from "../environments/environments-config";
import { environmentMigration } from "../mongo/models/environment-migration";
import { buildMongoUri, parseMongoUri } from "../shared/mongodb-uri";
import { storedMongoUri } from "../shared/stored-mongo-uri";
import { dateTimeFromIso, dateTimeFromJsDate, dateTimeFromMillis, dateTimeNow } from "../shared/dates";
import { atlasRequest } from "./atlas-admin-api";
import { AtlasDatabaseUser, AtlasDatabaseUserList, AtlasError, ProjectLogin } from "./atlas-admin-api.model";
import { managedAtlasClusters } from "./atlas-clusters";
import { deleteEnvironmentMongoUser, platformAtlasAccess, sanitisedEnvironmentName, waitForMongoLogin } from "./mongo-database-user";
import { AtlasClusterRow, AtlasGhostDatabase, AtlasGhostDatabaseDeleteRequest, AtlasLeftoverLogin, AtlasLeftoverLoginDeleteRequest } from "../../../projects/ngx-ramblers/src/app/models/atlas-cluster.model";
import { EnvironmentConfig } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import {
  EnvironmentMigrationAudit,
  EnvironmentMigrationStatus,
  migrationIncludesMongo
} from "../../../projects/ngx-ramblers/src/app/models/environment-migration.model";

const debugLog = debug(envConfig.logNamespace("atlas-ghost-databases"));
debugLog.enabled = true;

const CLEANUP_LOGIN_LIFETIME_HOURS = 24;

function locationKey(cluster: string | null | undefined, database: string | null | undefined): string {
  return cluster && database ? `${cluster}/${database}` : "";
}

function isoTime(value: Date | number | string | null | undefined): string | null {
  if (isDate(value)) {
    return dateTimeFromJsDate(value).toISO();
  } else if (isNumber(value)) {
    return dateTimeFromMillis(value).toISO();
  } else if (isString(value) && value) {
    return dateTimeFromIso(value).toISO();
  } else {
    return null;
  }
}

function databasesInUse(environments: EnvironmentConfig[]): Set<string> {
  return new Set(environments.flatMap(environment => {
    const stored = storedMongoUri(environment).parsed;
    return [locationKey(environment.mongo?.cluster, environment.mongo?.db), locationKey(stored?.cluster, stored?.database)];
  }).filter(key => !!key));
}

export function ghostDatabasesFrom(environments: EnvironmentConfig[], migrations: EnvironmentMigrationAudit[]): AtlasGhostDatabase[] {
  const inUse = databasesInUse(environments);
  const leftBehind = migrations
    .filter(migration => migration.status === EnvironmentMigrationStatus.ROTATED && migrationIncludesMongo(migration.mode) && !migration.dryRun)
    .filter(migration => !migration.sourceRemovedAt)
    .filter(migration => !!locationKey(migration.sourceMongo?.cluster, migration.sourceMongo?.db))
    .filter(migration => locationKey(migration.sourceMongo.cluster, migration.sourceMongo.db) !== locationKey(migration.targetMongo?.cluster, migration.targetMongo?.db))
    .filter(migration => !inUse.has(locationKey(migration.sourceMongo.cluster, migration.sourceMongo.db)))
    .sort((left, right) => (isoTime(right.rotatedAt) || "").localeCompare(isoTime(left.rotatedAt) || ""))
    .map(migration => ({
      migrationId: migration.migrationId,
      environment: migration.environment,
      cluster: migration.sourceMongo.cluster,
      database: migration.sourceMongo.db,
      oldUsername: migration.sourceMongo.username || "",
      movedTo: migration.targetMongo?.cluster || "",
      movedAt: isoTime(migration.rotatedAt),
      collections: migration.verification?.collections?.length ?? null
    }));
  return uniqBy(leftBehind, ghost => locationKey(ghost.cluster, ghost.database));
}

async function movesThatLeftDatabasesBehind(): Promise<EnvironmentMigrationAudit[]> {
  return environmentMigration.find({status: EnvironmentMigrationStatus.ROTATED, sourceRemovedAt: {$exists: false}}).lean();
}

export async function atlasGhostDatabases(): Promise<AtlasGhostDatabase[]> {
  const config = await configuredEnvironments();
  return ghostDatabasesFrom(config.environments || [], await movesThatLeftDatabasesBehind());
}

function cleanupLoginName(): string {
  return `ngx_cleanup_${randomBytes(6).toString("hex")}`;
}

export async function deleteGhostDatabase(request: AtlasGhostDatabaseDeleteRequest): Promise<{message: string}> {
  const config = await configuredEnvironments();
  const environments = config.environments || [];
  const ghost = ghostDatabasesFrom(environments, await movesThatLeftDatabasesBehind()).find(candidate => candidate.migrationId === request?.migrationId) || null;
  const cluster = ghost ? (await managedAtlasClusters()).find(candidate => candidate.host === ghost.cluster) || null : null;
  if (!ghost) {
    throw new Error("That database is no longer one left behind by a move, so nothing was deleted. Refresh this page.");
  } else if (request.confirmDatabase !== ghost.database) {
    throw new Error(`Type ${ghost.database} to confirm, so nothing was deleted.`);
  } else if (!cluster?.projectId || !cluster.inProvisioningProject) {
    throw new Error(`Cluster ${ghost.cluster} is not one this page manages, so ${ghost.database} cannot be deleted from here.`);
  } else {
    const atlas = {...await platformAtlasAccess(), projectId: cluster.projectId};
    const login = {username: cleanupLoginName(), password: randomBytes(24).toString("base64url")};
    const removal = {found: 0};
    const created = await atlasRequest<AtlasError>(atlas, "POST", `/groups/${cluster.projectId}/databaseUsers`, {
      databaseName: "admin",
      groupId: cluster.projectId,
      username: login.username,
      password: login.password,
      roles: [{databaseName: ghost.database, roleName: "readWrite"}, {databaseName: ghost.database, roleName: "dbAdmin"}],
      scopes: [{name: cluster.name, type: "CLUSTER"}],
      deleteAfterDate: dateTimeNow().plus({hours: CLEANUP_LOGIN_LIFETIME_HOURS}).toISO()
    });
    if (created.status >= 300) {
      throw new Error(`MongoDB Atlas would not create a login to remove ${ghost.database} (${created.status}): ${created.body?.detail || created.body?.reason || "no detail given"}`);
    } else {
      try {
        await waitForMongoLogin(ghost.cluster, login, ghost.database, attempt => debugLog("waiting for cleanup login, attempt %d", attempt));
        const client = new MongoClient(buildMongoUri({cluster: ghost.cluster, username: login.username, password: login.password, database: ghost.database}), {serverSelectionTimeoutMS: 15000, maxPoolSize: 1});
        await client.connect();
        try {
          const collections = await client.db(ghost.database).listCollections({}, {nameOnly: true}).toArray();
          removal.found = collections.length;
          if (collections.length > 0) {
            await client.db(ghost.database).dropDatabase();
          }
        } finally {
          await client.close();
        }
      } finally {
        await atlasRequest<AtlasError>(atlas, "DELETE", `/groups/${cluster.projectId}/databaseUsers/admin/${encodeURIComponent(login.username)}`).catch(error => debugLog("cleanup login %s not removed: %s", login.username, error?.message || error));
      }
      const oldLoginInUse = environments.some(environment => environment.mongo?.username === ghost.oldUsername);
      const oldLogin = ghost.oldUsername && !oldLoginInUse
        ? await deleteEnvironmentMongoUser(atlas, ghost.oldUsername).catch(error => `old login ${ghost.oldUsername} not removed: ${error?.message || error}`)
        : null;
      const spareLogins = (await atlasLeftoverLogins(await managedAtlasClusters()))
        .filter(login => login.projectId === cluster.projectId && login.database === ghost.database && login.username !== ghost.oldUsername);
      const spareOutcomes = spareLogins.length ? await deleteLogins(spareLogins) : [];
      await environmentMigration.updateMany(
        {status: EnvironmentMigrationStatus.ROTATED, "sourceMongo.cluster": ghost.cluster, "sourceMongo.db": ghost.database},
        {$set: {sourceRemovedAt: dateTimeNow().toJSDate()}}
      );
      debugLog("removed %s from %s; %s", ghost.database, ghost.cluster, oldLogin || "no old login removed");
      const outcome = removal.found > 0 ? `Deleted ${ghost.database} (${removal.found} collections) from ${cluster.name}` : `${ghost.database} was already gone from ${cluster.name}, so it is no longer shown`;
      const loginsRemoved = (oldLogin ? 1 : 0) + spareOutcomes.length;
      return {message: `${outcome}${loginsRemoved ? `, and removed ${loginsRemoved} unused login${loginsRemoved === 1 ? "" : "s"} for it` : ""}.`};
    }
  }
}

const GENERATED_LOGIN = /^ngx_.+(_migration_|_move_[ab]$|_db_user$)/;
const FINISHED_MOVE_STATUSES: EnvironmentMigrationStatus[] = [EnvironmentMigrationStatus.ROTATED, EnvironmentMigrationStatus.FAILED, EnvironmentMigrationStatus.ORPHANED];

export function loginEnvironment(username: string, environmentNames: string[]): string | null {
  return environmentNames.find(name => new RegExp(`^ngx_${sanitisedEnvironmentName(name)}_(migration_|move_[ab]$|db_user$)`).test(username)) || null;
}

function loginsInUse(environments: EnvironmentConfig[], migrations: EnvironmentMigrationAudit[], ownLogin: string | null): Set<string> {
  return new Set([
    ownLogin,
    ...environments.flatMap(environment => [environment.mongo?.username, storedMongoUri(environment).parsed?.username]),
    ...migrations.filter(migration => !migration.dryRun && !FINISHED_MOVE_STATUSES.includes(migration.status)).map(migration => migration.targetMongo?.username)
  ].filter(username => !!username));
}

function clusterForLogin(login: ProjectLogin, environment: string | null, environments: EnvironmentConfig[], migrations: EnvironmentMigrationAudit[], clusters: AtlasClusterRow[]): string {
  const projectClusters = clusters.filter(cluster => cluster.projectId === login.projectId).map(cluster => cluster.host);
  const createdFor = migrations.find(migration => migration.targetMongo?.username === login.username)?.targetMongo?.cluster;
  const usedOn = migrations.find(migration => migration.sourceMongo?.username === login.username)?.sourceMongo?.cluster;
  const siteIsOn = environments.find(candidate => candidate.environment === environment)?.mongo?.cluster;
  return [createdFor, usedOn, siteIsOn].find(host => !!host && projectClusters.includes(host)) || projectClusters[0] || "";
}

export function leftoverLoginsFrom(environments: EnvironmentConfig[], migrations: EnvironmentMigrationAudit[], logins: ProjectLogin[], clusters: AtlasClusterRow[], ownLogin: string | null): AtlasLeftoverLogin[] {
  const inUse = loginsInUse(environments, migrations, ownLogin);
  const environmentNames = uniqBy([...environments.map(environment => environment.environment), ...migrations.map(migration => migration.environment)], name => name)
    .sort((left, right) => right.length - left.length);
  return logins
    .filter(login => GENERATED_LOGIN.test(login.username) && !inUse.has(login.username))
    .map(login => ({login, environment: loginEnvironment(login.username, environmentNames)}))
    .filter(candidate => !!candidate.environment)
    .map(({login, environment}) => ({projectId: login.projectId, username: login.username, environment, database: login.database || null, cluster: clusterForLogin(login, environment, environments, migrations, clusters)}))
    .filter(login => !!login.cluster);
}

export function loginDatabase(user: AtlasDatabaseUser): string | null {
  return (user.roles || []).map(role => role.databaseName).find(database => !!database && database !== "admin") || null;
}

async function projectLogins(clusters: AtlasClusterRow[]): Promise<ProjectLogin[]> {
  const atlas = await platformAtlasAccess();
  const projectIds = uniqBy(clusters.filter(cluster => cluster.inProvisioningProject && cluster.projectId).map(cluster => cluster.projectId), id => id);
  const perProject = await Promise.all(projectIds.map(async projectId => {
    const listed = await atlasRequest<AtlasDatabaseUserList & AtlasError>({...atlas, projectId}, "GET", `/groups/${projectId}/databaseUsers?itemsPerPage=500`);
    if (listed.status >= 300) {
      debugLog("database users for project %s returned %s", projectId, listed.status);
      return [] as ProjectLogin[];
    } else {
      return (listed.body?.results || []).filter(user => !!user.username).map(user => ({projectId, username: user.username, database: loginDatabase(user)}));
    }
  }));
  return perProject.flat();
}

async function allMoves(): Promise<EnvironmentMigrationAudit[]> {
  return environmentMigration.find({}).lean();
}

export async function atlasLeftoverLogins(clusters: AtlasClusterRow[]): Promise<AtlasLeftoverLogin[]> {
  const config = await configuredEnvironments();
  return leftoverLoginsFrom(config.environments || [], await allMoves(), await projectLogins(clusters), clusters, parseMongoUri(envConfig.mongo().uri.replace(/^"|"$/g, ""))?.username || null);
}

async function deleteLogins(logins: AtlasLeftoverLogin[]): Promise<string[]> {
  const atlas = await platformAtlasAccess();
  return Promise.all(logins.map(login => deleteEnvironmentMongoUser({...atlas, projectId: login.projectId}, login.username)
    .catch(error => `${login.username} not removed: ${error?.message || error}`)));
}

export async function deleteLeftoverLogin(request: AtlasLeftoverLoginDeleteRequest): Promise<{message: string}> {
  const leftovers = await atlasLeftoverLogins(await managedAtlasClusters());
  const login = leftovers.find(candidate => candidate.projectId === request?.projectId && candidate.username === request?.username) || null;
  if (!login) {
    throw new Error("That login is no longer unused, so nothing was deleted. Refresh this page.");
  } else {
    const [outcome] = await deleteLogins([login]);
    return {message: outcome};
  }
}

export async function removeLeftoverLoginsFor(environment: string): Promise<string[]> {
  const leftovers = (await atlasLeftoverLogins(await managedAtlasClusters())).filter(login => login.environment === environment);
  const outcomes = leftovers.length ? await deleteLogins(leftovers) : [];
  debugLog("leftover logins for %s: %o", environment, outcomes);
  return outcomes;
}
