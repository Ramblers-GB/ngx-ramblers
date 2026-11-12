import { describe, expect, it } from "vitest";
import { RoleType } from "../models/committee.model";
import { Member } from "../models/member.model";
import {
  meetingInviteBodyMarkdown,
  meetingInviteCommitteeRoleSendOffered,
  meetingInviteKindPhrase,
  meetingInviteRecipientMember,
  personalisedGuestJoinUrl,
  personaliseGuestMeetingLinksInHtml,
  personaliseJoinLinkHtml
} from "./video-meeting-invite";

describe("meetingInviteKindPhrase", () => {

  it("uses the for an acronym such as AGM", () => {
    expect(meetingInviteKindPhrase("AGM")).toEqual("the AGM");
  });

  it("uses a or an for a named meeting type", () => {
    expect(meetingInviteKindPhrase("Committee Meeting")).toEqual("a Committee Meeting");
    expect(meetingInviteKindPhrase("Annual General Meeting")).toEqual("an Annual General Meeting");
  });

});

describe("meetingInviteBodyMarkdown", () => {

  it("names the meeting type in the opening line", () => {
    const body = meetingInviteBodyMarkdown({
      dateLabel: "Thursday 26 November 2026",
      timeLabel: "7:00 pm",
      joinUrl: "https://group.example.org.uk/video-meetings/guest/room-1",
      location: "",
      note: "",
      guestInstructions: "",
      signoff: "",
      meetingKind: "AGM"
    });
    expect(body).toContain("## You are invited to the AGM on Thursday 26 November 2026 at 7:00 pm.");
  });

  it("includes a short note in the body so the meeting title can stay short", () => {
    const body = meetingInviteBodyMarkdown({
      dateLabel: "Wednesday 2 September 2026",
      timeLabel: "9:00 am",
      joinUrl: "https://example.org/video-meetings/guest/room-1",
      location: "",
      note: "Please have the walk reports to hand.",
      guestInstructions: "Allow the camera and microphone.",
      signoff: "Kind regards\n\nNick Barrett"
    });
    expect(body).toContain("## You are invited to a committee meeting on Wednesday 2 September 2026 at 9:00 am.");
    expect(body).toContain("Please join using [this link](https://example.org/video-meetings/guest/room-1).");
    expect(body).toContain("Please have the walk reports to hand.");
    expect(body).toContain("Kind regards");
    expect(body.indexOf("Please have the walk reports to hand.")).toBeGreaterThan(body.indexOf("Please join using"));
  });

  it("includes numbered agenda items when they are supplied", () => {
    const body = meetingInviteBodyMarkdown({
      dateLabel: "Thursday 26 November 2026",
      timeLabel: "7:00 pm",
      joinUrl: "https://group.example.org.uk/video-meetings/guest/room-1",
      location: "",
      note: "This is the invite note.",
      guestInstructions: "Allow the camera and microphone.",
      signoff: "Kind regards\n\nAlex Reed",
      agendaItems: "1. Welcome\n2. Chair's report"
    });
    expect(body).toContain("1. Welcome");
    expect(body).toContain("2. Chair's report");
    expect(body.indexOf("Please join using")).toBeLessThan(body.indexOf("1. Welcome"));
  });

  it("omits the note when none is given", () => {
    const body = meetingInviteBodyMarkdown({
      dateLabel: "Wednesday 2 September 2026",
      timeLabel: "9:00 am",
      joinUrl: "",
      location: "Village Hall",
      note: "  ",
      guestInstructions: "Allow the camera and microphone.",
      signoff: ""
    });
    expect(body).toContain("## You are invited to a committee meeting on Wednesday 2 September 2026 at 9:00 am.");
    expect(body).toContain("We are meeting at Village Hall.");
    expect(body).not.toContain("this link");
    expect(body).toContain("We look forward to seeing you there.");
  });

});

