import { AwsRegion, EnvironmentSiteLink } from "./environment-config.model";

export enum AtlasClusterSortField {
  DEFAULT_FOR_NEW_SITES = "isDefault",
  NAME = "name",
  HOST = "host",
  SIZE = "instanceSize",
  ENVIRONMENTS = "environmentNames",
  COLLECTIONS = "collectionCount"
}

export enum AtlasEnvironmentSortField {
  ENVIRONMENT = "environment",
  CLUSTER = "cluster",
  DATABASE = "database",
  COLLECTIONS = "collections"
}

export enum EmptyCollectionCleanupSortField {
  CONTENT_COLLECTION_COUNT = "contentCollectionCount",
  ENVIRONMENT = "environment",
  CLUSTER = "cluster",
  DATABASE = "database",
  COLLECTION_COUNT = "collectionCount"
}

export enum AtlasClusterTier {
  M0 = "M0",
  M10 = "M10",
  M20 = "M20",
  M30 = "M30",
  FLEX = "FLEX",
  UNKNOWN = "UNKNOWN"
}

export enum AtlasClusterState {
  IDLE = "IDLE",
  CREATING = "CREATING",
  UPDATING = "UPDATING",
  REPAIRING = "REPAIRING",
  DELETING = "DELETING",
  DELETED = "DELETED",
  UNKNOWN = "UNKNOWN"
}

export enum EnvironmentAtlasTab {
  CLUSTERS = "clusters",
  NEW_CLUSTER = "new-cluster",
  ENVIRONMENTS = "environments",
  PROVISIONING = "provisioning"
}

export const ATLAS_M0_MAX_COLLECTIONS = 500;
export const ATLAS_M0_MAX_DATABASES = 100;
export const NEW_ENVIRONMENT_COLLECTION_HEADROOM = 80;
export const NEW_ENVIRONMENT_INDEX_HEADROOM = 160;
export const ATLAS_CLUSTER_BUSY_DATABASE_COUNT = 6;

export const ATLAS_RECOMMENDED_COLLECTION_AND_INDEX_LIMIT: Record<AtlasClusterTier, number | null> = {
  [AtlasClusterTier.M0]: null,
  [AtlasClusterTier.FLEX]: null,
  [AtlasClusterTier.M10]: 5000,
  [AtlasClusterTier.M20]: 10000,
  [AtlasClusterTier.M30]: 10000,
  [AtlasClusterTier.UNKNOWN]: null
};

const MEGABYTE = 1024 * 1024;

export const ATLAS_STORAGE_LIMIT_BYTES: Record<AtlasClusterTier, number | null> = {
  [AtlasClusterTier.M0]: 512 * MEGABYTE,
  [AtlasClusterTier.FLEX]: 5 * 1024 * MEGABYTE,
  [AtlasClusterTier.M10]: null,
  [AtlasClusterTier.M20]: null,
  [AtlasClusterTier.M30]: null,
  [AtlasClusterTier.UNKNOWN]: null
};

export enum ClusterFullnessLevel {
  OK = "ok",
  FILLING = "filling",
  FULL = "full"
}

export interface ClusterFullnessMeasure {
  percent: number;
  level: ClusterFullnessLevel;
  label: string;
}

export interface ClusterFullness {
  collections: ClusterFullnessMeasure;
  storage: ClusterFullnessMeasure | null;
  load: ClusterFullnessMeasure | null;
  loadNote: string;
  connections: ClusterFullnessMeasure | null;
  connectionsNote: string;
}

export const ATLAS_CONNECTION_LIMIT: Record<AtlasClusterTier, number | null> = {
  [AtlasClusterTier.M0]: 500,
  [AtlasClusterTier.FLEX]: 500,
  [AtlasClusterTier.M10]: 1500,
  [AtlasClusterTier.M20]: 3000,
  [AtlasClusterTier.M30]: 3000,
  [AtlasClusterTier.UNKNOWN]: null
};

export const ATLAS_CONNECTION_WARNING_PERCENT = 70;
export const ATLAS_ALERT_HISTORY_DAYS = 7;

export enum AtlasAlertMetric {
  CONNECTIONS_PERCENT = "CONNECTIONS_PERCENT",
  CONNECTIONS = "CONNECTIONS"
}

