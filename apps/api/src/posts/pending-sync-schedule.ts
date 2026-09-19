const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Return the normal delay based on how long the post has been pending. */
export function getPendingPostCheckDelayMs(submittedAt: Date, now = new Date()): number {
  const ageMs = Math.max(0, now.getTime() - submittedAt.getTime());
  if (ageMs < HOUR_MS) return 10 * MINUTE_MS;
  if (ageMs < 6 * HOUR_MS) return 30 * MINUTE_MS;
  if (ageMs < 24 * HOUR_MS) return HOUR_MS;
  if (ageMs < 7 * 24 * HOUR_MS) return 3 * HOUR_MS;
  return 24 * HOUR_MS;
}

/**
 * Calculate the next eligible check from the last completed check. The
 * failure multiplier is deliberately capped so technical errors cannot cause
 * rapid polling.
 */
export function getNextPendingPostCheckAt(
  submittedAt: Date,
  lastCheckedAt: Date,
  failed = false,
  now = new Date(),
): Date {
  const normalDelay = getPendingPostCheckDelayMs(submittedAt, now);
  const delay = failed ? Math.min(normalDelay * 2, 24 * HOUR_MS) : normalDelay;
  return new Date(lastCheckedAt.getTime() + delay);
}
