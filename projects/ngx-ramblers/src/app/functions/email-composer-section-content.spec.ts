import { describe, expect, it } from "vitest";
import { emailSectionHasContent } from "./email-composer";

describe("emailSectionHasContent", () => {
  it("treats an empty Angular wrapper as having nothing to show", () => {
    expect(emailSectionHasContent(`<app-committee-notification-details _ngcontent-ng-c1=""><!--container--><!--container--></app-committee-notification-details><!--container-->`)).toBe(false);
  });

  it("treats blank and whitespace-only html as empty", () => {
    expect(emailSectionHasContent("")).toBe(false);
    expect(emailSectionHasContent("<p>&nbsp;</p>")).toBe(false);
  });

  it("keeps text, images and divider tables", () => {
    expect(emailSectionHasContent("<p>Next meeting</p>")).toBe(true);
    expect(emailSectionHasContent(`<img src="a.jpg">`)).toBe(true);
    expect(emailSectionHasContent(`<table role="presentation"><tr><td>&nbsp;</td></tr></table>`)).toBe(true);
  });
});
