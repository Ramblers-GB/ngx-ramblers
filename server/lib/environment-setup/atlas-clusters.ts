import debug from "debug";
import { Document, MongoClient, MongoClientOptions } from "mongodb";
import { chunk, groupBy, isNumber, uniqBy, values } from "es-toolkit/compat";
import { dateTimeNowAsValue } from "../shared/dates";
import { envConfig } from "../env-config/env-config";
import * as configController from "../mongo/controllers/config";
import { configuredEnvironments } from "../environments/environments-config";
import { registrationSettings } from "../site-registration/registration-store";
import { buildMongoUri, extractClusterFromUri } from "../shared/mongodb-uri";
import { ConfigKey } from "../../../projects/ngx-ramblers/src/app/models/config.model";
import {
  AtlasClusterCreateRequest,
  AtlasClusterDeleteRequest,
  ATLAS_ALERT_HISTORY_DAYS,
  AtlasAlertStatus,
  AtlasClusterAlert,
  AtlasClusterConnections,
  AtlasClusterHealth,
  AtlasClusterLoad,
  AtlasClusterEnvironmentRow,
  ConnectionWindow,
  AtlasGhostDatabase,
  AtlasLeftoverLogin,
  AtlasClusterRow,
  AtlasClusterState,
  AtlasClusterTier,
  AtlasClusterView,
  AtlasNetworkAccessEntry,
  NEW_ENVIRONMENT_COLLECTION_HEADROOM,
  NEW_ENVIRONMENT_INDEX_HEADROOM,
  atlasTierFromInstanceSize,
  clusterCapacity,
  isSharedTier,
  SiteDatabaseState,
  siteDatabaseWarning
} from "../../../projects/ngx-ramblers/src/app/models/atlas-cluster.model";
import { runningSiteDatabaseState } from "./site-database-check";
import {
  AtlasConfig,
  atlasApiRegionName,
  AwsRegion,
  awsRegionFromAny,
  ConsoleAccessService,
  EnvironmentConfig,
  EnvironmentsConfig,
  MongoConfig
} from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { atlasRequest } from "./atlas-admin-api";
import {
  AtlasAccessList,
  AtlasAlertDescription,
  AtlasAlertList,
  AtlasApiAccess,
  AtlasApiVersion,
  AtlasClusterDescription,
  AtlasClusterList,
  AtlasError,
  AtlasFlexClusterDescription,
  AtlasFlexClusterList,
  AtlasMeasurement,
  AtlasMeasurements,
  AtlasProcess,
  AtlasProcessList,
  AtlasResponse
} from "./atlas-admin-api.model";
import { atlasProjectForCluster } from "./atlas-projects";
import { platformAtlasAccess } from "./mongo-database-user";
import { storedMongoUri } from "../shared/stored-mongo-uri";
import { configuredSiteUrl } from "../../../projects/ngx-ramblers/src/app/functions/environment-site-url";

const debugLog = debug(envConfig.logNamespace("atlas-clusters"));
debugLog.enabled = true;

export function clusterHostFromSrv(standardSrv: string): string {
  const withUser = extractClusterFromUri(standardSrv);
  if (withUser) {
    return withUser;
  } else {
    const match = (standardSrv || "").match(/mongodb\+srv:\/\/([^/?]+)/i);
    const host = match?.[1] || "";
    return host.replace(/\.mongodb\.net$/i, "");
  }
}

export function atlasFlexClusterCreateBody(name: string, region: AwsRegion): Record<string, unknown> {
  return {
    name,
    providerSettings: {backingProviderName: "AWS", regionName: atlasApiRegionName(region)},
    terminationProtectionEnabled: false
  };
}

export function clusterDescriptionFromFlex(flex: AtlasFlexClusterDescription): AtlasClusterDescription {
  return {
    groupId: flex.groupId,
    name: flex.name,
    stateName: flex.stateName,
    connectionStrings: flex.connectionStrings,
    replicationSpecs: [{regionConfigs: [{electableSpecs: {instanceSize: AtlasClusterTier.FLEX}, providerName: flex.providerSettings?.providerName, backingProviderName: flex.providerSettings?.backingProviderName, regionName: flex.providerSettings?.regionName}]}]
  };
}

export function atlasClusterCreateBody(name: string, tier: AtlasClusterTier, region: AwsRegion): Record<string, unknown> {
  const tenant = isSharedTier(tier);
  return {
    name,
    clusterType: "REPLICASET",
    replicationSpecs: [{
      regionConfigs: [{
        electableSpecs: tenant ? {instanceSize: tier} : {instanceSize: tier, nodeCount: 3},
        providerName: tenant ? "TENANT" : "AWS",
        ...(tenant ? {backingProviderName: "AWS"} : {}),
        regionName: atlasApiRegionName(region),
        priority: 7
      }]
    }]
  };
}

