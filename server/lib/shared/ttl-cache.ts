import { TtlCached, TtlCacheEntry } from "./ttl-cache.model";
import { dateTimeNowAsValue } from "./dates";

export function ttlCached<T>(ttlMs: number, maxEntries: number | null = null): TtlCached<T> {
  const entries = new Map<string, TtlCacheEntry<T>>();

  const prune = () => {
    const now = dateTimeNowAsValue();
    const completed = [...entries].filter(([, entry]) => !entry.loadPromise);
    const expired = completed.filter(([, entry]) => entry.expiresAt <= now).map(([key]) => key);
    expired.forEach(key => entries.delete(key));
    if (maxEntries !== null) {
      completed.filter(([key]) => entries.has(key))
        .slice(0, Math.max(0, entries.size - maxEntries))
        .forEach(([key]) => entries.delete(key));
    }
  };

  return {
    get(key: string, loader: () => Promise<T>): Promise<T> {
      prune();
      const existing = entries.get(key);
      const now = dateTimeNowAsValue();
      if (existing?.loadPromise) {
        return existing.loadPromise;
      } else if (existing?.value !== undefined && existing.expiresAt > now) {
        return Promise.resolve(existing.value);
      } else {
        const loadPromise = loader()
          .then(value => {
            entries.set(key, {value, expiresAt: dateTimeNowAsValue() + ttlMs});
            prune();
            return value;
          })
          .catch(error => {
            entries.delete(key);
            throw error;
          });
        entries.set(key, {loadPromise, expiresAt: now + ttlMs});
        return loadPromise;
      }
    },
    clear(): void {
      entries.clear();
    }
  };
}
