export enum AtlasApiVersion {
  DEFAULT = "2023-01-01",
  CLUSTERS = "2023-02-01",
  FLEX_CLUSTERS = "2024-11-13",
  PROJECT_USERS = "2025-02-19"
}

export interface AtlasProjectUser {
  id?: string;
  username?: string;
  roles?: string[];
}

export interface AtlasProjectUserList {
  results?: AtlasProjectUser[];
}

export interface AtlasProjectTeam {
  teamId?: string;
  roleNames?: string[];
}

export interface AtlasProjectTeamList {
  results?: AtlasProjectTeam[];
}

export interface AtlasProjectAccessResult {
  projectId: string;
  addedUsers: string[];
  addedTeams: string[];
  failures: string[];
}

export interface AtlasApiAccess {
  projectId?: string;
  publicKey?: string;
  privateKey?: string;
}

export interface AtlasDatabaseUserRole {
  databaseName?: string;
  roleName?: string;
}

export interface AtlasDatabaseUser {
  username?: string;
  roles?: AtlasDatabaseUserRole[];
}

export interface CreatedEnvironmentMongoUser {
  username: string;
  password: string;
}

export interface AtlasResponse<T> {
  status: number;
  body: T | null;
}

export interface AtlasError {
  errorCode?: string;
  detail?: string;
  reason?: string;
}

export interface AtlasProjectDescription {
  id?: string;
  name?: string;
  orgId?: string;
}

export interface AtlasClusterDescription {
  groupId?: string;
  name?: string;
  stateName?: string;
  connectionStrings?: {standardSrv?: string};
  replicationSpecs?: {regionConfigs?: {electableSpecs?: {instanceSize?: string}; providerName?: string; backingProviderName?: string; regionName?: string}[]}[];
}

export interface AtlasClusterList {
  results?: AtlasClusterDescription[];
}

export interface AtlasFlexClusterDescription {
  groupId?: string;
  name?: string;
  stateName?: string;
  connectionStrings?: {standardSrv?: string};
  providerSettings?: {backingProviderName?: string; providerName?: string; regionName?: string};
}

export interface AtlasFlexClusterList {
  results?: AtlasFlexClusterDescription[];
}

export interface AtlasAccessList {
  results?: {cidrBlock?: string; ipAddress?: string; comment?: string}[];
}

export interface AtlasProcess {
  id?: string;
  hostname?: string;
  userAlias?: string;
  typeName?: string;
}

export interface AtlasProcessList {
  results?: AtlasProcess[];
}

export interface AtlasMeasurementDataPoint {
  timestamp?: string;
  value?: number | null;
}

export interface AtlasMeasurement {
  name?: string;
  dataPoints?: AtlasMeasurementDataPoint[];
}

export interface AtlasMeasurements {
  measurements?: AtlasMeasurement[];
}

export interface AtlasAlertDescription {
  id?: string;
  clusterName?: string;
  metricName?: string;
  eventTypeName?: string;
  status?: string;
  created?: string;
  resolved?: string;
  currentValue?: {number?: number; units?: string};
}

export interface AtlasAlertList {
  results?: AtlasAlertDescription[];
}

export enum MigrationLoginSlot {
  A = "a",
  B = "b"
}

export interface AtlasDatabaseUserList {
  results?: AtlasDatabaseUser[];
}

export interface ProjectLogin {
  projectId: string;
  username: string;
  database?: string | null;
}