function atlasStateFrom(stateName: string | undefined): AtlasClusterState {
  const state = (stateName || "").toUpperCase();
  if (state === AtlasClusterState.IDLE) {
    return AtlasClusterState.IDLE;
  } else if (state === AtlasClusterState.CREATING) {
    return AtlasClusterState.CREATING;
  } else if (state === AtlasClusterState.UPDATING) {
    return AtlasClusterState.UPDATING;
  } else if (state === AtlasClusterState.REPAIRING) {
    return AtlasClusterState.REPAIRING;
  } else if (state === AtlasClusterState.DELETING) {
    return AtlasClusterState.DELETING;
  } else if (state === AtlasClusterState.DELETED) {
    return AtlasClusterState.DELETED;
  } else {
    return AtlasClusterState.UNKNOWN;
  }
}

function instanceSizeFrom(cluster: AtlasClusterDescription): AtlasClusterTier {
  const region = cluster.replicationSpecs?.[0]?.regionConfigs?.[0];
  return atlasTierFromInstanceSize(region?.electableSpecs?.instanceSize);
}

function regionFrom(cluster: AtlasClusterDescription): string {
  const atlasName = cluster.replicationSpecs?.[0]?.regionConfigs?.[0]?.regionName || "";
  return awsRegionFromAny(atlasName) || atlasName;
}

export const DATABASES_COUNTED_AT_ONCE_PER_CLUSTER = 3;

const USAGE_CLIENT_OPTIONS: MongoClientOptions = {serverSelectionTimeoutMS: 12000, connectTimeoutMS: 12000, maxPoolSize: 1, minPoolSize: 0};

export function usageFromDatabaseStats(stats: Document): {collections: number; indexes: number; dataSizeBytes: number} {
  return {
    collections: (stats.collections || 0) + (stats.views || 0),
    indexes: stats.indexes || 0,
    dataSizeBytes: (stats.dataSize || 0) + (stats.indexSize || 0)
  };
}

async function countDatabaseUsage(mongo: MongoConfig): Promise<{collections: number; indexes: number; dataSizeBytes: number | null}> {
  const client = new MongoClient(buildMongoUri({
    cluster: mongo.cluster,
    username: mongo.username,
    password: mongo.password,
    database: mongo.db
  }), USAGE_CLIENT_OPTIONS);
  try {
    await client.connect();
    return usageFromDatabaseStats(await client.db(mongo.db).stats());
  } finally {
    await client.close();
  }
}

export async function inBatches<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  return chunk(items, Math.max(1, size)).reduce(async (previous: Promise<R[]>, batch: T[]) => [...await previous, ...await Promise.all(batch.map(work))], Promise.resolve([] as R[]));
}

async function environmentRows(config: EnvironmentsConfig): Promise<AtlasClusterEnvironmentRow[]> {
  const byCluster = values(groupBy(config.environments || [], environment => environment.mongo?.cluster || ""));
  const [perCluster, liveDatabases] = await Promise.all([
    Promise.all(byCluster.map(environments => inBatches(environments, DATABASES_COUNTED_AT_ONCE_PER_CLUSTER, environment => environmentRow(config, environment)))),
    Promise.all((config.environments || []).map(environment => runningSiteDatabaseState(environment, environment.mongo?.cluster, environment.mongo?.db).catch(() => SiteDatabaseState.UNKNOWN)))
  ]);
  const liveByEnvironment = new Map((config.environments || []).map((environment, index) => [environment.environment, liveDatabases[index]]));
  return perCluster.flat().map(row => ({...row, liveDatabase: liveByEnvironment.get(row.environment) || SiteDatabaseState.UNKNOWN}));
}

async function environmentRow(config: EnvironmentsConfig, environment: EnvironmentConfig): Promise<AtlasClusterEnvironmentRow> {
  const mongo = environment.mongo || {};
  const row: AtlasClusterEnvironmentRow = {
    environment: environment.environment,
    siteUrl: configuredSiteUrl(config, environment.environment),
    cluster: mongo.cluster || "",
    clusterName: "",
    projectId: environment.consoleAccess?.[ConsoleAccessService.MONGODB_ATLAS]?.identifiers?.projectId || "",
    database: mongo.db || "",
    username: mongo.username || "",
    collections: null,
    indexes: null,
    dataSizeBytes: null,
    error: null
  };
  if (!mongo.cluster || !mongo.db || !mongo.username || !mongo.password) {
    return {...row, error: "MongoDB configuration is incomplete"};
  } else {
    try {
      const usage = await countDatabaseUsage(mongo);
      return {...row, collections: usage.collections, indexes: usage.indexes, dataSizeBytes: usage.dataSizeBytes};
    } catch (error) {
      return {...row, error: error?.message || "Could not count collections"};
    }
  }
}

