import expect from "expect";
import { describe, it } from "mocha";
import { ghostDatabasesFrom, leftoverLoginsFrom, loginEnvironment } from "./atlas-ghost-databases";
import { migrationLoginFor } from "./mongo-database-user";
import { withGhostDatabases } from "./atlas-clusters";
import { AtlasClusterRow, AtlasClusterState, AtlasClusterTier } from "../../../projects/ngx-ramblers/src/app/models/atlas-cluster.model";
import { EnvironmentConfig } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import {
  EnvironmentMigrationAudit,
  EnvironmentMigrationMode,
  EnvironmentMigrationPhase,
  EnvironmentMigrationStatus
} from "../../../projects/ngx-ramblers/src/app/models/environment-migration.model";

function move(migrationId: string, from: string, to: string, rotatedAt: string, overrides: Partial<EnvironmentMigrationAudit> = {}): EnvironmentMigrationAudit {
  return {
    migrationId,
    environment: "dev-two",
    mode: EnvironmentMigrationMode.MONGO_ONLY,
    status: EnvironmentMigrationStatus.ROTATED,
    phase: EnvironmentMigrationPhase.ROTATE_CREDENTIALS,
    dryRun: false,
    startTime: 0,
    rotatedAt: rotatedAt as never,
    sourceMongo: {cluster: from, db: "dev-two-db", username: `${migrationId}-old-login`, uriSummary: ""},
    targetMongo: {cluster: to, db: "dev-two-db", username: `${migrationId}-new-login`, uriSummary: ""},
    verification: {collections: ["members", "pages", "walks"], totalDocumentCount: 10, keyCollectionCounts: []},
    ...overrides
  };
}

const devTwoNow: EnvironmentConfig = {environment: "dev-two", mongo: {cluster: "shared-01.abc", db: "dev-two-db", username: "current-login", password: "secret"}} as EnvironmentConfig;

const devTwoHistory = [
  move("first", "original.abc", "shared-01.abc", "2026-11-18T21:05:00.000Z"),
  move("second", "shared-01.abc", "demo.abc", "2026-11-19T01:58:00.000Z"),
  move("third", "demo.abc", "shared-01.abc", "2026-11-21T18:49:00.000Z")
];

