import expect from "expect";
import { describe, it } from "mocha";
import { SECRET_MASK } from "../../../projects/ngx-ramblers/src/app/models/config.model";
import { ramblersApiKeyFrom } from "./ramblers-api-client";

describe("ramblersApiKeyFrom", () => {
  it("uses the stored key when the browser sends the masked placeholder", () => {
    expect(ramblersApiKeyFrom(SECRET_MASK, "stored-key")).toEqual("stored-key");
  });

  it("uses a key typed into the setup form as it is", () => {
    expect(ramblersApiKeyFrom("typed-key", "stored-key")).toEqual("typed-key");
  });

  it("gives no key when the placeholder is sent and nothing is stored", () => {
    expect(ramblersApiKeyFrom(SECRET_MASK, null)).toEqual("");
  });
});
