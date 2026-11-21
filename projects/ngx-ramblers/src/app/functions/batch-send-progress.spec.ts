import { describe, expect, it } from "vitest";
import { mergeBatchProgress } from "./batch-send-progress";
import { BatchSendEntryStatus, BatchSendProgress, BatchSendStatus } from "../models/email-composer.model";

describe("incremental email send progress", () => {
  const progress = (): BatchSendProgress => ({
    jobId: "example-job", status: BatchSendStatus.RUNNING, totalRecipients: 8000,
    sentCount: 0, failedCount: 0, skippedCount: 0, startedAt: 1, entries: []
  });

  it("merges 8000 individual updates without losing or duplicating recipients", () => {
    const indexes = new Map<string, number>();
    const result = Array.from({length: 8000}, (_, index) => index).reduce((previous, index) => {
      const event = {jobId: "example-job", snapshot: false, progress: {
        ...progress(), sentCount: index + 1,
        entries: [{memberId: `member-${index}`, fullName: "Alex Reed", email: `alex.${index}@example.com`, status: BatchSendEntryStatus.Sent}]
      }};
      expect(JSON.stringify(event).length).toBeLessThan(700);
      return mergeBatchProgress(previous, event, indexes);
    }, progress());
    expect(result.sentCount).toBe(8000);
    expect(result.entries).toHaveLength(8000);
    expect(new Set(result.entries.map(entry => entry.memberId)).size).toBe(8000);
  });

  it("replaces state on reconnect and updates an existing recipient in place", () => {
    const indexes = new Map<string, number>();
    const entry = {memberId: "member-1", email: "alex@example.com", fullName: "Alex Reed", status: BatchSendEntryStatus.Pending};
    const first = mergeBatchProgress(null, {jobId: "example-job", snapshot: true, progress: {...progress(), entries: [entry]}}, indexes);
    const second = mergeBatchProgress(first, {jobId: "example-job", snapshot: false, progress: {...progress(), sentCount: 1, entries: [{...entry, status: BatchSendEntryStatus.Sent}]}}, indexes);
    expect(second.entries).toHaveLength(1);
    expect(first.entries[0].status).toBe(BatchSendEntryStatus.Pending);
    expect(second.entries[0].status).toBe(BatchSendEntryStatus.Sent);
    const resumed = mergeBatchProgress(second, {jobId: "example-job", snapshot: true, progress: {...progress(), entries: []}}, indexes);
    expect(resumed.entries).toEqual([]);
    expect(indexes.size).toBe(0);
  });
});