export enum AtlasAlertStatus {
  OPEN = "OPEN",
  TRACKING = "TRACKING",
  CLOSED = "CLOSED"
}

export const ATLAS_THROUGHPUT_LIMIT_OPS_PER_SECOND: Record<AtlasClusterTier, number | null> = {
  [AtlasClusterTier.M0]: 100,
  [AtlasClusterTier.FLEX]: 500,
  [AtlasClusterTier.M10]: null,
  [AtlasClusterTier.M20]: null,
  [AtlasClusterTier.M30]: null,
  [AtlasClusterTier.UNKNOWN]: null
};

export const FLEX_PRICE_BANDS: {upToOpsPerSecond: number; monthlyDollars: number}[] = [
  {upToOpsPerSecond: 100, monthlyDollars: 8},
  {upToOpsPerSecond: 200, monthlyDollars: 15},
  {upToOpsPerSecond: 300, monthlyDollars: 21},
  {upToOpsPerSecond: 400, monthlyDollars: 26},
  {upToOpsPerSecond: 500, monthlyDollars: 30}
];

export function flexMonthlyDollars(opsPerSecond: number): number {
  return (FLEX_PRICE_BANDS.find(band => opsPerSecond <= band.upToOpsPerSecond) || FLEX_PRICE_BANDS[FLEX_PRICE_BANDS.length - 1]).monthlyDollars;
}

function opsPerSecondText(value: number): string {
  return value < 10 ? value.toFixed(1) : Math.round(value).toString();
}

function clusterLoadSummary(cluster: AtlasClusterRow): {load: ClusterFullnessMeasure | null; loadNote: string} {
  const load = cluster.load;
  const limit = ATLAS_THROUGHPUT_LIMIT_OPS_PER_SECOND[cluster.instanceSize];
  if (!load) {
    const note = cluster.instanceSize === AtlasClusterTier.FLEX
      ? "Atlas shows Flex load only on the cluster's Metrics page in Atlas, not through its API"
      : cluster.inProvisioningProject ? "Load not available from Atlas" : "";
    return {load: null, loadNote: note};
  } else {
    const busiest = `Busiest hour ${opsPerSecondText(load.peakOpsPerSecond)} ops/s`;
    const band = cluster.instanceSize === AtlasClusterTier.FLEX ? ` · $${flexMonthlyDollars(load.peakOpsPerSecond)}/month band` : "";
    const average = `average ${opsPerSecondText(load.averageOpsPerSecond)} ops/s over 24 hours`;
    return limit
      ? {load: fullnessMeasure(load.peakOpsPerSecond, limit, `${busiest} of ${limit}`), loadNote: `${average}${band}`}
      : {load: null, loadNote: `${busiest}, ${average}`};
  }
}

function fullnessMeasure(used: number, limit: number, label: string): ClusterFullnessMeasure {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const level = percent >= 85 ? ClusterFullnessLevel.FULL : percent >= 70 ? ClusterFullnessLevel.FILLING : ClusterFullnessLevel.OK;
  return {percent, level, label};
}

function megabytes(bytes: number): string {
  const value = bytes / MEGABYTE;
  return value >= 1024 ? `${(value / 1024).toFixed(1)} GB` : `${value.toFixed(value < 10 ? 1 : 0)} MB`;
}

export function connectionPercent(cluster: Pick<AtlasClusterRow, "instanceSize" | "connections">): number | null {
  const limit = ATLAS_CONNECTION_LIMIT[cluster.instanceSize];
  return limit && cluster.connections ? Math.round((cluster.connections.peak / limit) * 100) : null;
}

export function connectionsNearLimit(cluster: Pick<AtlasClusterRow, "instanceSize" | "connections">): boolean {
  const limit = ATLAS_CONNECTION_LIMIT[cluster.instanceSize];
  return !!limit && !!cluster.connections && cluster.connections.peak * 100 >= limit * ATLAS_CONNECTION_WARNING_PERCENT;
}

export function atlasAlertLabel(alert: AtlasClusterAlert): string {
  if (alert.metricName === AtlasAlertMetric.CONNECTIONS_PERCENT || alert.metricName === AtlasAlertMetric.CONNECTIONS) {
    return "Connections near the limit";
  } else {
    return (alert.metricName || alert.eventTypeName || "Atlas alert").toLowerCase().replace(/_/g, " ").replace(/^./, first => first.toUpperCase());
  }
}

