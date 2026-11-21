import {TestBed} from "@angular/core/testing";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {LoggerFactory} from "../logger-factory.service";
import {EmailComposerAudienceService} from "./email-composer-audience.service";
import {EmailComposerMemberDirectoryService} from "./email-composer-member-directory.service";

describe("email composer member directory", () => {
  const members = vi.fn();

  beforeEach(() => {
    members.mockReset();
    members.mockResolvedValue([]);
    TestBed.configureTestingModule({providers: [
      EmailComposerMemberDirectoryService,
      {provide: EmailComposerAudienceService, useValue: {members}},
      {provide: LoggerFactory, useValue: {createLogger: () => ({error: vi.fn(), info: vi.fn(), off: vi.fn()})}}
    ]});
  });

  it("remembers an address that belongs to no member so it is not looked up again", async () => {
    const directory = TestBed.inject(EmailComposerMemberDirectoryService);
    expect(directory.hasEmail("outsider@example.org")).toBe(false);
    await directory.ensureMembers([], ["outsider@example.org"]);
    expect(directory.hasEmail("Outsider@Example.org")).toBe(true);
    expect(members).toHaveBeenCalledTimes(1);
  });

  it("hands back the same settled promise when there is nothing to load, so repeated checks cannot keep waking the page", async () => {
    const directory = TestBed.inject(EmailComposerMemberDirectoryService);
    await directory.ensureMembers([], ["outsider@example.org"]);
    const first = directory.ensureMembers([], ["outsider@example.org"]);
    const second = directory.ensureMembers([], ["outsider@example.org"]);
    expect(first).toBe(second);
    expect(members).toHaveBeenCalledTimes(1);
  });
});