function rollupClusters(
  atlasClusters: AtlasClusterDescription[],
  rows: AtlasClusterEnvironmentRow[],
  defaultCluster: string,
  templateCollections: number,
  templateIndexes: number
): AtlasClusterRow[] {
  const byHost = new Map<string, AtlasClusterRow>();
  atlasClusters.forEach(cluster => {
    const host = clusterHostFromSrv(cluster.connectionStrings?.standardSrv || "") || cluster.name || "";
    if (host) {
      byHost.set(host, {
        name: cluster.name || host,
        projectId: cluster.groupId,
        host,
        instanceSize: instanceSizeFrom(cluster),
        region: regionFrom(cluster),
        stateName: atlasStateFrom(cluster.stateName),
        inProvisioningProject: true,
        isDefault: host === defaultCluster,
        environmentCount: 0,
        collectionCount: 0,
        indexCount: 0,
        databaseCount: 0,
        dataSizeBytes: 0,
        load: null,
        canAddEnvironment: true,
        limitHeadline: ""
      });
    }
  });
  rows.forEach(row => {
    if (row.cluster) {
      const existing = byHost.get(row.cluster);
      if (existing) {
        existing.environmentCount += 1;
        existing.databaseCount += row.database ? 1 : 0;
        existing.collectionCount += row.collections || 0;
        existing.indexCount += row.indexes || 0;
        existing.dataSizeBytes += row.dataSizeBytes || 0;
      } else {
        byHost.set(row.cluster, {
          name: row.cluster,
          host: row.cluster,
          instanceSize: AtlasClusterTier.UNKNOWN,
          region: "",
          stateName: AtlasClusterState.UNKNOWN,
          inProvisioningProject: false,
          isDefault: row.cluster === defaultCluster,
          environmentCount: 1,
          collectionCount: row.collections || 0,
          indexCount: row.indexes || 0,
          dataSizeBytes: row.dataSizeBytes || 0,
          load: null,
          databaseCount: row.database ? 1 : 0,
          canAddEnvironment: true,
          limitHeadline: ""
        });
      }
    }
  });
  return Array.from(byHost.values()).map(cluster => {
    const capacity = clusterCapacity(cluster.instanceSize, cluster.collectionCount, cluster.indexCount, cluster.databaseCount, templateCollections, templateIndexes);
    const clusterRows = rows.filter(row => row.cluster === cluster.host).sort((left, right) => left.environment.localeCompare(right.environment));
    return {
      ...cluster,
      environmentNames: clusterRows.map(row => row.environment).join(", "),
      sites: clusterRows.map(row => ({environment: row.environment, url: row.siteUrl, warning: siteDatabaseWarning(row.liveDatabase, row.cluster)})),
      canAddEnvironment: capacity.canAdd,
      limitHeadline: capacity.headline
    };
  }).sort((left, right) => left.host.localeCompare(right.host));
}

const OPCOUNTER_METRICS = ["OPCOUNTER_CMD", "OPCOUNTER_QUERY", "OPCOUNTER_UPDATE", "OPCOUNTER_DELETE", "OPCOUNTER_GETMORE", "OPCOUNTER_INSERT"];

export function processesForCluster(processes: AtlasProcess[], host: string): AtlasProcess[] {
  const suffix = host.split(".").slice(1).join(".");
  const domain = suffix ? `.${suffix}.mongodb.net` : "";
  return domain ? processes.filter(process => [process.hostname, process.userAlias].some(name => (name || "").toLowerCase().endsWith(domain.toLowerCase()))) : [];
}

export function loadFromMeasurements(measurements: AtlasMeasurement[]): AtlasClusterLoad | null {
  const totals = new Map<string, number>();
  measurements
    .filter(measurement => OPCOUNTER_METRICS.includes(measurement.name || ""))
    .flatMap(measurement => measurement.dataPoints || [])
    .filter(point => point.timestamp && isNumber(point.value))
    .forEach(point => totals.set(point.timestamp, (totals.get(point.timestamp) || 0) + point.value));
  const hourly = Array.from(totals.values());
  if (hourly.length === 0) {
    return null;
  } else {
    return {
      averageOpsPerSecond: Math.round((hourly.reduce((sum, value) => sum + value, 0) / hourly.length) * 10) / 10,
      peakOpsPerSecond: Math.round(Math.max(...hourly) * 10) / 10
    };
  }
}

