import expect from "expect";
import sinon from "sinon";
import { afterEach, describe, it } from "mocha";
import { AtlasClusterTier, clusterAcceptsMigratedSite, clusterCapacity, clusterFullness, ClusterFullnessLevel, nextSharedSitesClusterName } from "../../../projects/ngx-ramblers/src/app/models/atlas-cluster.model";
import { AwsRegion } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { atlasClusterCreateBody, atlasFlexClusterCreateBody, clusterHostFromSrv, createAtlasCluster, deleteAtlasCluster, registrationMongoCluster } from "./atlas-clusters";
import * as environmentsConfig from "../environments/environments-config";
import * as registrationStore from "../site-registration/registration-store";
import * as mongoDatabaseUser from "./mongo-database-user";

describe("atlas-clusters", () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => sandbox.restore());

  const ATLAS = "https://cloud.mongodb.com/api/atlas/v2/groups/project-1";

  function stubAtlas(responses: Record<string, {status: number; body: unknown}>) {
    sandbox.stub(environmentsConfig, "configuredEnvironments").resolves({environments: []});
    sandbox.stub(registrationStore, "registrationSettings").resolves({sourceEnvironmentName: "template"} as never);
    sandbox.stub(mongoDatabaseUser, "platformAtlasAccess").resolves({projectId: "project-1", publicKey: "public-key", privateKey: "private-key"});
    const fetchStub = sandbox.stub(globalThis, "fetch");
    fetchStub.callsFake(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers || {}) as Record<string, string>;
      const key = `${init?.method} ${url.replace(ATLAS, "").replace(/\?.*$/, "")}`;
      const response = responses[key];
      if (!headers.Authorization) {
        return new Response("{}", {status: 401, headers: {"www-authenticate": "Digest realm=\"Atlas\", nonce=\"nonce\", qop=\"auth\""}});
      } else if (response) {
        return new Response(JSON.stringify(response.body), {status: response.status});
      } else {
        return new Response(JSON.stringify({detail: `unexpected ${key}`}), {status: 500});
      }
    });
    return fetchStub;
  }

  function authorisedCall(fetchStub: sinon.SinonStub, method: string, path: string): RequestInit {
    const call = fetchStub.getCalls().find(candidate => {
      const init = candidate.args[1] as RequestInit;
      return init?.method === method && String(candidate.args[0]).replace(/\?.*$/, "") === `${ATLAS}${path}` && !!(init.headers as Record<string, string>).Authorization;
    });
    return call?.args[1] as RequestInit;
  }

  [AtlasClusterTier.M0, AtlasClusterTier.M20].forEach(tier => {
    it(`creates and lists a ${tier} cluster using the API version that supports regionConfigs`, async () => {
      const cluster = {
        name: "group-sites",
        stateName: "CREATING",
        connectionStrings: {standardSrv: "mongodb+srv://group-sites.abc123.mongodb.net"},
        replicationSpecs: [{regionConfigs: [{electableSpecs: {instanceSize: tier}, regionName: "EU_WEST_2"}]}]
      };
      const fetchStub = stubAtlas({
        "POST /clusters": {status: 201, body: cluster},
        "GET /clusters": {status: 200, body: {results: [cluster]}},
        "GET /flexClusters": {status: 200, body: {results: []}},
        "GET /accessList": {status: 200, body: {results: []}}
      });

      const result = await createAtlasCluster({name: "group-sites", tier, region: AwsRegion.EU_WEST_1, setAsDefault: false, allowAllNetworkAccess: false});

      const created = authorisedCall(fetchStub, "POST", "/clusters");
      expect(created.headers).toMatchObject({Accept: "application/vnd.atlas.2023-02-01+json", "Content-Type": "application/json"});
      expect((created.headers as Record<string, string>).Authorization).toContain("Digest username=\"public-key\"");
      expect(JSON.parse(created.body as string).replicationSpecs[0].regionConfigs[0].electableSpecs.instanceSize).toBe(tier);
      expect((authorisedCall(fetchStub, "GET", "/clusters").headers as Record<string, string>).Accept).toBe("application/vnd.atlas.2023-02-01+json");
      expect((authorisedCall(fetchStub, "GET", "/accessList").headers as Record<string, string>).Accept).toBe("application/vnd.atlas.2023-01-01+json");
      expect(result.cluster).toMatchObject({name: "group-sites", host: "group-sites.abc123", instanceSize: tier, stateName: "CREATING"});
    });
  });

  it("creates a Flex cluster through the Flex API and lists it with the dedicated clusters", async () => {
    const flex = {
      name: "group-sites-flex",
      stateName: "CREATING",
      connectionStrings: {standardSrv: "mongodb+srv://group-sites-flex.def456.mongodb.net"},
      providerSettings: {backingProviderName: "AWS", providerName: "FLEX", regionName: "EU_WEST_1"}
    };
    const dedicated = {
      name: "group-sites",
      stateName: "IDLE",
      connectionStrings: {standardSrv: "mongodb+srv://group-sites.abc123.mongodb.net"},
      replicationSpecs: [{regionConfigs: [{electableSpecs: {instanceSize: "M0"}, regionName: "EU_WEST_1"}]}]
    };
    const fetchStub = stubAtlas({
      "POST /flexClusters": {status: 201, body: flex},
      "GET /clusters": {status: 200, body: {results: [dedicated]}},
      "GET /flexClusters": {status: 200, body: {results: [flex]}},
      "GET /accessList": {status: 200, body: {results: []}}
    });

    const result = await createAtlasCluster({name: "group-sites-flex", tier: AtlasClusterTier.FLEX, region: AwsRegion.EU_WEST_1, setAsDefault: false, allowAllNetworkAccess: false});

    const created = authorisedCall(fetchStub, "POST", "/flexClusters");
    expect((created.headers as Record<string, string>).Accept).toBe("application/vnd.atlas.2024-11-13+json");
    expect(JSON.parse(created.body as string)).toEqual(atlasFlexClusterCreateBody("group-sites-flex", AwsRegion.EU_WEST_1));
    expect(authorisedCall(fetchStub, "POST", "/clusters")).toBeUndefined();
    expect(result.cluster).toMatchObject({name: "group-sites-flex", host: "group-sites-flex.def456", instanceSize: AtlasClusterTier.FLEX, region: AwsRegion.EU_WEST_1, stateName: "CREATING"});
    expect(result.message).toContain("still building");
  });

  it("refuses a Flex cluster in London", async () => {
    stubAtlas({});
    await expect(createAtlasCluster({name: "group-sites-flex", tier: AtlasClusterTier.FLEX, region: AwsRegion.EU_WEST_2, setAsDefault: false, allowAllNetworkAccess: false}))
      .rejects.toThrow("Atlas does not offer Flex in AWS London");
  });

  it("builds a Flex cluster in Ireland on AWS", () => {
    expect(atlasFlexClusterCreateBody("group-sites-flex", AwsRegion.EU_WEST_1)).toEqual({
      name: "group-sites-flex",
      providerSettings: {backingProviderName: "AWS", regionName: "EU_WEST_1"},
      terminationProtectionEnabled: false
    });
  });

  const emptyFlex = {
    name: "ngx-shared-sites-09",
    stateName: "IDLE",
    connectionStrings: {standardSrv: "mongodb+srv://ngx-shared-sites-09.xyz789.mongodb.net"},
    providerSettings: {backingProviderName: "AWS", providerName: "FLEX", regionName: "EU_WEST_1"}
  };

  it("deletes an empty Flex cluster through the Flex API", async () => {
    const fetchStub = stubAtlas({
      "GET /clusters": {status: 200, body: {results: []}},
      "GET /flexClusters": {status: 200, body: {results: [emptyFlex]}},
      "GET /accessList": {status: 200, body: {results: []}},
      "DELETE /flexClusters/ngx-shared-sites-09": {status: 202, body: {}}
    });

    const result = await deleteAtlasCluster({projectId: "project-1", name: "ngx-shared-sites-09"});

    expect((authorisedCall(fetchStub, "DELETE", "/flexClusters/ngx-shared-sites-09").headers as Record<string, string>).Accept).toBe("application/vnd.atlas.2024-11-13+json");
    expect(result.message).toContain("ngx-shared-sites-09");
  });

  it("refuses to delete a cluster that still holds a site", async () => {
    const fetchStub = stubAtlas({
      "GET /clusters": {status: 200, body: {results: []}},
      "GET /flexClusters": {status: 200, body: {results: [emptyFlex]}},
      "GET /accessList": {status: 200, body: {results: []}}
    });
    (environmentsConfig.configuredEnvironments as sinon.SinonStub).resolves({environments: [{environment: "hillside", mongo: {cluster: "ngx-shared-sites-09.xyz789", db: "ngx-ramblers-hillside"}}]} as never);

    await expect(deleteAtlasCluster({projectId: "project-1", name: "ngx-shared-sites-09"})).rejects.toThrow("still holds hillside");
    expect(fetchStub.getCalls().some(call => (call.args[1] as RequestInit)?.method === "DELETE")).toBe(false);
  });

  it("refuses to delete a cluster a site still connects to through its stored MONGODB_URI", async () => {
    const fetchStub = stubAtlas({
      "GET /clusters": {status: 200, body: {results: []}},
      "GET /flexClusters": {status: 200, body: {results: [emptyFlex]}},
      "GET /accessList": {status: 200, body: {results: []}}
    });
    (environmentsConfig.configuredEnvironments as sinon.SinonStub).resolves({environments: [{environment: "hillside", mongo: {cluster: "older.def456", db: "ngx-ramblers-hillside"}, secrets: {MONGODB_URI: "\"mongodb+srv://hillside:secret@ngx-shared-sites-09.xyz789.mongodb.net/ngx-ramblers-hillside\""}}]} as never);

    await expect(deleteAtlasCluster({projectId: "project-1", name: "ngx-shared-sites-09"})).rejects.toThrow("hillside still connects to ngx-shared-sites-09");
    expect(fetchStub.getCalls().some(call => (call.args[1] as RequestInit)?.method === "DELETE")).toBe(false);
  });

  it("refuses to delete a cluster while any stored MONGODB_URI cannot be read", async () => {
    const fetchStub = stubAtlas({
      "GET /clusters": {status: 200, body: {results: []}},
      "GET /flexClusters": {status: 200, body: {results: [emptyFlex]}},
      "GET /accessList": {status: 200, body: {results: []}}
    });
    (environmentsConfig.configuredEnvironments as sinon.SinonStub).resolves({environments: [{environment: "hillside", mongo: {cluster: "older.def456", db: "ngx-ramblers-hillside"}, secrets: {MONGODB_URI: "not a connection string"}}]} as never);

    await expect(deleteAtlasCluster({projectId: "project-1", name: "ngx-shared-sites-09"})).rejects.toThrow("cannot be read");
    expect(fetchStub.getCalls().some(call => (call.args[1] as RequestInit)?.method === "DELETE")).toBe(false);
  });

  it("offers a migration target only in the main project or where sites already are", () => {
    const row = {name: "x", host: "x.abc", projectId: "project-1", instanceSize: AtlasClusterTier.FLEX, region: "", stateName: "IDLE", inProvisioningProject: true, isDefault: false, environmentCount: 0, collectionCount: 0, indexCount: 0, databaseCount: 0, canAddEnvironment: true, limitHeadline: ""} as never;
    expect(clusterAcceptsMigratedSite(row, "project-1")).toBe(true);
    expect(clusterAcceptsMigratedSite({...(row as object), projectId: "mock-project"} as never, "project-1")).toBe(false);
    expect(clusterAcceptsMigratedSite({...(row as object), projectId: "kent-project", environmentCount: 1} as never, "project-1")).toBe(true);
  });

  it("reports how full a Flex cluster is by collections and storage", () => {
    const row = {name: "x", host: "x.abc", projectId: "project-1", instanceSize: AtlasClusterTier.FLEX, region: "", stateName: "IDLE", inProvisioningProject: true, isDefault: false, environmentCount: 3, collectionCount: 400, indexCount: 900, databaseCount: 3, dataSizeBytes: 1024 * 1024 * 1024, canAddEnvironment: true, limitHeadline: ""} as never;
    const fullness = clusterFullness(row);
    expect(fullness.collections).toEqual({percent: 80, level: ClusterFullnessLevel.FILLING, label: "400 of 500 collections"});
    expect(fullness.storage).toEqual({percent: 20, level: ClusterFullnessLevel.OK, label: "1.0 GB of 5.0 GB storage"});
  });

  it("reports a dedicated cluster by collections and indexes with no storage limit", () => {
    const row = {name: "x", host: "x.abc", projectId: "project-1", instanceSize: AtlasClusterTier.M10, region: "", stateName: "IDLE", inProvisioningProject: true, isDefault: false, environmentCount: 3, collectionCount: 1000, indexCount: 3500, databaseCount: 3, dataSizeBytes: 0, canAddEnvironment: true, limitHeadline: ""} as never;
    const fullness = clusterFullness(row);
    expect(fullness.collections.percent).toBe(90);
    expect(fullness.collections.level).toBe(ClusterFullnessLevel.FULL);
    expect(fullness.storage).toBeNull();
  });

  it("names the next shared sites cluster after the highest existing number", () => {
    expect(nextSharedSitesClusterName([])).toBe("ngx-shared-sites-01");
    expect(nextSharedSitesClusterName(["kent", "ngx-shared-sites-01", "ngx-shared-sites-03", "ngx-shared-sites-old"])).toBe("ngx-shared-sites-04");
  });

  it("reads the host prefix from an SRV string with no user", () => {
    expect(clusterHostFromSrv("mongodb+srv://ngx-ramblers-nonprod.abc123.mongodb.net")).toBe("ngx-ramblers-nonprod.abc123");
    expect(clusterHostFromSrv("mongodb+srv://ngx-ramblers-nonprod.abc123.mongodb.net/")).toBe("ngx-ramblers-nonprod.abc123");
  });

  it("reads the host prefix from an SRV string with a user", () => {
    expect(clusterHostFromSrv("mongodb+srv://group_db_user:secret@cluster0.abc123.mongodb.net/ngx-ramblers-group")).toBe("cluster0.abc123");
  });

  it("builds a free London cluster as a tenant on AWS", () => {
    expect(atlasClusterCreateBody("ngx-ramblers-nonprod", AtlasClusterTier.M0, AwsRegion.EU_WEST_2)).toEqual({
      name: "ngx-ramblers-nonprod",
      clusterType: "REPLICASET",
      replicationSpecs: [{
        regionConfigs: [{
          electableSpecs: {instanceSize: "M0"},
          providerName: "TENANT",
          backingProviderName: "AWS",
          regionName: "EU_WEST_2",
          priority: 7
        }]
      }]
    });
  });

  it("builds a dedicated London cluster on AWS", () => {
    const body = atlasClusterCreateBody("ngx-ramblers-prod", AtlasClusterTier.M20, AwsRegion.EU_WEST_2) as any;
    expect(body.replicationSpecs[0].regionConfigs[0]).toEqual({
      electableSpecs: {instanceSize: "M20", nodeCount: 3},
      providerName: "AWS",
      regionName: "EU_WEST_2",
      priority: 7
    });
  });

  it("blocks a further site on a free cluster at the collection cap", () => {
    const capacity = clusterCapacity(AtlasClusterTier.M0, 430, 900, 7);
    expect(capacity.canAdd).toBe(false);
    expect(capacity.headline).toContain("500 collections");
  });

  it("allows a further site on an M20 with headroom", () => {
    const capacity = clusterCapacity(AtlasClusterTier.M20, 200, 400, 3);
    expect(capacity.canAdd).toBe(true);
  });

  it("treats an unknown cluster at the free-tier collection cap as full", () => {
    const capacity = clusterCapacity(AtlasClusterTier.UNKNOWN, 425, 1100, 7);
    expect(capacity.canAdd).toBe(false);
    expect(capacity.headline).toContain("500");
  });

  it("uses the Atlas default cluster for new sites instead of the content template", () => {
    expect(registrationMongoCluster({environments: [], atlas: {defaultCluster: "ngx-ramblers-nonprod.abc123"}}, "template.abc123")).toBe("ngx-ramblers-nonprod.abc123");
    expect(registrationMongoCluster({environments: []}, "template.abc123")).toBe("template.abc123");
  });
});
