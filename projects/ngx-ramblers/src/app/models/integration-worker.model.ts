import { RamblersUploadJob } from "./ramblers-upload-job.model";
import { SiteMigrationConfig } from "./migration-config.model";
import { MigrationResult } from "./migration-scraping.model";
import { ContentMetadata, ContentMetadataItem, ContentMetadataResizeRequest } from "./content-metadata.model";
import { ApiAction } from "./api-response.model";
import { ExportedGpxSummary, OsMapsListedRoute } from "./os-maps-export.model";
import { OsDataHubApiKey } from "./os-data-hub-api-key.model";
import {
  ContentMigrationProgress,
  ContentMigrationRequest,
  ContentMigrationResult,
  SystemConfig
} from "./system.model";
import {
  ResolvedAlbumImage,
  SocialNetwork,
  SocialPublishProgress,
  SocialPublishResult
} from "./social-publish.model";

export enum IntegrationWorkerEventType {
  STANDARD_OUT = "standard-out",
  TEST_STEP = "test-step",
  LIFECYCLE = "lifecycle",
  COMPLETE = "complete",
  ERROR = "error"
}

export enum UploadOutcome {
  COMPLETED = "completed",
  FAILED = "failed",
  STOPPED = "stopped"
}

export interface RamblersUploadCredentials {
  userName: string;
  password: string;
}

export interface IntegrationWorkerAwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface IntegrationWorkerReportUploadConfig {
  bucket: string;
  region: string;
  keyPrefix: string;
}

export interface IntegrationWorkerCallbackConfig {
  baseUrl: string;
  progressPath: string;
  resultPath: string;
}

export interface IntegrationWorkerJobRequest {
  job: RamblersUploadJob;
  encryptedCredentials: string;
  encryptedReportUploadCredentials?: string;
  reportUpload?: IntegrationWorkerReportUploadConfig;
  callback: IntegrationWorkerCallbackConfig;
}

export interface IntegrationWorkerJobResponse {
  jobId: string;
  queued: boolean;
  queuePosition: number;
  activeJobId: string | null;
  fileName?: string;
}

export interface IntegrationWorkerProgressCallbackRequest {
  jobId: string;
  type: IntegrationWorkerEventType.STANDARD_OUT | IntegrationWorkerEventType.TEST_STEP | IntegrationWorkerEventType.LIFECYCLE;
  payload: string;
}

export interface IntegrationWorkerResultCallbackRequest {
  jobId: string;
  type: IntegrationWorkerEventType.COMPLETE | IntegrationWorkerEventType.ERROR;
  payload?: string;
  status?: string;
  reportKeyPrefix?: string;
  reportBucket?: string;
  listedRoutes?: OsMapsListedRoute[];
  exportedGpx?: ExportedGpxSummary[];
  osDataHubApiKey?: OsDataHubApiKey;
}

export interface PublicSiteFetchRelay {
  url: string;
  secret: string;
}

export interface IntegrationWorkerMigrationJobRequest {
  jobId: string;
  siteConfig: SiteMigrationConfig;
  persistData: boolean;
  uploadTos3: boolean;
  callback: IntegrationWorkerCallbackConfig;
  publicSiteFetchRelay?: PublicSiteFetchRelay;
}

export enum IntegrationWorkerLogLevel {
  Info = "info",
  Error = "error",
}

export enum IntegrationWorkerResultStatus {
  Success = "success",
  Error = "error",
}

export interface IntegrationWorkerMigrationProgressCallback {
  jobId: string;
  level: IntegrationWorkerLogLevel;
  message: string;
}

export interface IntegrationWorkerMigrationResultCallback {
  jobId: string;
  status: IntegrationWorkerResultStatus;
  result?: MigrationResult;
  errorMessage?: string;
}

export interface IntegrationWorkerWalksManagerSyncJobRequest {
  jobId: string;
  environmentName: string;
  mongoUri: string;
  systemConfig: SystemConfig;
  fullSync: boolean;
  callback: IntegrationWorkerCallbackConfig;
}

export interface IntegrationWorkerWalksManagerSyncProgressCallback {
  jobId: string;
  percent: number;
  message: string;
}

export interface IntegrationWorkerWalksManagerSyncResult {
  added: number;
  updated: number;
  deleted: number;
  totalProcessed: number;
  errors: string[];
}

