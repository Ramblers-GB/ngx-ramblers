import { BatchSendProgress, BatchSendProgressEvent } from "../models/email-composer.model";

export function mergeBatchProgress(previous: BatchSendProgress | null, event: BatchSendProgressEvent, byId: Map<string, number>): BatchSendProgress {
  const entries = event.snapshot ? event.progress.entries : event.progress.entries.length > 0 ? [...(previous?.entries ?? [])] : previous?.entries ?? [];
  if (event.snapshot) {
    byId.clear();
    entries.forEach((entry, index) => byId.set(entry.memberId, index));
  }
  if (!event.snapshot) {
    event.progress.entries.forEach(entry => {
      const index = byId.get(entry.memberId);
      if (!byId.has(entry.memberId)) {
        byId.set(entry.memberId, entries.length);
        entries.push(entry);
      } else {
        entries[index] = entry;
      }
    });
  }
  return {...previous, ...event.progress, entries};
}
