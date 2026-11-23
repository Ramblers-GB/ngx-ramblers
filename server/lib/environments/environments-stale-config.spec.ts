import expect from "expect";
import { describe, it } from "mocha";
import { EnvironmentsConfig } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import {
  environmentsConfigFromStagingDocument,
  staleEnvironmentsConfigReason,
  StaleEnvironmentsConfigError
} from "./environments-config";

const environmentsConfig: EnvironmentsConfig = {
  environments: [
    {environment: "staging", mongo: {cluster: "shared-sites-01.abc123", db: "ngx-ramblers-staging", username: "u", password: "p"}},
    {environment: "hillside", mongo: {cluster: "shared-sites-04.def456", db: "ngx-ramblers-hillside", username: "u", password: "p"}}
  ]
} as EnvironmentsConfig;

describe("refusing an out-of-date copy of the environments config", () => {
  it("accepts the config when it is read from the cluster it says its own database is on", () => {
    expect(staleEnvironmentsConfigReason(environmentsConfig, "mongodb+srv://u:p@shared-sites-01.abc123.mongodb.net/ngx-ramblers-staging?retryWrites=true")).toBeNull();
  });

  it("refuses a copy left on the old cluster after the config's database moved, and names the cluster to use", () => {
    const reason = staleEnvironmentsConfigReason(environmentsConfig, "mongodb+srv://u:p@old-cluster.zzz999.mongodb.net/ngx-ramblers-staging");
    expect(reason).toContain("out-of-date copy");
    expect(reason).toContain("shared-sites-01.abc123");
  });

  it("does not judge a database the config does not list", () => {
    expect(staleEnvironmentsConfigReason(environmentsConfig, "mongodb+srv://u:p@any-cluster.zzz999.mongodb.net/ngx-ramblers-unlisted")).toBeNull();
    expect(staleEnvironmentsConfigReason(null, "mongodb+srv://u:p@any-cluster.zzz999.mongodb.net/ngx-ramblers-staging")).toBeNull();
  });

  describe("when falling back to the server/.env staging connection", () => {
    it("accepts the config read from the cluster it says staging is on", () => {
      const loaded = environmentsConfigFromStagingDocument(environmentsConfig, "mongodb+srv://u:p@shared-sites-01.abc123.mongodb.net/ngx-ramblers-staging");
      expect(loaded?.environments?.length).toEqual(2);
    });

    it("refuses a stale copy rather than returning it", () => {
      expect(() => environmentsConfigFromStagingDocument(environmentsConfig, "mongodb+srv://u:p@old-cluster.zzz999.mongodb.net/ngx-ramblers-staging")).toThrow(StaleEnvironmentsConfigError);
    });

    it("returns nothing when the staging database has no environments", () => {
      expect(environmentsConfigFromStagingDocument(undefined, "mongodb+srv://u:p@shared-sites-01.abc123.mongodb.net/ngx-ramblers-staging")).toBeNull();
    });
  });
});