export function openAtlasAlerts(cluster: Pick<AtlasClusterRow, "alerts">): AtlasClusterAlert[] {
  return (cluster.alerts || []).filter(alert => alert.status !== AtlasAlertStatus.CLOSED);
}

function clusterConnectionsSummary(cluster: AtlasClusterRow): {connections: ClusterFullnessMeasure | null; connectionsNote: string} {
  const connections = cluster.connections;
  const limit = ATLAS_CONNECTION_LIMIT[cluster.instanceSize];
  if (!connections || !limit) {
    return {connections: null, connectionsNote: ""};
  } else {
    return {
      connections: fullnessMeasure(connections.peak, limit, `Busiest minute ${connections.peak} of ${limit} connections`),
      connectionsNote: `${connections.current} connections now, busiest over the last 24 hours`
    };
  }
}

export function clusterFullness(cluster: AtlasClusterRow): ClusterFullness {
  const recommended = ATLAS_RECOMMENDED_COLLECTION_AND_INDEX_LIMIT[cluster.instanceSize];
  const collections = recommended
    ? fullnessMeasure(cluster.collectionCount + cluster.indexCount, recommended, `${cluster.collectionCount + cluster.indexCount} of ${recommended} collections and indexes`)
    : fullnessMeasure(cluster.collectionCount, ATLAS_M0_MAX_COLLECTIONS, `${cluster.collectionCount} of ${ATLAS_M0_MAX_COLLECTIONS} collections`);
  const storageLimit = ATLAS_STORAGE_LIMIT_BYTES[cluster.instanceSize];
  const storage = storageLimit
    ? fullnessMeasure(cluster.dataSizeBytes || 0, storageLimit, `${megabytes(cluster.dataSizeBytes || 0)} of ${megabytes(storageLimit)} storage`)
    : null;
  return {collections, storage, ...clusterLoadSummary(cluster), ...clusterConnectionsSummary(cluster)};
}

export interface AtlasNetworkAccessEntry {
  cidr: string;
  comment: string;
}

export interface AtlasClusterEnvironmentRow {
  environment: string;
  siteUrl: string;
  cluster: string;
  clusterName?: string;
  projectId?: string;
  database: string;
  username: string;
  collections: number | null;
  indexes: number | null;
  dataSizeBytes: number | null;
  error: string | null;
}

export interface AtlasClusterLoad {
  averageOpsPerSecond: number;
  peakOpsPerSecond: number;
}

export interface AtlasClusterConnections {
  current: number;
  peak: number;
  peakAt: string | null;
}

export interface AtlasClusterAlert {
  id: string;
  metricName: string | null;
  eventTypeName: string | null;
  status: AtlasAlertStatus | string;
  created: string;
  resolved: string | null;
  currentValue: number | null;
}

export interface AtlasClusterRow {
  projectId?: string;
  name: string;
  host: string;
  instanceSize: AtlasClusterTier;
  region: string;
  stateName: AtlasClusterState;
  inProvisioningProject: boolean;
  isDefault: boolean;
  environmentCount: number;
  environmentNames?: string;
  sites?: EnvironmentSiteLink[];
  collectionCount: number;
  indexCount: number;
  databaseCount: number;
  dataSizeBytes: number;
  load?: AtlasClusterLoad | null;
  connections?: AtlasClusterConnections | null;
  alerts?: AtlasClusterAlert[];
  ghostDatabases?: AtlasGhostDatabase[];
  leftoverLogins?: AtlasLeftoverLogin[];
  canAddEnvironment: boolean;
  limitHeadline: string;
}

export interface AtlasClusterView {
  projectId: string;
  defaultCluster: string;
  keysConfigured: boolean;
  atlasReachable: boolean;
  atlasError: string | null;
  networkAccess: AtlasNetworkAccessEntry[];
  clusters: AtlasClusterRow[];
  environments: AtlasClusterEnvironmentRow[];
  registrationCluster: string;
  registrationBlocked: boolean;
  registrationBlockReason: string | null;
}

export interface AtlasClusterCreateRequest {
  separateProject?: boolean;
  name: string;
  tier: AtlasClusterTier;
  region: AwsRegion;
  setAsDefault: boolean;
  allowAllNetworkAccess: boolean;
}

