import { FlyMachineMode } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";

export interface FlyConfig {
  apiToken: string;
  appName: string;
}

export interface FlyRuntimeConfig extends FlyConfig {
  machineId: string;
  organisation: string;
}

export interface FlyMetricSeriesDefinition {
  label: string;
  dashed?: boolean;
  scale: number;
  promQuery: (appName: string, machineId: string, rateWindowSeconds: number) => string;
}

export interface FlyMetricDefinition {
  key: string;
  unit: string;
  series: FlyMetricSeriesDefinition[];
}

export interface FlyAppDetailsResponse {
  organization?: { slug: string };
}

export interface FlyMachineSummary {
  id: string;
  state: string;
  updated_at?: string;
  config?: Record<string, unknown>;
}

export enum FlyDeployStrategy {
  IMMEDIATE = "immediate",
  ROLLING = "rolling"
}

export interface FlyAppDeployment {
  appName: string;
  configPath: string;
  scaleCount: number;
  image?: string;
  memory?: string;
  remoteOnly?: boolean;
  strategy?: FlyDeployStrategy;
}

export interface FlyAppConfigOptions {
  nativeMailTls: boolean;
  flyMachines: FlyMachineMode;
  memory?: string | null;
}

export interface FlyMachineTarget {
  imageTag?: string;
  imageDigest?: string;
  releaseVersion?: string;
}

export interface FlyMachineEstate extends FlyMachineTarget {
  scaleCount: number;
}

export interface FlyMachineRelease {
  ImageRef?: string;
  Status?: string;
  Version?: number;
}

export interface FlyMachineListItem {
  id: string;
  name?: string;
  state?: string;
  config?: {
    image?: string;
    guest?: {memory_mb?: number};
    metadata?: { fly_process_group?: string; fly_release_version?: string };
  };
  image_ref?: {
    repository?: string;
    tag?: string;
    digest?: string;
  };
}

export interface FlySecureConfig {
  apiToken: string;
  appName?: string;
}

export interface FlyRestartResult {
  ok: boolean;
  error?: string;
  secretsVersion?: number;
}

export interface PrometheusResult {
  metric: Record<string, string>;
  value: [number, string];
}

export interface PrometheusResponse {
  status: string;
  data: { result: PrometheusResult[] };
}

export interface PrometheusRangeResult {
  metric: Record<string, string>;
  values: [number, string][];
}

export interface PrometheusRangeResponse {
  status: string;
  data: { result: PrometheusRangeResult[] };
}

export interface CertificateInfo {
  hostname: string;
  clientStatus: string;
  issued: { type: string; expiresAt: string }[];
  dnsValidationHostname?: string;
  dnsValidationTarget?: string;
  dnsValidationInstructions?: string;
  acmeDnsConfigured?: boolean;
  acmeAlpnConfigured?: boolean;
  configured?: boolean;
}

export interface AppIpAddresses {
  ipv4: string | null;
  ipv6: string | null;
}

export interface StreamingCommandResult {
  exitCode: number;
  output: string;
}

export enum IpAddressType {
  V4 = "v4",
  V6 = "v6",
  SharedV4 = "shared_v4",
  PrivateV6 = "private_v6",
}

export interface FlyImageQueryResponse {
  data?: {
    app?: {
      image?: { id?: string; digest?: string; ref?: string };
    };
  };
}
