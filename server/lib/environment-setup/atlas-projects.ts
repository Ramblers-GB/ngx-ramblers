import debug from "debug";
import {
  AtlasApiAccess,
  AtlasApiVersion,
  AtlasError,
  AtlasProjectAccessResult,
  AtlasProjectDescription,
  AtlasProjectTeam,
  AtlasProjectTeamList,
  AtlasProjectUser,
  AtlasProjectUserList
} from "./atlas-admin-api.model";
import { atlasRequest } from "./atlas-admin-api";
import { configuredEnvironments } from "../environments/environments-config";
import * as configController from "../mongo/controllers/config";
import { ConfigKey } from "../../../projects/ngx-ramblers/src/app/models/config.model";
import { EnvironmentsConfig } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { envConfig } from "../env-config/env-config";

const debugLog = debug(envConfig.logNamespace("atlas-projects"));
debugLog.enabled = true;

async function projectUsers(atlas: AtlasApiAccess, projectId: string): Promise<AtlasProjectUser[]> {
  const response = await atlasRequest<AtlasProjectUserList & AtlasError>(atlas, "GET", `/groups/${projectId}/users?itemsPerPage=500`, null, AtlasApiVersion.PROJECT_USERS);
  if (!response || response.status >= 300) {
    throw new Error(`Could not read the people on Atlas project ${projectId}: ${response?.body?.detail || response?.status}`);
  } else {
    return response.body?.results || [];
  }
}

async function projectTeams(atlas: AtlasApiAccess, projectId: string): Promise<AtlasProjectTeam[]> {
  const response = await atlasRequest<AtlasProjectTeamList & AtlasError>(atlas, "GET", `/groups/${projectId}/teams?itemsPerPage=500`);
  if (!response || response.status >= 300) {
    throw new Error(`Could not read the teams on Atlas project ${projectId}: ${response?.body?.detail || response?.status}`);
  } else {
    return response.body?.results || [];
  }
}

async function addProjectUser(atlas: AtlasApiAccess, projectId: string, user: AtlasProjectUser): Promise<string | null> {
  const response = await atlasRequest<AtlasError>(atlas, "POST", `/groups/${projectId}/users`, {username: user.username, roles: user.roles || []}, AtlasApiVersion.PROJECT_USERS);
  return response && response.status < 300 ? null : `${user.username}: ${response?.body?.detail || response?.status}`;
}

async function addProjectTeam(atlas: AtlasApiAccess, projectId: string, team: AtlasProjectTeam): Promise<string | null> {
  const response = await atlasRequest<AtlasError>(atlas, "POST", `/groups/${projectId}/teams`, [{teamId: team.teamId, roleNames: team.roleNames || []}]);
  return response && response.status < 300 ? null : `team ${team.teamId}: ${response?.body?.detail || response?.status}`;
}

export async function matchProjectAccess(atlas: AtlasApiAccess, sourceProjectId: string, targetProjectId: string): Promise<AtlasProjectAccessResult> {
  const [sourceUsers, sourceTeams, targetUsers, targetTeams] = await Promise.all([
    projectUsers(atlas, sourceProjectId),
    projectTeams(atlas, sourceProjectId),
    projectUsers(atlas, targetProjectId),
    projectTeams(atlas, targetProjectId)
  ]);
  const usernames = new Set(targetUsers.map(user => (user.username || "").toLowerCase()));
  const teamIds = new Set(targetTeams.map(team => team.teamId));
  const missingUsers = sourceUsers.filter(user => user.username && !usernames.has(user.username.toLowerCase()));
  const missingTeams = sourceTeams.filter(team => team.teamId && !teamIds.has(team.teamId));
  const userFailures = await Promise.all(missingUsers.map(user => addProjectUser(atlas, targetProjectId, user)));
  const teamFailures = await Promise.all(missingTeams.map(team => addProjectTeam(atlas, targetProjectId, team)));
  return {
    projectId: targetProjectId,
    addedUsers: missingUsers.filter((_user, index) => !userFailures[index]).map(user => user.username),
    addedTeams: missingTeams.filter((_team, index) => !teamFailures[index]).map(team => team.teamId),
    failures: [...userFailures, ...teamFailures].filter(failure => !!failure)
  };
}

export async function matchManagedProjectAccess(atlas: AtlasApiAccess): Promise<AtlasProjectAccessResult[]> {
  const config = await configuredEnvironments();
  const projectIds = Array.from(new Set((config.atlas?.managedProjects || []).map(project => project.projectId)))
    .filter(projectId => !!projectId && projectId !== atlas.projectId);
  const results = await Promise.all(projectIds.map(projectId => matchProjectAccess(atlas, atlas.projectId, projectId).catch(error => ({
    projectId, addedUsers: [], addedTeams: [], failures: [error?.message || String(error)]
  }))));
  results.filter(result => result.addedUsers.length || result.addedTeams.length || result.failures.length)
    .forEach(result => debugLog("Atlas project %s: added people %o, added teams %o, problems %o", result.projectId, result.addedUsers, result.addedTeams, result.failures));
  return results;
}

export async function atlasProjectForCluster(atlas: AtlasApiAccess, name: string): Promise<AtlasApiAccess> {
  const config = await configuredEnvironments();
  const existing = config.atlas?.managedProjects?.find(project => project.name === name);
  if (existing) {
    return {...atlas, projectId: existing.projectId};
  } else {
    const parent = await atlasRequest<AtlasProjectDescription & AtlasError>(atlas, "GET", `/groups/${atlas.projectId}`);
    if (parent.status >= 300 || !parent.body?.orgId) {
      throw new Error(`Could not resolve the Atlas organisation: ${parent.body?.detail || parent.status}`);
    } else {
      const created = await atlasRequest<AtlasProjectDescription & AtlasError>(atlas, "POST", "/groups", {name, orgId: parent.body.orgId});
      if (created.status >= 300 || !created.body?.id) {
        throw new Error(`Could not create the Atlas project (${created.status}): ${created.body?.detail || "The API key needs Organisation Project Creator."}`);
      } else {
        const document = await configController.queryKey(ConfigKey.ENVIRONMENTS);
        const current: EnvironmentsConfig = document?.value || {environments: []};
        const project = {name, projectId: created.body.id};
        await configController.createOrUpdateKey(ConfigKey.ENVIRONMENTS, {...current, atlas: {...current.atlas, managedProjects: [...(current.atlas?.managedProjects || []), project]}});
        await matchProjectAccess(atlas, atlas.projectId, project.projectId)
          .then(result => debugLog("New Atlas project %s: added people %o, added teams %o, problems %o", name, result.addedUsers, result.addedTeams, result.failures))
          .catch(error => debugLog("New Atlas project %s: could not match access: %s", name, error?.message || error));
        return {...atlas, projectId: project.projectId};
      }
    }
  }
}