export interface AtlasClusterDeleteRequest {
  projectId: string;
  name: string;
}

export function clusterCanBeDeleted(cluster: AtlasClusterRow, provisioningProjectId: string): boolean {
  return !!provisioningProjectId && !!cluster.projectId && cluster.inProvisioningProject && !cluster.isDefault && cluster.environmentCount === 0;
}

export function clusterAcceptsMigratedSite(cluster: AtlasClusterRow, provisioningProjectId: string): boolean {
  return !!cluster.host && cluster.inProvisioningProject && cluster.canAddEnvironment && (cluster.projectId === provisioningProjectId || cluster.environmentCount > 0);
}

export function atlasTierFromInstanceSize(instanceSize: string | null | undefined): AtlasClusterTier {
  const size = (instanceSize || "").toUpperCase();
  if (size === AtlasClusterTier.M0) {
    return AtlasClusterTier.M0;
  } else if (size === AtlasClusterTier.M10) {
    return AtlasClusterTier.M10;
  } else if (size === AtlasClusterTier.M20) {
    return AtlasClusterTier.M20;
  } else if (size === AtlasClusterTier.M30) {
    return AtlasClusterTier.M30;
  } else if (size === AtlasClusterTier.FLEX || size === "M2" || size === "M5") {
    return AtlasClusterTier.FLEX;
  } else {
    return AtlasClusterTier.UNKNOWN;
  }
}

export const SHARED_SITES_CLUSTER_PREFIX = "ngx-shared-sites-";

export function nextSharedSitesClusterName(clusterNames: string[]): string {
  const numbers = clusterNames
    .map(name => name.match(new RegExp(`^${SHARED_SITES_CLUSTER_PREFIX}(\\d+)$`))?.[1])
    .filter(match => !!match)
    .map(match => parseInt(match, 10));
  const next = numbers.length ? Math.max(...numbers) + 1 : 1;
  return `${SHARED_SITES_CLUSTER_PREFIX}${String(next).padStart(2, "0")}`;
}

export function atlasTierLabel(tier: AtlasClusterTier): string {
  if (tier === AtlasClusterTier.FLEX) {
    return "Flex";
  } else if (tier === AtlasClusterTier.UNKNOWN) {
    return "—";
  } else {
    return tier;
  }
}

export function isSharedTier(tier: AtlasClusterTier): boolean {
  return tier === AtlasClusterTier.M0 || tier === AtlasClusterTier.FLEX;
}

export function clusterCapacity(instanceSize: AtlasClusterTier, collections: number, indexes: number, databases: number, newEnvironmentCollections = NEW_ENVIRONMENT_COLLECTION_HEADROOM, newEnvironmentIndexes = NEW_ENVIRONMENT_INDEX_HEADROOM): {canAdd: boolean; headline: string} {
  const nextCollections = collections + newEnvironmentCollections;
  const nextCombined = collections + indexes + newEnvironmentCollections + newEnvironmentIndexes;
  const recommended = ATLAS_RECOMMENDED_COLLECTION_AND_INDEX_LIMIT[instanceSize];
  if (isSharedTier(instanceSize)) {
    if (databases >= ATLAS_M0_MAX_DATABASES) {
      return {canAdd: false, headline: `M0 and Flex clusters allow ${ATLAS_M0_MAX_DATABASES} databases. Create another cluster before adding a site.`};
    } else if (nextCollections > ATLAS_M0_MAX_COLLECTIONS) {
      return {canAdd: false, headline: `M0 and Flex clusters allow ${ATLAS_M0_MAX_COLLECTIONS} collections in total. This cluster has ${collections}, and the registration template has ${newEnvironmentCollections} collections. Create another cluster.`};
    } else {
      return {canAdd: true, headline: `${collections} of ${ATLAS_M0_MAX_COLLECTIONS} collections used. The registration template has ${newEnvironmentCollections} collections.`};
    }
  } else if (recommended) {
    if (nextCombined > recommended) {
      return {canAdd: false, headline: `${instanceSize} is rated for about ${recommended} collections and indexes together. This cluster has ${collections + indexes}. Create another cluster.`};
    } else {
      return {canAdd: true, headline: `${collections + indexes} of about ${recommended} collections and indexes used.`};
    }
  } else if (nextCollections > ATLAS_M0_MAX_COLLECTIONS) {
    return {canAdd: false, headline: `This cluster already has ${collections} collections. Free Atlas clusters stop at ${ATLAS_M0_MAX_COLLECTIONS}. Create another cluster before adding a site.`};
  } else {
    return {canAdd: true, headline: `${collections} collections on this cluster.`};
  }
}

