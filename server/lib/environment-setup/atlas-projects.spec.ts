import expect from "expect";
import sinon from "sinon";
import { afterEach, describe, it } from "mocha";
import * as environmentsConfig from "../environments/environments-config";
import * as configController from "../mongo/controllers/config";
import * as atlasApi from "./atlas-admin-api";
import { atlasProjectForCluster, matchManagedProjectAccess, matchProjectAccess } from "./atlas-projects";

describe("Atlas projects for individual clusters", () => {
  const sandbox = sinon.createSandbox();
  const atlas = {projectId: "original-project", publicKey: "public", privateKey: "private"};

  afterEach(() => sandbox.restore());

  it("reuses a saved project when cluster creation is retried", async () => {
    sandbox.stub(environmentsConfig, "configuredEnvironments").resolves({environments: [], atlas: {managedProjects: [{name: "hillside", projectId: "hillside-project"}]}});
    const request = sandbox.stub(atlasApi, "atlasRequest");
    expect(await atlasProjectForCluster(atlas, "hillside")).toEqual({...atlas, projectId: "hillside-project"});
    expect(request.called).toBe(false);
  });

  it("creates the project in the original organisation and preserves existing settings", async () => {
    sandbox.stub(environmentsConfig, "configuredEnvironments").resolves({environments: []});
    const request = sandbox.stub(atlasApi, "atlasRequest");
    request.onFirstCall().resolves({status: 200, body: {orgId: "organisation"}});
    request.onSecondCall().resolves({status: 201, body: {id: "hillside-project"}});
    sandbox.stub(configController, "queryKey").resolves({value: {environments: [], atlas: {...atlas, defaultCluster: "existing.abc123"}}} as never);
    const save = sandbox.stub(configController, "createOrUpdateKey").resolves(null);
    expect(await atlasProjectForCluster(atlas, "hillside")).toEqual({...atlas, projectId: "hillside-project"});
    expect(request.secondCall.args).toEqual([atlas, "POST", "/groups", {name: "hillside", orgId: "organisation"}]);
    expect(save.firstCall.args[1]).toMatchObject({atlas: {...atlas, defaultCluster: "existing.abc123", managedProjects: [{name: "hillside", projectId: "hillside-project"}]}});
  });

  it("does not save or create any further resources when permission is denied", async () => {
    sandbox.stub(environmentsConfig, "configuredEnvironments").resolves({environments: []});
    const request = sandbox.stub(atlasApi, "atlasRequest");
    request.onFirstCall().resolves({status: 200, body: {orgId: "organisation"}});
    request.onSecondCall().resolves({status: 403, body: {detail: "Project creation denied"}});
    const save = sandbox.stub(configController, "createOrUpdateKey");
    await expect(atlasProjectForCluster(atlas, "hillside")).rejects.toThrow("Project creation denied");
    expect(save.called).toBe(false);
  });
});

