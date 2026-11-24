import { eventNoticeFor, EventsData } from "./group-events.model";
import { DynamicContentSiteEditEvents } from "../modules/common/dynamic-content/dynamic-content-site-edit-events";
import { PageContentRow } from "./content-text.model";

describe("walk notices on an events row", () => {
  const eventsData = {eventNotices: [{eventId: "ightham", title: "Change of starting point", message: "Now starts from Ightham Mote via Knole Park."}]} as EventsData;

  it("finds a walk's notice by either of its ids", () => {
    expect(eventNoticeFor(eventsData, ["ightham"])?.title).toBe("Change of starting point");
    expect(eventNoticeFor(eventsData, ["other", "ightham"])?.message).toContain("Knole Park");
  });

  it("has no notice for a walk without one", () => {
    expect(eventNoticeFor(eventsData, ["richmond"])).toBeNull();
  });

  it("keeps a notice while it has words in it and drops it once emptied", () => {
    const editor = Object.create(DynamicContentSiteEditEvents.prototype) as DynamicContentSiteEditEvents;
    editor.row = {events: {eventIds: ["ightham"], eventNotices: []}} as unknown as PageContentRow;
    editor.changeNotice("ightham", {message: "Now starts from Ightham Mote."});
    expect(editor.row.events.eventNotices).toEqual([{eventId: "ightham", message: "Now starts from Ightham Mote."}]);
    editor.changeNotice("ightham", {message: "  "});
    expect(editor.row.events.eventNotices).toEqual([]);
  });
});
