const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Normal refresh cadence based on the age of the published Facebook post. */
export function getEngagementSyncDelayMs(publishedAt: Date, now = new Date()): number {
  const ageMs = Math.max(0, now.getTime() - publishedAt.getTime());
  if (ageMs < HOUR_MS) return 15 * MINUTE_MS;
  if (ageMs < 6 * HOUR_MS) return 30 * MINUTE_MS;
  if (ageMs < DAY_MS) return 2 * HOUR_MS;
  if (ageMs < 7 * DAY_MS) return 6 * HOUR_MS;
  return DAY_MS;
}

/** Schedule the next attempt, doubling failures but capping retries at one day. */
export function getNextEngagementSyncAt(
  publishedAt: Date,
  syncedAt: Date,
  failed = false,
  now = new Date(),
): Date {
  const normalDelay = getEngagementSyncDelayMs(publishedAt, now);
  const delay = failed ? Math.min(normalDelay * 2, DAY_MS) : normalDelay;
  return new Date(syncedAt.getTime() + delay);
}