describe("databases left behind by moves", () => {
  it("shows each database a site was moved away from, but not the one it runs on now", () => {
    const ghosts = ghostDatabasesFrom([devTwoNow], devTwoHistory);
    expect(ghosts.map(ghost => `${ghost.cluster}/${ghost.database}`)).toEqual(["demo.abc/dev-two-db", "original.abc/dev-two-db"]);
    expect(ghosts[0]).toEqual(expect.objectContaining({migrationId: "third", environment: "dev-two", oldUsername: "third-old-login", movedTo: "shared-01.abc", collections: 3}));
  });

  it("stops showing a database once it has been removed", () => {
    const history = [devTwoHistory[0], devTwoHistory[1], {...devTwoHistory[2], sourceRemovedAt: 1}];
    expect(ghostDatabasesFrom([devTwoNow], history).map(ghost => ghost.cluster)).toEqual(["original.abc"]);
  });

  it("never offers a database another site uses, whether by its settings or its stored connection", () => {
    const neighbour = {environment: "neighbour", mongo: {cluster: "demo.abc", db: "dev-two-db"}} as EnvironmentConfig;
    const storedOnly = {environment: "stored", secrets: {MONGODB_URI: "mongodb+srv://someone:pw@original.abc.mongodb.net/dev-two-db"}} as EnvironmentConfig;
    expect(ghostDatabasesFrom([devTwoNow, neighbour, storedOnly], devTwoHistory)).toEqual([]);
  });

  it("ignores dry runs and moves that were never switched over", () => {
    const history = [
      move("dry-run", "demo.abc", "shared-01.abc", "2026-11-21T18:49:00.000Z", {dryRun: true}),
      move("ready", "demo.abc", "shared-01.abc", "2026-11-21T18:49:00.000Z", {status: EnvironmentMigrationStatus.READY_FOR_CUTOVER}),
      move("files", "demo.abc", "shared-01.abc", "2026-11-21T18:49:00.000Z", {mode: EnvironmentMigrationMode.S3_ONLY})
    ];
    expect(ghostDatabasesFrom([devTwoNow], history)).toEqual([]);
  });

  it("counts a left-behind database in how full its cluster is", () => {
    const cluster: AtlasClusterRow = {
      name: "demo", host: "demo.abc", instanceSize: AtlasClusterTier.M0, region: "", stateName: AtlasClusterState.IDLE,
      inProvisioningProject: true, isDefault: false, environmentCount: 1, collectionCount: 400, indexCount: 0, databaseCount: 1,
      dataSizeBytes: 0, canAddEnvironment: true, limitHeadline: ""
    };
    const ghosts = ghostDatabasesFrom([devTwoNow], devTwoHistory);
    const withGhost = withGhostDatabases(cluster, ghosts, 80, 160);
    expect(withGhost.ghostDatabases.map(ghost => ghost.database)).toEqual(["dev-two-db"]);
    expect(withGhost.collectionCount).toBe(403);
    expect(withGhost.databaseCount).toBe(2);
  });

  describe("database logins", () => {
    const clusters: AtlasClusterRow[] = [
      {name: "shared-01", host: "shared-01.abc", projectId: "main", instanceSize: AtlasClusterTier.FLEX, region: "", stateName: AtlasClusterState.IDLE, inProvisioningProject: true, isDefault: false, environmentCount: 1, collectionCount: 0, indexCount: 0, databaseCount: 1, dataSizeBytes: 0, canAddEnvironment: true, limitHeadline: ""},
      {name: "demo", host: "demo.abc", projectId: "demo-project", instanceSize: AtlasClusterTier.M0, region: "", stateName: AtlasClusterState.IDLE, inProvisioningProject: true, isDefault: false, environmentCount: 0, collectionCount: 0, indexCount: 0, databaseCount: 0, dataSizeBytes: 0, canAddEnvironment: true, limitHeadline: ""}
    ];
    const ekwg = {environment: "ekwg", mongo: {cluster: "shared-01.abc", db: "ekwg", username: "ngx_ekwg_db_user"}} as EnvironmentConfig;

    it("gives a retried move the same login, and the other one when the site already uses it", () => {
      expect(migrationLoginFor("dev-two", ["ngx_dev_two_migration_123"])).toBe("ngx_dev_two_move_a");
      expect(migrationLoginFor("dev-two", [null, "ngx_dev_two_move_a"])).toBe("ngx_dev_two_move_b");
    });

    it("works out which site a login belongs to without mixing up sites whose names start the same", () => {
      const names = ["ekwg", "ekwg-dev-2-staging"];
      expect(loginEnvironment("ngx_ekwg_dev_2_staging_migration_abc123_db_us", names)).toBe("ekwg-dev-2-staging");
      expect(loginEnvironment("ngx_ekwg_db_user", names)).toBe("ekwg");
      expect(loginEnvironment("ngx_ekwg_dev_2_staging_move_b", names)).toBe("ekwg-dev-2-staging");
      expect(loginEnvironment("someone-else", names)).toBeNull();
    });

    it("lists logins nothing uses, and never the ones sites or unfinished moves rely on", () => {
      const unfinished = move("copying", "shared-01.abc", "demo.abc", "", {status: EnvironmentMigrationStatus.RESTORING, targetMongo: {cluster: "demo.abc", db: "dev-two-db", username: "ngx_dev_two_move_b", uriSummary: ""}});
      const abandoned = move("abandoned", "shared-01.abc", "demo.abc", "", {status: EnvironmentMigrationStatus.FAILED, targetMongo: {cluster: "demo.abc", db: "dev-two-db", username: "ngx_dev_two_migration_old1", uriSummary: ""}});
      const logins = [
        {projectId: "main", username: "current-login"},
        {projectId: "main", username: "ngx_ekwg_db_user"},
        {projectId: "demo-project", username: "ngx_dev_two_move_b"},
        {projectId: "demo-project", username: "ngx_dev_two_migration_old1"},
        {projectId: "main", username: "ngx_dev_two_db_user", database: "dev-two-db"},
        {projectId: "main", username: "ngx_cleanup_1a2b3c"},
        {projectId: "main", username: "salesforce-mock-reader"},
        {projectId: "main", username: "ngx_salesforce_mock_db_user"},
        {projectId: "main", username: "ngx_ekwg_move_b"}
      ];
      const leftovers = leftoverLoginsFrom([devTwoNow, ekwg], [unfinished, abandoned], logins, clusters, "ngx_ekwg_move_b");
      expect(leftovers).toEqual([
        {projectId: "demo-project", username: "ngx_dev_two_migration_old1", environment: "dev-two", database: null, cluster: "demo.abc"},
        {projectId: "main", username: "ngx_dev_two_db_user", environment: "dev-two", database: "dev-two-db", cluster: "shared-01.abc"}
      ]);
    });
  });
});
