import expect from "expect";
import { describe, it } from "mocha";
import { SocialNetwork, SocialPublishResult } from "../../../projects/ngx-ramblers/src/app/models/social-publish.model";
import { socialPublishCompleteMessage, socialPublishFailed } from "./social-publish-outcome";

describe("social-publish-outcome", () => {
  it("reports a single network failure", () => {
    const results: SocialPublishResult[] = [
      {network: SocialNetwork.INSTAGRAM, success: false, error: "Instagram media container failed"}
    ];
    expect(socialPublishFailed(results)).toEqual(true);
    expect(socialPublishCompleteMessage(results)).toEqual("Instagram media container failed");
  });

  it("reports a full success", () => {
    const results: SocialPublishResult[] = [
      {network: SocialNetwork.FACEBOOK, success: true},
      {network: SocialNetwork.INSTAGRAM, success: true}
    ];
    expect(socialPublishFailed(results)).toEqual(false);
    expect(socialPublishCompleteMessage(results)).toEqual("Published to 2 networks");
  });

  it("reports a mixed result", () => {
    const results: SocialPublishResult[] = [
      {network: SocialNetwork.FACEBOOK, success: true},
      {network: SocialNetwork.INSTAGRAM, success: false, error: "timed out"}
    ];
    expect(socialPublishFailed(results)).toEqual(false);
    expect(socialPublishCompleteMessage(results)).toEqual("Published to 1 of 2 networks");
  });
});
