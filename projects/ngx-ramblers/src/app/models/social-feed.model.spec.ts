import { socialFeedStyle, SocialFeedStyle } from "./social-feed.model";

describe("socialFeedStyle", () => {
  it("defaults missing or unknown values to the photo grid", () => {
    expect(socialFeedStyle(null)).toEqual(SocialFeedStyle.GRID);
    expect(socialFeedStyle(SocialFeedStyle.GRID)).toEqual(SocialFeedStyle.GRID);
  });

  it("keeps the post list when that style is chosen", () => {
    expect(socialFeedStyle(SocialFeedStyle.LIST)).toEqual(SocialFeedStyle.LIST);
  });
});
