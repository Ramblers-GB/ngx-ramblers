import { EnvironmentSiteLink, EnvironmentsConfig } from "../models/environment-config.model";


export function siteUrlForEnvironment(environmentName: string, appName: string, baseDomain: string | null | undefined): string {
  if (baseDomain && environmentName) {
    return `https://${environmentName}.${baseDomain}`;
  } else if (appName) {
    return `https://${appName}.fly.dev`;
  } else {
    return "";
  }
}

export function configuredSiteUrl(config: EnvironmentsConfig | null | undefined, environmentName: string): string {
  const environment = config?.environments?.find(candidate => candidate.environment === environmentName);
  return environment ? siteUrlForEnvironment(environment.environment, environment.flyio?.appName || "", config?.cloudflare?.baseDomain) : "";
}

export function configuredSiteLinks(config: EnvironmentsConfig | null | undefined, environmentNames: string[]): EnvironmentSiteLink[] {
  return environmentNames.map(environment => ({environment, url: configuredSiteUrl(config, environment)}));
}