export function connectionsFromMeasurements(measurements: AtlasMeasurement[]): AtlasClusterConnections | null {
  const points = measurements
    .filter(measurement => measurement.name === "CONNECTIONS")
    .flatMap(measurement => measurement.dataPoints || [])
    .filter(point => point.timestamp && isNumber(point.value));
  if (points.length === 0) {
    return null;
  } else {
    const busiest = points.reduce((highest, point) => point.value > highest.value ? point : highest, points[0]);
    return {current: Math.round(points[points.length - 1].value), peak: Math.round(busiest.value), peakAt: busiest.timestamp || null};
  }
}

export function recentClusterAlerts(alerts: AtlasAlertDescription[], clusterName: string, since: number): AtlasClusterAlert[] {
  const matching = alerts
    .filter(alert => alert.clusterName === clusterName && alert.created && Date.parse(alert.created) >= since)
    .map(alert => ({
      id: alert.id || "",
      metricName: alert.metricName || null,
      eventTypeName: alert.eventTypeName || null,
      status: alert.status || AtlasAlertStatus.OPEN,
      created: alert.created,
      resolved: alert.resolved || null,
      currentValue: isNumber(alert.currentValue?.number) ? alert.currentValue.number : null
    }))
    .sort((left, right) => right.created.localeCompare(left.created));
  return uniqBy(matching, alert => `${alert.metricName || alert.eventTypeName}|${alert.status}|${alert.created.slice(0, 16)}`);
}

function primaryProcess(processes: AtlasProcess[], host: string): AtlasProcess | null {
  const candidates = processesForCluster(processes, host);
  return candidates.find(candidate => candidate.typeName === "REPLICA_PRIMARY") || candidates[0] || null;
}

async function processMeasurements(atlas: AtlasApiAccess, process: AtlasProcess, query: string, host: string): Promise<AtlasMeasurement[]> {
  const response = await atlasRequest<AtlasMeasurements & AtlasError>(atlas, "GET", `/groups/${atlas.projectId}/processes/${encodeURIComponent(process.id)}/measurements?${query}`);
  if (response.status >= 300) {
    debugLog("cluster measurements: %s returned %s %o", host, response.status, response.body);
    return [];
  } else {
    return response.body?.measurements || [];
  }
}

async function clusterLoad(atlas: AtlasApiAccess, process: AtlasProcess | null, host: string): Promise<AtlasClusterLoad | null> {
  if (!process?.id) {
    return null;
  } else {
    const query = ["granularity=PT1H", "period=P1D", ...OPCOUNTER_METRICS.map(metric => `m=${metric}`)].join("&");
    return loadFromMeasurements(await processMeasurements(atlas, process, query, host));
  }
}

async function clusterConnections(atlas: AtlasApiAccess, process: AtlasProcess | null, host: string, window: ConnectionWindow): Promise<AtlasClusterConnections | null> {
  if (!process?.id) {
    return null;
  } else {
    return connectionsFromMeasurements(await processMeasurements(atlas, process, `granularity=PT1M&period=${window}&m=CONNECTIONS`, host));
  }
}

async function projectProcesses(atlas: AtlasApiAccess): Promise<AtlasProcess[]> {
  const listed = await atlasRequest<AtlasProcessList & AtlasError>(atlas, "GET", `/groups/${atlas.projectId}/processes?itemsPerPage=500`).catch(() => null);
  if (listed && listed.status >= 300) {
    debugLog("cluster health: processes for project %s returned %s %o", atlas.projectId, listed.status, listed.body);
  }
  return listed && listed.status < 300 ? listed.body?.results || [] : [];
}

async function projectAlerts(atlas: AtlasApiAccess): Promise<AtlasAlertDescription[]> {
  const listed = await atlasRequest<AtlasAlertList & AtlasError>(atlas, "GET", `/groups/${atlas.projectId}/alerts?itemsPerPage=100`).catch(() => null);
  if (listed && listed.status >= 300) {
    debugLog("cluster health: alerts for project %s returned %s %o", atlas.projectId, listed.status, listed.body);
  }
  return listed && listed.status < 300 ? listed.body?.results || [] : [];
}

