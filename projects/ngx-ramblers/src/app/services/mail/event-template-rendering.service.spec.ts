import {TestBed} from "@angular/core/testing";
import {LoggerTestingModule} from "ngx-logger/testing";
import {beforeEach, describe, expect, it} from "vitest";
import {EventTemplateRenderingService} from "./event-template-rendering.service";
import {EmailComposerRenderingService} from "../email-composer/email-composer-rendering.service";
import {MailMessagingService} from "./mail-messaging.service";
import {DateUtilsService} from "../date-utils.service";
import {GroupEventSummary} from "../../models/committee.model";
import {EmailComposerProgramme, ProgrammeEventFormat} from "../../models/email-composer.model";
import {RamblersEventType} from "../../models/ramblers-walks-manager.model";
import {GridReferenceDigits} from "../../models/walks-config.model";
import {WalksConfigService} from "../system/walks-config.service";
import {UrlService} from "../url.service";

describe("event listing email fragment", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({imports: [LoggerTestingModule], providers: [
      {provide: WalksConfigService, useValue: {walksConfig: () => ({walkDetailsShowGridReference: true, walkDetailsGridReferenceDigits: GridReferenceDigits.SIX})}},
      {provide: DateUtilsService, useValue: {displayDate: () => "Sunday"}},
      {provide: UrlService, useValue: {absoluteUrlFor: path => path}},
      {provide: MailMessagingService, useValue: {currentConfig: () => ({notificationConfigs: []}), createSendSmtpEmailParams: () => ({})}},
      {provide: EmailComposerRenderingService, useValue: {
        markdownToHtml: value => value,
        tableSection: value => `<div style="font-family:Helvetica,Arial,sans-serif;font-size:16px">${value}</div>`
      }}
    ]});
  });

  it("renders the event block with email body styles and without campaign chrome", () => {
    const rendering = TestBed.inject(EventTemplateRenderingService);
    const html = rendering.embeddedEmailHtml("## Hillside Park\n\nDetails of the walk.");
    expect(html).toContain("Hillside Park");
    expect(html).toContain("font-family:Helvetica,Arial,sans-serif");
    expect(html).toContain("font-size:16px");
    expect(html).toContain("background:#ffffff");
    expect(html).not.toContain("View this email in your browser");
    expect(html).not.toContain("BANNER");
  });

  it("uses the walk display format for a saved programme grid reference and preserves the map link", () => {
    const rendering = TestBed.inject(EventTemplateRenderingService);
    const event = {id: "walk", selected: true, ramblersEventType: RamblersEventType.GROUP_WALK,
      gridReference: "SU1234545678", mapUrl: "/locate"} as GroupEventSummary;
    const settings = {format: ProgrammeEventFormat.CUSTOM, customTemplate: "{{grid-reference}}", eventFormats: {}} as EmailComposerProgramme;
    expect(rendering.markdown([event], settings, null)).toContain("[SU 123 456](/locate)");
  });
});
