export interface SecretsConfig {
  [key: string]: string;
}

export interface MongoConfig {
  cluster: string;
  db: string;
  username: string;
  password: string;
}

export interface EnvironmentConfig {
  name: string;
  apiKey: string;
  appName: string;
  memory: string;
  scaleCount: number;
  organisation: string;
  nativeMailTls?: boolean;
  mongo?: MongoConfig;
}

export interface NewEnvironmentConfig extends EnvironmentConfig {
  secrets: SecretsConfig;
}

export interface DeploymentConfig {
  environments: EnvironmentConfig[];
  dockerImage: string;
  region: string;
}

export interface RuntimeConfig {
  currentDir: string;
  targetEnvironments: string[];
}

export interface VolumeInformation {
  id: string;
  region: string;
  attachedVM: string;
  reachable: boolean;
}

export interface BackupOptions {
  env: string;
  db?: string;
  collections?: string;
  scaleDown: boolean;
  upload: boolean;
}

export interface RestoreOptions {
  env: string;
  from: string;
  db?: string;
  collections?: string;
  drop: boolean;
  dryRun: boolean;
}

export enum PackageManager {
  NPM = "npm",
  PNPM = "pnpm"
}

export interface EstateHealthResult {
  environment: string;
  url: string;
  healthy: boolean;
  detail: string;
}
