import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberBulkLoadService } from "./member-bulk-load.service";
import { MemberBulkLoadAuditService } from "./member-bulk-load-audit.service";
import { LoggerFactory } from "../logger-factory.service";
import { StringUtilsService } from "../string-utils.service";
import { MemberBulkLoadAudit } from "../../models/member.model";

describe("MemberBulkLoadService", () => {
  let service: MemberBulkLoadService;
  const auditService = {create: vi.fn(), apply: vi.fn()};
  const notify = {setBusy: vi.fn(), progress: vi.fn()};

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        {provide: MemberBulkLoadAuditService, useValue: auditService},
        {provide: StringUtilsService, useValue: {pluraliseWithCount: (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`}},
        {provide: LoggerFactory, useValue: {createLogger: () => ({info: vi.fn(), debug: vi.fn(), error: vi.fn(), off: vi.fn()})}}
      ]
    });
    service = TestBed.inject(MemberBulkLoadService);
  });

  it("creates the upload session and asks the server to apply it", async () => {
    auditService.create.mockResolvedValue({id: "session-1"});
    auditService.apply.mockResolvedValue({uploadSessionId: "session-1", total: 3, created: 1, updated: 1, skipped: 1, failed: 0, durationMs: 2000});
    const result = await service.processResponse({members: [{}, {}, {}]} as MemberBulkLoadAudit, notify as any);

    expect(result.uploadSessionId).toBe("session-1");
    expect(auditService.apply).toHaveBeenCalledWith("session-1");
    expect(notify.progress).toHaveBeenLastCalledWith(expect.objectContaining({message: "Finished processing 3 members in 2s: 1 created, 1 updated, 1 unchanged"}), true);
  });

  it("says how many members could not be saved", () => {
    expect(service.finishedMessage({uploadSessionId: "s", total: 10, created: 2, updated: 3, skipped: 4, failed: 1, durationMs: 500}))
      .toBe("Finished processing 10 members in 1s: 2 created, 3 updated, 4 unchanged; 1 member could not be saved");
  });
});