describe("meetingInviteCommitteeRoleSendOffered", () => {
  const chair = {
    type: "chair",
    description: "Chair",
    fullName: "Alex Reed",
    email: "chair@group.example.org.uk",
    memberId: "m1",
    roleType: RoleType.COMMITTEE_MEMBER
  };
  const alex = {id: "m1", firstName: "Alex", lastName: "Reed", email: "alex.reed@example.com"} as Member;
  const walker = {id: "m2", firstName: "Sam", lastName: "Walker", email: "sam.walker@example.com"} as Member;

  it("is offered when every chosen person holds a committee role", () => {
    expect(meetingInviteCommitteeRoleSendOffered(
      [{email: alex.email, name: "Alex Reed", memberId: alex.id}],
      [alex, walker],
      [chair]
    )).toEqual(true);
  });

  it("is still offered after the chip has been rewritten to the role mailbox", () => {
    expect(meetingInviteCommitteeRoleSendOffered(
      [{email: chair.email, name: "Alex Reed", memberId: alex.id}],
      [alex, walker],
      [chair]
    )).toEqual(true);
    expect(meetingInviteRecipientMember(
      {email: chair.email, name: "Chair"},
      [alex, walker],
      [chair]
    )?.id).toEqual(alex.id);
  });

  it("is not offered for a mixed invite of committee and other members", () => {
    expect(meetingInviteCommitteeRoleSendOffered(
      [
        {email: alex.email, name: "Alex Reed", memberId: alex.id},
        {email: walker.email, name: "Sam Walker", memberId: walker.id}
      ],
      [alex, walker],
      [chair]
    )).toEqual(false);
  });

  it("is not offered for a previously saved personal address that is not a group member", () => {
    expect(meetingInviteCommitteeRoleSendOffered(
      [{email: "guest@example.com", name: "Alex"}],
      [alex, walker],
      [chair]
    )).toEqual(false);
  });
});

describe("personalisedGuestJoinUrl", () => {

  it("carries the invitee name and email as merge fields so each person joins as themselves", () => {
    expect(personalisedGuestJoinUrl("https://example.org/video-meetings/guest/room-1"))
      .toEqual("https://example.org/video-meetings/guest/room-1?name={{params.memberMergeFields.FULL_NAME}}&email={{params.memberMergeFields.EMAIL}}");
  });

  it("is blank when there is no join link", () => {
    expect(personalisedGuestJoinUrl("")).toEqual("");
  });

});

describe("personaliseJoinLinkHtml", () => {

  it("rewrites only the link target, leaving the visible address as sent", () => {
    const joinUrl = "https://example.org/video-meetings/guest/room-1";
    const html = `<p><strong>Join:</strong> <a href="${joinUrl}">${joinUrl}</a></p>`;
    expect(personaliseJoinLinkHtml(html, joinUrl))
      .toEqual(`<p><strong>Join:</strong> <a href="${joinUrl}?name={{params.memberMergeFields.FULL_NAME}}&amp;email={{params.memberMergeFields.EMAIL}}">${joinUrl}</a></p>`);
  });

  it("leaves the html alone for an in-person meeting with no link", () => {
    const html = "<p><strong>Where:</strong> Village Hall</p>";
    expect(personaliseJoinLinkHtml(html, "")).toEqual(html);
  });

});

describe("personaliseGuestMeetingLinksInHtml", () => {

  it("rewrites every guest meeting href so each recipient joins as themselves", () => {
    const joinUrl = "https://group.example.org.uk/video-meetings/guest/agm-thursday-26-november-2026-2454";
    const html = `<p><strong>Meeting link:</strong> <a href="${joinUrl}">${joinUrl}</a></p>`;
    expect(personaliseGuestMeetingLinksInHtml(html))
      .toEqual(`<p><strong>Meeting link:</strong> <a href="${joinUrl}?name={{params.memberMergeFields.FULL_NAME}}&amp;email={{params.memberMergeFields.EMAIL}}">${joinUrl}</a></p>`);
  });

  it("leaves an already personalised href alone", () => {
    const href = "https://group.example.org.uk/video-meetings/guest/room-1?name={{params.memberMergeFields.FULL_NAME}}&amp;email={{params.memberMergeFields.EMAIL}}";
    const html = `<a href="${href}">Join</a>`;
    expect(personaliseGuestMeetingLinksInHtml(html)).toEqual(html);
  });

});