export async function clusterHealth(atlas: AtlasApiAccess, clusters: Pick<AtlasClusterRow, "projectId" | "host" | "name" | "inProvisioningProject">[], window: ConnectionWindow, includeLoad: boolean): Promise<Map<string, AtlasClusterHealth>> {
  const since = dateTimeNowAsValue() - ATLAS_ALERT_HISTORY_DAYS * 24 * 60 * 60 * 1000;
  const projectIds = Array.from(new Set(clusters.filter(cluster => cluster.inProvisioningProject && cluster.projectId).map(cluster => cluster.projectId)));
  const perProject = await Promise.all(projectIds.map(async projectId => {
    const projectAtlas = {...atlas, projectId};
    const [processes, alerts] = await Promise.all([projectProcesses(projectAtlas), projectAlerts(projectAtlas)]);
    const projectClustersWithHost = clusters.filter(cluster => cluster.projectId === projectId && cluster.host);
    return Promise.all(projectClustersWithHost.map(async cluster => {
      const process = primaryProcess(processes, cluster.host);
      const [load, connections] = await Promise.all([
        includeLoad ? clusterLoad(projectAtlas, process, cluster.host).catch(() => null) : Promise.resolve(null),
        clusterConnections(projectAtlas, process, cluster.host, window).catch(() => null)
      ]);
      return [cluster.host, {load, connections, alerts: recentClusterAlerts(alerts, cluster.name, since)}] as [string, AtlasClusterHealth];
    }));
  }));
  return new Map(perProject.flat());
}

export async function managedAtlasClusters(): Promise<AtlasClusterRow[]> {
  const config = await configuredEnvironments();
  const atlas = await platformAtlasAccess();
  if (!atlas.projectId || !atlas.publicKey || !atlas.privateKey) {
    return [];
  } else {
    const projectIds = Array.from(new Set([atlas.projectId, ...(config.atlas?.managedProjects || []).map(project => project.projectId)]));
    const responses = await Promise.all(projectIds.map(id => projectClusters({...atlas, projectId: id})));
    const described = responses.filter(response => response.status < 300).flatMap(response => response.body?.results || []);
    const rows = (config.environments || []).map(environment => ({
      environment: environment.environment, siteUrl: "", cluster: environment.mongo?.cluster || "", database: environment.mongo?.db || "",
      username: "", collections: null, indexes: null, dataSizeBytes: null, error: null
    }));
    return rollupClusters(described, rows, config.atlas?.defaultCluster || "", NEW_ENVIRONMENT_COLLECTION_HEADROOM, NEW_ENVIRONMENT_INDEX_HEADROOM);
  }
}

export async function atlasClusterConnectionHealth(window: ConnectionWindow): Promise<AtlasClusterRow[]> {
  const clusters = await managedAtlasClusters();
  if (clusters.length === 0) {
    return [];
  } else {
    const health = await clusterHealth(await platformAtlasAccess(), clusters, window, false);
    return clusters.map(cluster => ({...cluster, ...(health.get(cluster.host) || {}), load: null}));
  }
}

async function projectClusters(atlas: AtlasApiAccess): Promise<AtlasResponse<AtlasClusterList & AtlasError>> {
  const id = atlas.projectId;
  const [dedicated, flex] = await Promise.all([
    atlasRequest<AtlasClusterList & AtlasError>(atlas, "GET", `/groups/${id}/clusters?itemsPerPage=100`, null, AtlasApiVersion.CLUSTERS),
    atlasRequest<AtlasFlexClusterList & AtlasError>(atlas, "GET", `/groups/${id}/flexClusters?itemsPerPage=100`, null, AtlasApiVersion.FLEX_CLUSTERS)
  ]);
  if (dedicated.status >= 300) {
    return dedicated;
  } else {
    if (flex.status >= 300) {
      debugLog("flex clusters: project %s returned %s %o", id, flex.status, flex.body);
    }
    const flexClusters = flex.status < 300 ? (flex.body?.results || []).map(clusterDescriptionFromFlex) : [];
    const flexNames = new Set(flexClusters.map(cluster => cluster.name));
    const results = [...(dedicated.body?.results || []).filter(cluster => !flexNames.has(cluster.name)), ...flexClusters]
      .map(cluster => ({...cluster, groupId: id}));
    return {status: dedicated.status, body: {...dedicated.body, results}};
  }
}

export function withGhostDatabases(cluster: AtlasClusterRow, ghosts: AtlasGhostDatabase[], templateCollections: number, templateIndexes: number): AtlasClusterRow {
  const ghostDatabases = ghosts.filter(ghost => ghost.cluster === cluster.host);
  if (ghostDatabases.length === 0) {
    return {...cluster, ghostDatabases};
  } else {
    const collectionCount = cluster.collectionCount + ghostDatabases.reduce((total, ghost) => total + (ghost.collections || 0), 0);
    const databaseCount = cluster.databaseCount + ghostDatabases.length;
    const capacity = clusterCapacity(cluster.instanceSize, collectionCount, cluster.indexCount, databaseCount, templateCollections, templateIndexes);
    return {...cluster, ghostDatabases, collectionCount, databaseCount, canAddEnvironment: capacity.canAdd, limitHeadline: capacity.headline};
  }
}

