import expect from "expect";
import { describe, it } from "mocha";
import { EventField, GroupEventField } from "../../../../projects/ngx-ramblers/src/app/models/walk.model";
import { fieldEqualsAnyValue } from "../../../../projects/ngx-ramblers/src/app/functions/mongo";
import { historicalLeaderIdentityMatch } from "./walk-stats-agm";

describe("historicalLeaderIdentityMatch", () => {

  it("matches historical emails and names without depending on stored casing", () => {
    const match = historicalLeaderIdentityMatch([{
      id: "member-1",
      name: "Kerry Example",
      email: "Kerry@Example.com",
      walkCount: 2,
      totalMiles: 8
    }]);
    expect(match).toEqual([
      {[EventField.CONTACT_DETAILS_EMAIL]: fieldEqualsAnyValue(["Kerry@Example.com"])},
      {[EventField.CONTACT_DETAILS_DISPLAY_NAME]: fieldEqualsAnyValue(["Kerry Example"])},
      {[GroupEventField.WALK_LEADER_NAME]: fieldEqualsAnyValue(["Kerry Example"])},
      {[EventField.PUBLISHING_RAMBLERS_CONTACT_NAME]: fieldEqualsAnyValue(["Kerry Example"])},
      {[EventField.CONTACT_DETAILS_MEMBER_ID]: fieldEqualsAnyValue(["member-1"])},
      {[GroupEventField.WALK_LEADER_ID]: fieldEqualsAnyValue(["member-1"])}
    ]);
    expect(match[0][EventField.CONTACT_DETAILS_EMAIL]).toEqual({
      $regex: "^(Kerry@Example\\.com)$",
      $options: "i"
    });
  });

});
