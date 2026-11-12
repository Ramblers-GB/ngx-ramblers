import expect from "expect";
import { describe, it } from "mocha";
import { cloneSchemaNameAllowed } from "./clone-database";

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