export interface AtlasClusterHealth {
  load: AtlasClusterLoad | null;
  connections: AtlasClusterConnections | null;
  alerts: AtlasClusterAlert[];
}

export enum ConnectionWindow {
  LAST_DAY = "P1D",
  LAST_QUARTER_HOUR = "PT15M"
}

export interface AtlasGhostDatabase {
  migrationId: string;
  environment: string;
  cluster: string;
  database: string;
  oldUsername: string;
  movedTo: string;
  movedAt: string | null;
  collections: number | null;
}

export interface AtlasGhostDatabaseDeleteRequest {
  migrationId: string;
  confirmDatabase: string;
}

export interface AtlasLeftoverLogin {
  projectId: string;
  username: string;
  environment: string | null;
  database: string | null;
  cluster: string;
}

export interface AtlasLeftoverLoginDeleteRequest {
  projectId: string;
  username: string;
}

export interface AtlasLeftoverLoginGroup {
  environment: string;
  logins: AtlasLeftoverLogin[];
}

export function ghostDatabaseLogins(cluster: AtlasClusterRow, ghost: AtlasGhostDatabase): AtlasLeftoverLogin[] {
  return (cluster.leftoverLogins || []).filter(login => !!login.database && login.database === ghost.database);
}

export function spareLoginGroups(cluster: AtlasClusterRow): AtlasLeftoverLoginGroup[] {
  const ghostDatabases = new Set((cluster.ghostDatabases || []).map(ghost => ghost.database));
  const spare = (cluster.leftoverLogins || []).filter(login => !login.database || !ghostDatabases.has(login.database));
  return Array.from(new Set(spare.map(login => login.environment || login.username)))
    .map(environment => ({environment, logins: spare.filter(login => (login.environment || login.username) === environment)}));
}

export enum AtlasCleanupKind {
  DATABASE = "database",
  LOGINS = "logins"
}

export interface AtlasCleanupItem {
  key: string;
  kind: AtlasCleanupKind;
  label: string;
  cluster: string;
  ghost: AtlasGhostDatabase | null;
  logins: AtlasLeftoverLogin[];
}

export interface AtlasCleanupAttempt {
  succeeded: boolean;
  message: string;
}

export interface AtlasCleanupOutcome {
  item: AtlasCleanupItem;
  succeeded: boolean;
  message: string;
}

export const ATLAS_CLEANUP_CONFIRMATION_WORD = "delete";

export function ghostCleanupItem(cluster: AtlasClusterRow, ghost: AtlasGhostDatabase): AtlasCleanupItem {
  return {key: `database:${ghost.migrationId}`, kind: AtlasCleanupKind.DATABASE, label: ghost.database, cluster: cluster.name, ghost, logins: ghostDatabaseLogins(cluster, ghost)};
}

export function loginsCleanupItem(cluster: AtlasClusterRow, group: AtlasLeftoverLoginGroup): AtlasCleanupItem {
  const count = group.logins.length;
  return {key: `logins:${cluster.host}/${group.environment}`, kind: AtlasCleanupKind.LOGINS, label: `${count} unused login${count === 1 ? "" : "s"} for ${group.environment}`, cluster: cluster.name, ghost: null, logins: group.logins};
}

export function cleanupSelectionSummary(items: AtlasCleanupItem[]): string {
  const databases = items.filter(item => item.kind === AtlasCleanupKind.DATABASE).length;
  const logins = items.filter(item => item.kind === AtlasCleanupKind.LOGINS).reduce((total, item) => total + item.logins.length, 0);
  return [
    databases ? `${databases} database${databases === 1 ? "" : "s"}` : null,
    logins ? `${logins} unused login${logins === 1 ? "" : "s"}` : null
  ].filter(part => !!part).join(" and ");
}

export function cleanupNeedsTypedConfirmation(items: AtlasCleanupItem[]): boolean {
  return items.some(item => item.kind === AtlasCleanupKind.DATABASE);
}