export async function atlasClusterView(): Promise<AtlasClusterView> {
  const config = await configuredEnvironments();
  const settings = await registrationSettings();
  const atlas = await platformAtlasAccess();
  const keysConfigured = !!(atlas.publicKey && atlas.privateKey);
  const projectId = atlas.projectId || "";
  const defaultCluster = config.atlas?.defaultCluster || "";
  const rows = await environmentRows(config);
  const atlasState: {clusters: AtlasClusterDescription[]; networkAccess: AtlasNetworkAccessEntry[]; reachable: boolean; error: string | null} = {
    clusters: [],
    networkAccess: [],
    reachable: false,
    error: null
  };
  if (!projectId || !keysConfigured) {
    atlasState.error = "Add the Atlas project ID and API keys, then you can create clusters in this project.";
  } else {
    const projectIds = Array.from(new Set([projectId, ...(config.atlas?.managedProjects || []).map(project => project.projectId)]));
    const responses = await Promise.all(projectIds.map(id => projectClusters({...atlas, projectId: id})));
    const failed = responses.find(response => response.status >= 300);
    const listed = failed || {status: 200, body: {results: responses.flatMap(response => response.body.results)}};
    if (listed.status >= 300) {
      atlasState.error = listed.body?.detail || listed.body?.reason || `Atlas returned ${listed.status}`;
    } else {
      atlasState.reachable = true;
      atlasState.clusters = listed.body?.results || [];
      const access = await atlasRequest<AtlasAccessList & AtlasError>(atlas, "GET", `/groups/${projectId}/accessList?itemsPerPage=100`);
      if (access.status < 300) {
        atlasState.networkAccess = (access.body?.results || []).map(entry => ({
          cidr: entry.cidrBlock || (entry.ipAddress ? `${entry.ipAddress}/32` : ""),
          comment: entry.comment || ""
        }));
      }
    }
  }
  const template = (config.environments || []).find(environment => environment.environment === settings.sourceEnvironmentName);
  const templateUsage = rows.find(row => row.environment === settings.sourceEnvironmentName);
  const templateCollections = templateUsage?.collections ?? NEW_ENVIRONMENT_COLLECTION_HEADROOM;
  const templateIndexes = templateUsage?.indexes ?? NEW_ENVIRONMENT_INDEX_HEADROOM;
  const rolledUp = rollupClusters(atlasState.clusters, rows, defaultCluster, templateCollections, templateIndexes);
  const health = atlasState.reachable ? await clusterHealth(atlas, rolledUp, ConnectionWindow.LAST_DAY, true).catch(() => new Map<string, AtlasClusterHealth>()) : new Map<string, AtlasClusterHealth>();
  const ghosts = await import("./atlas-ghost-databases").then(module => module.atlasGhostDatabases()).catch(error => {
    debugLog("ghost databases: %s", error?.message || error);
    return [] as AtlasGhostDatabase[];
  });
  const leftoverLogins = atlasState.reachable ? await import("./atlas-ghost-databases").then(module => module.atlasLeftoverLogins(rolledUp)).catch(error => {
    debugLog("leftover logins: %s", error?.message || error);
    return [] as AtlasLeftoverLogin[];
  }) : [];
  const clusters = rolledUp.map(cluster => withGhostDatabases({...cluster, ...(health.get(cluster.host) || {load: null, connections: null, alerts: []}), leftoverLogins: leftoverLogins.filter(login => login.cluster === cluster.host)}, ghosts, templateCollections, templateIndexes));
  const registrationCluster = defaultCluster || template?.mongo?.cluster || "";
  const registration = clusters.find(cluster => cluster.host === registrationCluster);
  const registrationBlocked = !!registration && !registration.canAddEnvironment;
  const environments = rows.map(row => {
    const cluster = clusters.find(candidate => candidate.host === row.cluster);
    return {
      ...row,
      projectId: cluster?.projectId || row.projectId || "",
      clusterName: cluster?.inProvisioningProject ? cluster.name : (row.clusterName || "")
    };
  }).sort((left, right) => left.environment.localeCompare(right.environment));
  return {
    projectId,
    defaultCluster,
    keysConfigured,
    atlasReachable: atlasState.reachable,
    atlasError: atlasState.error,
    networkAccess: atlasState.networkAccess,
    clusters,
    environments,
    registrationCluster,
    registrationBlocked,
    registrationBlockReason: registrationBlocked ? registration.limitHeadline : null
  };
}

