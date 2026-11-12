import expect from "expect";
import sinon from "sinon";
import { afterEach, beforeEach, describe, it } from "mocha";
import { MongoClient } from "mongodb";
import { createEnvironmentMongoUser, deleteEnvironmentMongoUser, ensureEnvironmentMongoUser, environmentDatabaseUserName, grantDatabaseAccessToUser, waitForMongoLogin } from "./mongo-database-user";
import { atlasDigestAuthorisation } from "./atlas-admin-api";

const atlas = {projectId: "project-1", publicKey: "public-key", privateKey: "private-key"};

function atlasResponse(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {status, headers});
}

describe("createEnvironmentMongoUser", () => {
  const sandboxState: {sandbox: sinon.SinonSandbox | null} = {sandbox: null};

  beforeEach(() => {
    sandboxState.sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandboxState.sandbox.restore();
  });

  it("adds clone-schema roles to an existing user without resetting the password", async () => {
    const fetchStub = sandboxState.sandbox.stub(globalThis, "fetch");
    fetchStub.onCall(0).resolves(atlasResponse(401, {}, {"www-authenticate": "Digest realm=\"MMS Public API\", nonce=\"abc\", qop=\"auth\""}));
    fetchStub.onCall(1).resolves(atlasResponse(200, {
      username: "ngx_group_db_user",
      roles: [
        {databaseName: "group-live", roleName: "readWrite"},
        {databaseName: "group-live", roleName: "dbAdmin"}
      ]
    }));
    fetchStub.onCall(2).resolves(atlasResponse(401, {}, {"www-authenticate": "Digest realm=\"MMS Public API\", nonce=\"abc\", qop=\"auth\""}));
    fetchStub.onCall(3).resolves(atlasResponse(200));
    await grantDatabaseAccessToUser(atlas, "ngx_group_db_user", "group-live-clone");
    const [url, init] = fetchStub.getCall(3).args as [string, RequestInit];
    expect(url).toBe("https://cloud.mongodb.com/api/atlas/v2/groups/project-1/databaseUsers/admin/ngx_group_db_user");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      roles: [
        {databaseName: "group-live", roleName: "readWrite"},
        {databaseName: "group-live", roleName: "dbAdmin"},
        {databaseName: "group-live-clone", roleName: "readWrite"},
        {databaseName: "group-live-clone", roleName: "dbAdmin"}
      ]
    });
  });

  it("skips the Atlas update when the user already has the clone-schema roles", async () => {
    const fetchStub = sandboxState.sandbox.stub(globalThis, "fetch");
    fetchStub.onCall(0).resolves(atlasResponse(401, {}, {"www-authenticate": "Digest realm=\"MMS Public API\", nonce=\"abc\", qop=\"auth\""}));
    fetchStub.onCall(1).resolves(atlasResponse(200, {
      username: "ngx_group_db_user",
      roles: [
        {databaseName: "group-live", roleName: "readWrite"},
        {databaseName: "group-live", roleName: "dbAdmin"},
        {databaseName: "group-live-clone", roleName: "readWrite"},
        {databaseName: "group-live-clone", roleName: "dbAdmin"}
      ]
    }));
    await grantDatabaseAccessToUser(atlas, "ngx_group_db_user", "group-live-clone");
    expect(fetchStub.callCount).toBe(2);
  });

  it("creates a user through the Atlas Admin API with read and write on the new database only", async () => {
    const fetchStub = sandboxState.sandbox.stub(globalThis, "fetch");
    fetchStub.onFirstCall().resolves(atlasResponse(401, {}, {"www-authenticate": "Digest realm=\"MMS Public API\", nonce=\"abc\", qop=\"auth\""}));
    fetchStub.onSecondCall().resolves(atlasResponse(201));
    const created = await createEnvironmentMongoUser(atlas, "ngx-ramblers-new-group", "new-group");
    const [url, init] = fetchStub.secondCall.args as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(url).toBe("https://cloud.mongodb.com/api/atlas/v2/groups/project-1/databaseUsers");
    expect((init.headers as Record<string, string>).Authorization).toContain("Digest username=\"public-key\"");
    expect(created.username).toBe("ngx_new_group_db_user");
    expect(created.password.length).toBeGreaterThan(20);
    expect(body).toMatchObject({databaseName: "admin", username: "ngx_new_group_db_user", password: created.password});
    expect(body.roles).toEqual([
      {databaseName: "ngx-ramblers-new-group", roleName: "readWrite"},
      {databaseName: "ngx-ramblers-new-group", roleName: "dbAdmin"}
    ]);
  });

  it("resets the password when that user already exists and keeps clone-schema roles", async () => {
    const fetchStub = sandboxState.sandbox.stub(globalThis, "fetch");
    fetchStub.onCall(0).resolves(atlasResponse(409, {errorCode: "USER_ALREADY_EXISTS"}));
    fetchStub.onCall(1).resolves(atlasResponse(200, {
      username: "ngx_new_group_db_user",
      roles: [
        {databaseName: "ngx-ramblers-new-group", roleName: "readWrite"},
        {databaseName: "ngx-ramblers-new-group", roleName: "dbAdmin"},
        {databaseName: "ngx-ramblers-new-group-clone", roleName: "readWrite"},
        {databaseName: "ngx-ramblers-new-group-clone", roleName: "dbAdmin"}
      ]
    }));
    fetchStub.onCall(2).resolves(atlasResponse(200));
    const created = await createEnvironmentMongoUser(atlas, "ngx-ramblers-new-group", "new-group");
    const [url, init] = fetchStub.getCall(2).args as [string, RequestInit];
    expect(init.method).toBe("PATCH");
    expect(url).toBe("https://cloud.mongodb.com/api/atlas/v2/groups/project-1/databaseUsers/admin/ngx_new_group_db_user");
    expect(JSON.parse(init.body as string).password).toBe(created.password);
    expect(JSON.parse(init.body as string).roles).toEqual([
      {databaseName: "ngx-ramblers-new-group-clone", roleName: "readWrite"},
      {databaseName: "ngx-ramblers-new-group-clone", roleName: "dbAdmin"},
      {databaseName: "ngx-ramblers-new-group", roleName: "readWrite"},
      {databaseName: "ngx-ramblers-new-group", roleName: "dbAdmin"}
    ]);
  });

  it("sets Atlas back to the password already stored for the environment", async () => {
    const fetchStub = sandboxState.sandbox.stub(globalThis, "fetch");
    fetchStub.onCall(0).resolves(atlasResponse(409, {errorCode: "USER_ALREADY_EXISTS"}));
    fetchStub.onCall(1).resolves(atlasResponse(200, {
      username: "ngx_hillside_db_user",
      roles: [
        {databaseName: "ngx-ramblers-hillside", roleName: "readWrite"},
        {databaseName: "ngx-ramblers-hillside", roleName: "dbAdmin"}
      ]
    }));
    fetchStub.onCall(2).resolves(atlasResponse(200));
    const ensured = await ensureEnvironmentMongoUser(atlas, "ngx-ramblers-hillside", "hillside", "stored-password");
    const [url, init] = fetchStub.getCall(2).args as [string, RequestInit];
    expect(ensured).toEqual({username: "ngx_hillside_db_user", password: "stored-password"});
    expect(init.method).toBe("PATCH");
    expect(url).toBe("https://cloud.mongodb.com/api/atlas/v2/groups/project-1/databaseUsers/admin/ngx_hillside_db_user");
    expect(JSON.parse(init.body as string).password).toBe("stored-password");
  });

  it("keeps an existing user's password when provisioning a migration target", async () => {
    const fetchStub = sandboxState.sandbox.stub(globalThis, "fetch").resolves(atlasResponse(409, {errorCode: "USER_ALREADY_EXISTS"}));
    await expect(createEnvironmentMongoUser(atlas, "ngx-ramblers-new-group", "new-group", false)).rejects.toThrow("USER_ALREADY_EXISTS");
    expect(fetchStub.callCount).toBe(1);
    expect(fetchStub.firstCall.args[1].method).toBe("POST");
  });

  it("explains what to set up when there is no Atlas API key, and never shows a password", async () => {
    await expect(createEnvironmentMongoUser({projectId: "project-1"}, "ngx-ramblers-new-group", "new-group")).rejects.toThrow("MongoDB Atlas API access is not set up");
    await expect(createEnvironmentMongoUser({publicKey: "p", privateKey: "k"}, "ngx-ramblers-new-group", "new-group")).rejects.toThrow("The platform has no MongoDB Atlas project ID");
    const fetchStub = sandboxState.sandbox.stub(globalThis, "fetch");
    fetchStub.resolves(atlasResponse(403, {errorCode: "USER_UNAUTHORIZED", detail: "Not authorised"}));
    const failure: Error = await createEnvironmentMongoUser(atlas, "ngx-ramblers-new-group", "new-group").catch(error => error);
    expect(failure.message).toBe("MongoDB Atlas would not create the database user ngx_new_group_db_user (403 USER_UNAUTHORIZED): Not authorised");
  });

  it("answers the digest challenge as RFC 2617 describes", () => {
    const header = atlasDigestAuthorisation("Digest realm=\"r\", nonce=\"n\", qop=\"auth\"", "GET", "/api/atlas/v2/groups", {publicKey: "u", privateKey: "p"}, "c");
    expect(header).toContain("response=\"");
    expect(header).toContain("uri=\"/api/atlas/v2/groups\"");
    expect(header).toContain("cnonce=\"c\"");
  });

  it("waits for Atlas to activate a new user before carrying on", async () => {
    const connect = sandboxState.sandbox.stub(MongoClient, "connect");
    connect.onFirstCall().rejects(new Error("bad auth : Authentication failed."));
    connect.onSecondCall().resolves({db: () => ({command: sinon.stub().resolves({ok: 1})}), close: sinon.stub().resolves()} as any);
    const waits: number[] = [];
    await waitForMongoLogin("cluster.mongodb.net", {username: "ngx_new_group_db_user", password: "secret"}, "ngx-ramblers-new-group", attempt => waits.push(attempt), 1);
    expect(waits).toEqual([1, 0]);
    expect(connect.callCount).toBe(2);
  });

  it("deletes the site's own user through Atlas, and treats a missing one as already gone", async () => {
    const fetchStub = sandboxState.sandbox.stub(globalThis, "fetch");
    fetchStub.onFirstCall().resolves(new Response(null, {status: 204}));
    fetchStub.onSecondCall().resolves(atlasResponse(404, {errorCode: "USERNAME_NOT_FOUND"}));
    expect(await deleteEnvironmentMongoUser(atlas, "ngx_new_group_db_user")).toBe("Deleted ngx_new_group_db_user");
    const [url, init] = fetchStub.firstCall.args as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    expect(url).toBe("https://cloud.mongodb.com/api/atlas/v2/groups/project-1/databaseUsers/admin/ngx_new_group_db_user");
    expect(await deleteEnvironmentMongoUser(atlas, "ngx_new_group_db_user")).toBe("ngx_new_group_db_user not found (already deleted)");
    expect(environmentDatabaseUserName("new-forest")).toBe("ngx_new_forest_db_user");
  });
});
