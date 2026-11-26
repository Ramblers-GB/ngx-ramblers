export interface ContributorBundleAws {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface ContributorBundleRequest {
  environment: string;
  appName: string;
  mongoUri: string;
  aws: ContributorBundleAws;
}

export interface ContributorBundleFile {
  path: string;
  content: string;
}

export interface ContributorBundleOptions {
  environmentName: string;
  schema: string;
  clone: boolean;
}

export interface ContributorCloneAccessRequest {
  username: string;
  sourceDatabase: string;
  targetDatabase: string;
}

export interface ContributorMongoCredentials {
  username: string;
  password: string;
}

export interface ContributorCloneAccess {
  mongo: ContributorMongoCredentials;
  aws: ContributorBundleAws;
}