export interface IntegrationWorkerWalksManagerSyncResultCallback {
  jobId: string;
  status: IntegrationWorkerResultStatus;
  result?: IntegrationWorkerWalksManagerSyncResult;
  errorMessage?: string;
}

export enum PlaywrightWaitUntil {
  Load = "load",
  DomContentLoaded = "domcontentloaded",
  NetworkIdle = "networkidle",
  Commit = "commit",
}

export interface HtmlFetchResult {
  html: string;
  finalUrl: string;
  baseHref: string | null;
}

export interface DocumentConversionWorkerRequest {
  fileName: string;
  fileBase64: string;
}

export interface ConvertedDocumentImage {
  name: string;
  base64: string;
}

export interface DocumentConversionWorkerResponse {
  markdown: string;
  suggestedTitle: string;
  images: ConvertedDocumentImage[];
}

export enum ResizeImageMode {
  SAVED = "saved",
  UNSAVED = "unsaved"
}

export interface IntegrationWorkerResizeAwsConfig {
  bucket: string;
  region: string;
}

export interface IntegrationWorkerResizeJobRequest {
  jobId: string;
  mode: ResizeImageMode;
  resizeRequest: ContentMetadataResizeRequest;
  sourceContentMetadata?: ContentMetadata;
  awsConfig?: IntegrationWorkerResizeAwsConfig;
  encryptedAwsCredentials?: string;
  callback: IntegrationWorkerCallbackConfig;
}

export interface IntegrationWorkerResizeProgressCallback {
  jobId: string;
  level: IntegrationWorkerLogLevel;
  message: string;
  percent: number;
  queued?: boolean;
}

export interface IntegrationWorkerResizeResultCallback {
  jobId: string;
  status: IntegrationWorkerResultStatus;
  action?: ApiAction;
  contentMetadata?: ContentMetadata;
  outputItems?: ContentMetadataItem[];
  errorMessage?: string;
}

export interface IntegrationWorkerQueueJob {
  jobId: string;
  type: string;
  label: string;
}

export interface IntegrationWorkerQueueStatus {
  activeJob: IntegrationWorkerQueueJob | null;
  queuedJobs: IntegrationWorkerQueueJob[];
  workerConfigured?: boolean;
}

export interface IntegrationWorkerQueueCancelResult {
  cancelled: boolean;
  jobId?: string;
}

export interface IntegrationWorkerQueueClearResult {
  clearedCount: number;
  clearedJobs: IntegrationWorkerQueueJob[];
}

export interface IntegrationWorkerSocialPublishCredentials {
  facebookPageId?: string;
  facebookPageAccessToken?: string;
  facebookPublishingEnabled?: boolean;
  instagramUserId?: string;
  instagramPublishingEnabled?: boolean;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
}

export interface IntegrationWorkerSocialPublishAwsConfig {
  bucket: string;
  region: string;
}

export interface IntegrationWorkerSocialPublishNetworkImages {
  network: SocialNetwork;
  images: ResolvedAlbumImage[];
  imageNames: string[];
  caption: string;
}

export interface IntegrationWorkerSocialPublishJobRequest {
  jobId: string;
  albumName: string;
  networks: IntegrationWorkerSocialPublishNetworkImages[];
  encryptedCredentials: string;
  awsConfig?: IntegrationWorkerSocialPublishAwsConfig;
  callback: IntegrationWorkerCallbackConfig;
}

export interface IntegrationWorkerSocialPublishProgressCallback {
  jobId: string;
  progress: SocialPublishProgress;
}

export interface IntegrationWorkerSocialPublishResultCallback {
  jobId: string;
  status: IntegrationWorkerResultStatus;
  results?: SocialPublishResult[];
  errorMessage?: string;
}

export interface IntegrationWorkerContentMigrationJobRequest {
  jobId: string;
  migrationRequest: ContentMigrationRequest;
  mongoUri: string;
  awsConfig: IntegrationWorkerResizeAwsConfig;
  encryptedAwsCredentials: string;
  callback: IntegrationWorkerCallbackConfig;
}

export interface IntegrationWorkerContentMigrationProgressCallback {
  jobId: string;
  message: string;
  progress?: ContentMigrationProgress;
  queued?: boolean;
  queuePosition?: number;
  activeJobType?: string;
}

export interface IntegrationWorkerContentMigrationResultCallback {
  jobId: string;
  status: IntegrationWorkerResultStatus;
  result?: ContentMigrationResult;
  errorMessage?: string;
  cancelled?: boolean;
}
