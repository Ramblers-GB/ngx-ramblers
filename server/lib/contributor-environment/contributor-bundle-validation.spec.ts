import expect from "expect";
import { describe, it } from "mocha";
import { cloneSchemaNameAllowed, contributorBundleProblem } from "./contributor-bundle-validation";

const liveMongo = {cluster: "cluster0.example", username: "ngx_hillside_db_user", password: "fictional-password", database: "ngx-ramblers-hillside"};

describe("cloneSchemaNameAllowed", () => {
  it("allows a schema that starts with the live database name", () => {
    expect(cloneSchemaNameAllowed("ngx-ramblers-hillside", "ngx-ramblers-hillside-clone")).toEqual(true);
    expect(cloneSchemaNameAllowed("ngx-ramblers-hillside", "ngx-ramblers-hillside-dev")).toEqual(true);
  });

  it("rejects the live database itself and names that are not on this group", () => {
    expect(cloneSchemaNameAllowed("ngx-ramblers-hillside", "ngx-ramblers-hillside")).toEqual(false);
    expect(cloneSchemaNameAllowed("ngx-ramblers-hillside", "ngx-ramblers-dev-clone")).toEqual(false);
    expect(cloneSchemaNameAllowed("ngx-ramblers-hillside", "other-group")).toEqual(false);
    expect(cloneSchemaNameAllowed("", "ngx-ramblers-hillside-clone")).toEqual(false);
  });
});

describe("contributorBundleProblem", () => {
  it("accepts a live-database bundle and a correctly named clone", () => {
    expect(contributorBundleProblem({environmentName: "hillside", schema: "", clone: false}, liveMongo as never)).toBeNull();
    expect(contributorBundleProblem({environmentName: "hillside", schema: "ngx-ramblers-hillside-dev", clone: true}, liveMongo as never)).toBeNull();
  });

  it("refuses a missing environment name or connection", () => {
    expect(contributorBundleProblem({environmentName: "", schema: "", clone: false}, liveMongo as never)).toEqual("environmentName is required");
    expect(contributorBundleProblem({environmentName: "hillside", schema: "", clone: false}, null)).toEqual("Could not read the current database connection");
  });

  it("refuses a clone onto the live database or another group's name", () => {
    expect(contributorBundleProblem({environmentName: "hillside", schema: "", clone: true}, liveMongo as never)).toEqual("A schema name is required to clone the database");
    expect(contributorBundleProblem({environmentName: "hillside", schema: "ngx-ramblers-hillside", clone: true}, liveMongo as never)).toEqual("Choose a schema name different from the current database for a clone");
    expect(contributorBundleProblem({environmentName: "hillside", schema: "ngx-ramblers-valley-dev", clone: true}, liveMongo as never)).toEqual("Clone schema must start with ngx-ramblers-hillside- so it stays on this group's data");
  });
});