describe("Atlas project access", () => {
  const sandbox = sinon.createSandbox();
  const atlas = {projectId: "provisioning", publicKey: "public", privateKey: "private"};
  const owner = {username: "owner@example.org", roles: ["GROUP_OWNER"]};
  const reader = {username: "reader@example.org", roles: ["GROUP_READ_ONLY"]};
  const team = {teamId: "platform-team", roleNames: ["GROUP_OWNER"]};

  afterEach(() => sandbox.restore());

  function fakeAtlas(projects: Record<string, {users: object[]; teams: object[]}>, failingPosts: string[] = []) {
    return sandbox.stub(atlasApi, "atlasRequest").callsFake((async (_atlas: unknown, method: string, path: string) => {
      const [, projectId, resource] = path.split("?")[0].split("/").filter(part => !!part);
      if (method === "GET" && resource === "users") {
        return projects[projectId] ? {status: 200, body: {results: projects[projectId].users}} : {status: 404, body: {detail: "No such project"}};
      } else if (method === "GET" && resource === "teams") {
        return projects[projectId] ? {status: 200, body: {results: projects[projectId].teams}} : {status: 404, body: {detail: "No such project"}};
      } else {
        return failingPosts.includes(path) ? {status: 403, body: {detail: "Not allowed"}} : {status: 201, body: {}};
      }
    }) as never);
  }

  it("adds the people and teams the provisioning project has, with the same roles", async () => {
    const request = fakeAtlas({provisioning: {users: [owner, reader], teams: [team]}, hillside: {users: [{username: "OWNER@example.org", roles: ["GROUP_OWNER"]}], teams: []}});
    const result = await matchProjectAccess(atlas, "provisioning", "hillside");
    expect(result).toEqual({projectId: "hillside", addedUsers: ["reader@example.org"], addedTeams: ["platform-team"], failures: []});
    const posts = request.getCalls().filter(call => call.args[1] === "POST").map(call => [call.args[2], call.args[3]]);
    expect(posts).toEqual([
      ["/groups/hillside/users", {username: "reader@example.org", roles: ["GROUP_READ_ONLY"]}],
      ["/groups/hillside/teams", [{teamId: "platform-team", roleNames: ["GROUP_OWNER"]}]]
    ]);
  });

  it("never removes anyone from the project", async () => {
    const request = fakeAtlas({provisioning: {users: [owner], teams: []}, hillside: {users: [owner, reader], teams: [team]}});
    expect(await matchProjectAccess(atlas, "provisioning", "hillside")).toMatchObject({addedUsers: [], addedTeams: [], failures: []});
    expect(request.getCalls().filter(call => call.args[1] !== "GET")).toEqual([]);
  });

  it("reports a person Atlas would not add, and still adds the rest", async () => {
    fakeAtlas({provisioning: {users: [owner, reader], teams: []}, hillside: {users: [], teams: []}}, ["/groups/hillside/users"]);
    const result = await matchProjectAccess(atlas, "provisioning", "hillside");
    expect(result.addedUsers).toEqual([]);
    expect(result.failures).toEqual(["owner@example.org: Not allowed", "reader@example.org: Not allowed"]);
  });

  it("matches every managed project except the provisioning one, and carries on past a project it cannot read", async () => {
    sandbox.stub(environmentsConfig, "configuredEnvironments").resolves({environments: [], atlas: {managedProjects: [
      {name: "provisioning-again", projectId: "provisioning"}, {name: "hillside", projectId: "hillside"}, {name: "gone", projectId: "gone"}, {name: "hillside-again", projectId: "hillside"}
    ]}});
    fakeAtlas({provisioning: {users: [owner], teams: []}, hillside: {users: [], teams: []}});
    const results = await matchManagedProjectAccess(atlas);
    expect(results.map(result => result.projectId)).toEqual(["hillside", "gone"]);
    expect(results[0].addedUsers).toEqual(["owner@example.org"]);
    expect(results[1].failures[0]).toContain("No such project");
  });

  it("gives a new project the provisioning project's people as soon as it is created", async () => {
    sandbox.stub(environmentsConfig, "configuredEnvironments").resolves({environments: []});
    sandbox.stub(configController, "queryKey").resolves({value: {environments: [], atlas}} as never);
    sandbox.stub(configController, "createOrUpdateKey").resolves(null);
    const request = sandbox.stub(atlasApi, "atlasRequest").callsFake((async (_atlas: unknown, method: string, path: string) => {
      if (path === "/groups/provisioning") {
        return {status: 200, body: {orgId: "organisation"}};
      } else if (method === "POST" && path === "/groups") {
        return {status: 201, body: {id: "hillside"}};
      } else if (method === "GET") {
        return {status: 200, body: {results: path.startsWith("/groups/provisioning/users") ? [owner] : []}};
      } else {
        return {status: 201, body: {}};
      }
    }) as never);
    await atlasProjectForCluster(atlas, "hillside");
    expect(request.getCalls().some(call => call.args[1] === "POST" && call.args[2] === "/groups/hillside/users" && (call.args[3] as {username: string}).username === "owner@example.org")).toBe(true);
  });
});