export async function assertClusterHasCapacityForNewEnvironment(cluster: string): Promise<void> {
  const view = await atlasClusterView();
  const row = view.clusters.find(candidate => candidate.host === cluster);
  if (!cluster) {
    throw new Error("No MongoDB cluster is set for new sites. Open Environment management → MongoDB Atlas, create a cluster, and set it as the default for new sites.");
  } else if (row && !row.canAddEnvironment) {
    throw new Error(`${row.limitHeadline} Open Environment management → MongoDB Atlas and create a cluster for new sites.`);
  } else if (!row) {
    debugLog("capacity: cluster %s is not in the occupancy list; allowing create", cluster);
  }
}

export async function saveAtlasProvisioning(patch: Partial<AtlasConfig>): Promise<AtlasConfig> {
  const document = await configController.queryKey(ConfigKey.ENVIRONMENTS);
  const current: EnvironmentsConfig = document?.value || {environments: []};
  const atlas: AtlasConfig = {...(current.atlas || {})};
  if (patch.projectId !== undefined) {
    atlas.projectId = patch.projectId;
  }
  if (patch.defaultCluster !== undefined) {
    atlas.defaultCluster = patch.defaultCluster;
  }
  await configController.createOrUpdateKey(ConfigKey.ENVIRONMENTS, {...current, atlas});
  return atlas;
}

function atlasFailure(action: string, status: number, error: AtlasError | null): Error {
  return new Error(`MongoDB Atlas would not ${action} (${status}${error?.errorCode ? ` ${error.errorCode}` : ""}): ${error?.detail || error?.reason || "no detail given"}`);
}

async function requestClusterCreate(atlas: AtlasApiAccess, name: string, tier: AtlasClusterTier, region: AwsRegion): Promise<AtlasResponse<AtlasClusterDescription & AtlasError>> {
  if (tier === AtlasClusterTier.FLEX) {
    const created = await atlasRequest<AtlasFlexClusterDescription & AtlasError>(atlas, "POST", `/groups/${atlas.projectId}/flexClusters`, atlasFlexClusterCreateBody(name, region), AtlasApiVersion.FLEX_CLUSTERS);
    return created.status >= 300 ? created : {status: created.status, body: clusterDescriptionFromFlex(created.body || {})};
  } else {
    return atlasRequest<AtlasClusterDescription & AtlasError>(atlas, "POST", `/groups/${atlas.projectId}/clusters`, atlasClusterCreateBody(name, tier, region), AtlasApiVersion.CLUSTERS);
  }
}

export async function createAtlasCluster(request: AtlasClusterCreateRequest): Promise<{cluster: AtlasClusterRow | null; message: string}> {
  const atlas = await platformAtlasAccess();
  if (!atlas.projectId) {
    throw new Error("Add the Atlas project ID under Environment management → MongoDB Atlas before creating a cluster.");
  } else if (!atlas.publicKey || !atlas.privateKey) {
    throw new Error("Add the Atlas API keys under Environment management → Global settings → MongoDB Atlas before creating a cluster.");
  } else if (!request?.name?.trim()) {
    throw new Error("Enter a cluster name. Use letters, numbers and hyphens only.");
  } else if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(request.name.trim())) {
    throw new Error("Cluster names must start with a letter or number, use only letters, numbers and hyphens, and be at most 64 characters.");
  } else if (![AtlasClusterTier.M0, AtlasClusterTier.FLEX, AtlasClusterTier.M10, AtlasClusterTier.M20, AtlasClusterTier.M30].includes(request.tier)) {
    throw new Error("Choose M0, Flex, M10, M20 or M30.");
  } else {
    const name = request.name.trim();
    const region = awsRegionFromAny(request.region) || AwsRegion.EU_WEST_1;
    if (region !== AwsRegion.EU_WEST_1 && region !== AwsRegion.EU_WEST_2) {
      throw new Error("Choose AWS Ireland or London.");
    } else if (request.tier === AtlasClusterTier.M0 && region === AwsRegion.EU_WEST_2) {
      throw new Error("Atlas does not offer a free M0 in AWS London. Choose Ireland.");
    } else if (request.tier === AtlasClusterTier.FLEX && region === AwsRegion.EU_WEST_2) {
      throw new Error("Atlas does not offer Flex in AWS London. Choose Ireland, or a dedicated tier for London.");
    }
    const targetAtlas = request.separateProject ? await atlasProjectForCluster(atlas, name) : atlas;
    const created = await requestClusterCreate(targetAtlas, name, request.tier, region);
    if (created.status >= 300) {
      throw atlasFailure("create the cluster", created.status, created.body);
    } else {
      if (request.allowAllNetworkAccess) {
        await allowAllAtlasNetworkAccess(targetAtlas);
      }
      const host = clusterHostFromSrv(created.body?.connectionStrings?.standardSrv || "");
      if (request.setAsDefault && host) {
        await saveAtlasProvisioning({defaultCluster: host});
      }
      const view = await atlasClusterView();
      const cluster = view.clusters.find(candidate => candidate.name === name || candidate.host === host) || null;
      const waiting = created.body?.stateName && created.body.stateName !== AtlasClusterState.IDLE
        ? " Atlas is still building it; refresh this page until the state is idle, then set it as the default for new sites if you have not already."
        : "";
      return {cluster, message: `Cluster ${name} has been requested.${waiting}`};
    }
  }
}

