import expect from "expect";
import { describe, it } from "mocha";
import { platformCloneAccessUrl } from "./clone-database";

describe("platformCloneAccessUrl", () => {
  it("uses the platform app's internal HTTP service", () => {
    expect(platformCloneAccessUrl()).toEqual("http://ngx-ramblers.internal:5001/api/environment-setup/contributor-clone-access");
  });
});
