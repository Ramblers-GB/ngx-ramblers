import { randomBytes } from "crypto";
import { buildSecretsContent } from "../shared/secrets";
import AdmZip from "adm-zip";
import { EnvironmentsConfig } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { ContributorBundleFile, ContributorBundleRequest } from "./contributor-environment.model";

export function generateAuthSecret(): string {
  return randomBytes(32).toString("hex");
}

export function buildEnvironmentsManifest(environment: string, appName: string): string {
  const manifest: EnvironmentsConfig = {
    environments: [{ environment, flyio: { appName } }]
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function buildContributorSecretsContent(request: ContributorBundleRequest): string {
  return buildSecretsContent({
    MONGODB_URI: request.mongoUri,
    AUTH_SECRET: generateAuthSecret(),
    NODE_ENV: "development",
    AWS_REGION: request.aws.region,
    AWS_BUCKET: request.aws.bucket,
    AWS_ACCESS_KEY_ID: request.aws.accessKeyId,
    AWS_SECRET_ACCESS_KEY: request.aws.secretAccessKey
  });
}

function buildReadme(request: ContributorBundleRequest): string {
  return [
    `Contributor environment bundle for ${request.environment}`,
    "",
    "Before you start:",
    "  Install the Node.js version named in the checkout's .nvmrc file and the",
    "  npm version in package.json \"engines\". nvm (https://github.com/nvm-sh/nvm)",
    "  is the easiest way. Operating system packages are usually too old, and on",
    "  macOS the current Node.js needs macOS 13.5 or newer. ./bin/ngx-cli checks",
    "  both versions before it installs anything and tells you what it needs.",
    "",
    "Unpack the two files below into the root of an ngx-ramblers checkout, then run:",
    `  ./bin/ngx-cli local dev ${request.environment} --no-docker-worker`,
    "",
    "The first run installs dependencies, which takes a few minutes. If that",
    "install stops part way, fix the error it shows and run the command again.",
    "To start completely clean, run: npm run reinstall",
    "",
    "Files:",
    `  non-vcs/secrets/secrets.${request.appName}.env  - environment secrets (local use only)`,
    "  non-vcs/secrets/environments.local.json         - environments manifest",
    "",
    "Everything needed to run the stack locally is already filled in - no",
    "further configuration is required.",
    "",
    "AUTH_SECRET is generated fresh for this bundle and is unique to it. The",
    "MongoDB and AWS storage values are this group's own credentials; keep",
    "the secrets file private and do not commit it.",
    ""
  ].join("\n");
}

export function buildContributorBundle(request: ContributorBundleRequest): ContributorBundleFile[] {
  return [
    {
      path: `non-vcs/secrets/secrets.${request.appName}.env`,
      content: buildContributorSecretsContent(request)
    },
    {
      path: "non-vcs/secrets/environments.local.json",
      content: buildEnvironmentsManifest(request.environment, request.appName)
    },
    {
      path: "README-contributor-environment.txt",
      content: buildReadme(request)
    }
  ];
}

export function contributorBundleFileName(environment: string): string {
  return `contributor-environment-${environment}.zip`;
}

export function contributorBundleZip(request: ContributorBundleRequest): Buffer {
  const zip = new AdmZip();
  buildContributorBundle(request).forEach(file => zip.addFile(file.path, Buffer.from(file.content, "utf-8")));
  return zip.toBuffer();
}