export async function deleteAtlasCluster(request: AtlasClusterDeleteRequest): Promise<{message: string}> {
  const view = await atlasClusterView();
  const cluster = view.clusters.find(candidate => candidate.name === request?.name && candidate.projectId === request?.projectId) || null;
  if (!view.atlasReachable) {
    throw new Error(view.atlasError || "Atlas could not be reached, so nothing was deleted.");
  } else if (!cluster) {
    throw new Error(`Atlas no longer lists cluster ${request?.name || ""}. Refresh this page. If it is still in Atlas, it is not a cluster this page manages.`);
  } else if (!cluster.inProvisioningProject || !cluster.projectId) {
    throw new Error(`Cluster ${cluster.name} is not a cluster this page created, so nothing was deleted.`);
  } else if (cluster.isDefault) {
    throw new Error(`Cluster ${cluster.name} is the default for new sites. Choose another default before deleting it.`);
  } else if (cluster.environmentCount > 0) {
    throw new Error(`Cluster ${cluster.name} still holds ${cluster.environmentNames}. Move those sites with Environment Migration before deleting it.`);
  }
  const environments = (await configuredEnvironments()).environments || [];
  const unreadable = environments.filter(environment => {
    const stored = storedMongoUri(environment);
    return stored.present && !stored.parsed;
  }).map(environment => environment.environment);
  const connected = environments.filter(environment => storedMongoUri(environment).parsed?.cluster === cluster.host).map(environment => environment.environment);
  if (unreadable.length > 0) {
    throw new Error(`The stored MONGODB_URI for ${unreadable.join(", ")} cannot be read, so it is not certain that no site uses ${cluster.name}. Correct it before deleting a cluster.`);
  } else if (connected.length > 0) {
    throw new Error(`${connected.join(", ")} still connects to ${cluster.name} through its stored MONGODB_URI. Move the site with Environment Migration before deleting the cluster.`);
  } else {
    const atlas = await platformAtlasAccess();
    const projectAtlas = {...atlas, projectId: cluster.projectId};
    const name = encodeURIComponent(cluster.name);
    const deleted = cluster.instanceSize === AtlasClusterTier.FLEX
      ? await atlasRequest<AtlasError>(projectAtlas, "DELETE", `/groups/${cluster.projectId}/flexClusters/${name}`, null, AtlasApiVersion.FLEX_CLUSTERS)
      : await atlasRequest<AtlasError>(projectAtlas, "DELETE", `/groups/${cluster.projectId}/clusters/${name}`, null, AtlasApiVersion.CLUSTERS);
    if (deleted.status === 404) {
      return {message: `Cluster ${cluster.name} is already gone from Atlas.`};
    } else if (deleted.status >= 300) {
      throw atlasFailure("delete the cluster", deleted.status, deleted.body);
    } else {
      return {message: `Cluster ${cluster.name} is being deleted. It disappears from this page once Atlas has finished.`};
    }
  }
}

async function allowAllAtlasNetworkAccess(atlas: AtlasApiAccess): Promise<void> {
  const created = await atlasRequest<AtlasError>(atlas, "POST", `/groups/${atlas.projectId}/accessList`, [{
    cidrBlock: "0.0.0.0/0",
    comment: "NGX Fly apps and operators"
  }]);
  if (created.status >= 300 && created.status !== 409) {
    throw atlasFailure("add network access", created.status, created.body);
  }
}

export async function allowAtlasNetworkAccess(): Promise<{message: string}> {
  const atlas = await platformAtlasAccess();
  if (!atlas.projectId || !atlas.publicKey || !atlas.privateKey) {
    throw new Error("Add the Atlas project ID and API keys before changing network access.");
  } else {
    await allowAllAtlasNetworkAccess(atlas);
    return {message: "Atlas will now accept connections from Fly and from this app. You can tighten this later if you add a private network."};
  }
}

export function registrationMongoCluster(config: EnvironmentsConfig, templateCluster: string): string {
  return config.atlas?.defaultCluster || templateCluster || "";
}
