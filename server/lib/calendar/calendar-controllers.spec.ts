import expect from "expect";
import sinon from "sinon";
import { afterEach, beforeEach, describe, it } from "mocha";
import { Request, Response } from "express";
import * as config from "../config/system-config";
import { member } from "../mongo/models/member";
import { extendedGroupEvent } from "../mongo/models/extended-group-event";
import { eventsCalendarFeed, meetingInviteDescription } from "./calendar-controllers";
import { meetingIcalDocument } from "./ical";
import { CommitteeMeetingFormat } from "../../../projects/ngx-ramblers/src/app/models/committee.model";
import { SystemConfig } from "../../../projects/ngx-ramblers/src/app/models/system.model";
import { EventField, GroupEventField } from "../../../projects/ngx-ramblers/src/app/models/walk.model";
import { RamblersEventType } from "../../../projects/ngx-ramblers/src/app/models/ramblers-walks-manager.model";

describe("eventsCalendarFeed", () => {
  const sandbox = sinon.createSandbox();
  const memberId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const response = {setHeader: sinon.stub(), send: sinon.stub(), status: sinon.stub(), json: sinon.stub()};
  const aggregateQuery = {exec: sinon.stub()};

  beforeEach(() => {
    response.status.returns(response);
    aggregateQuery.exec.resolves([]);
    sandbox.stub(config, "systemConfig").resolves({group: {shortName: "Hillside", href: "https://group.example.org.uk"}} as SystemConfig);
    sandbox.stub(extendedGroupEvent, "aggregate").returns(aggregateQuery as any);
  });

  afterEach(() => {
    sandbox.restore();
    response.status.resetHistory();
    response.send.resetHistory();
  });

  function request(id: string | null): Request {
    return {params: id ? {memberId: id} : {}, headers: {}, protocol: "https", get: () => "group.example.org.uk"} as unknown as Request;
  }

  it("limits a personal feed to published walks matching the member or contact ID", async () => {
    const memberQuery = {select: sinon.stub(), lean: sinon.stub(), exec: sinon.stub().resolves({contactId: "contact-example"})};
    memberQuery.select.returns(memberQuery);
    memberQuery.lean.returns(memberQuery);
    sandbox.stub(member, "findById").returns(memberQuery as any);
    await eventsCalendarFeed(request(memberId), response as unknown as Response);
    const criteria = (extendedGroupEvent.aggregate as sinon.SinonStub).firstCall.args[0][0].$match;
    expect(criteria.$or).toEqual([
      {[EventField.CONTACT_DETAILS_MEMBER_ID]: {$in: [memberId, "contact-example"]}},
      {[GroupEventField.WALK_LEADER_ID]: {$in: [memberId, "contact-example"]}}
    ]);
    expect(criteria[GroupEventField.ITEM_TYPE]).toBe(RamblersEventType.GROUP_WALK);
    expect(response.send.calledOnce).toBe(true);
  });

  it("does not fall back to everyone's feed when the member does not exist", async () => {
    await eventsCalendarFeed(request("invalid-member"), response as unknown as Response);
    expect(response.status.calledWith(404)).toBe(true);
    expect((extendedGroupEvent.aggregate as sinon.SinonStub).called).toBe(false);
    expect(response.send.called).toBe(false);
  });

  it("keeps the existing whole-group feed unrestricted by leader", async () => {
    await eventsCalendarFeed(request(null), response as unknown as Response);
    const criteria = (extendedGroupEvent.aggregate as sinon.SinonStub).firstCall.args[0][0].$match;
    expect(criteria.$or).toBeUndefined();
    expect(criteria[GroupEventField.ITEM_TYPE]).toBeUndefined();
    expect(response.send.calledOnce).toBe(true);
  });

  it("loads the feed through aggregate with the same start-of-day bound as the next-walk query", async () => {
    await eventsCalendarFeed(request(null), response as unknown as Response);
    const range = (extendedGroupEvent.aggregate as sinon.SinonStub).firstCall.args[0][0].$match[GroupEventField.START_DATE];
    expect(range.$gte).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("meeting invite calendar description", () => {
  it("gives an online meeting a description mail apps can show in place of the email", () => {
    const description = meetingInviteDescription({format: CommitteeMeetingFormat.ONLINE, inviteNote: "Agenda to follow"}, "Committee Meeting, Thursday 11 February 2027", "https://group.example.org.uk/committee/2027");
    expect(description).toEqual([
      "Committee Meeting, Thursday 11 February 2027",
      "Join online using the link in the invitation email.",
      "Agenda to follow",
      "Meeting papers: https://group.example.org.uk/committee/2027"
    ].join("\n\n"));
  });

  it("names the venue for an in-person meeting", () => {
    expect(meetingInviteDescription({format: CommitteeMeetingFormat.IN_PERSON, location: "Village Hall"}, "AGM", null)).toEqual("AGM\n\nLocation: Village Hall");
  });

  it("writes the meeting page as the event URL but never a personal guest link", () => {
    const withPage = meetingIcalDocument({uid: "meeting-1@group.example.org.uk", title: "AGM", startTime: 1795722981384, url: "https://group.example.org.uk/committee/2027"}, "Hillside");
    const withGuestLink = meetingIcalDocument({uid: "meeting-1@group.example.org.uk", title: "AGM", startTime: 1795722981384, url: "https://group.example.org.uk/video-meetings/guest/room?email=a@b.c"}, "Hillside");
    expect(withPage).toContain("URL:https://group.example.org.uk/committee/2027");
    expect(withGuestLink).not.toContain("URL:");
  });
});
