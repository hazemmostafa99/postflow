import {
  getEngagementSyncDelayMs,
  getNextEngagementSyncAt,
} from './engagement-sync-schedule';

describe('engagement sync schedule', () => {
  const publishedAt = new Date('2026-01-01T00:00:00.000Z');

  it.each([
    ['under one hour', '2026-01-01T00:59:59.999Z', 15 * 60_000],
    ['at one hour', '2026-01-01T01:00:00.000Z', 30 * 60_000],
    ['at six hours', '2026-01-01T06:00:00.000Z', 2 * 60 * 60_000],
    ['at one day', '2026-01-02T00:00:00.000Z', 6 * 60 * 60_000],
    ['at seven days', '2026-01-08T00:00:00.000Z', 24 * 60 * 60_000],
  ])('uses the approved interval %s', (_label, now, expectedDelay) => {
    expect(getEngagementSyncDelayMs(publishedAt, new Date(now))).toBe(
      expectedDelay,
    );
  });

  it('backs off failures but never beyond one day', () => {
    const syncedAt = new Date('2026-01-01T00:30:00.000Z');
    expect(
      getNextEngagementSyncAt(publishedAt, syncedAt, false, syncedAt),
    ).toEqual(new Date('2026-01-01T00:45:00.000Z'));
    expect(
      getNextEngagementSyncAt(publishedAt, syncedAt, true, syncedAt),
    ).toEqual(new Date('2026-01-01T01:00:00.000Z'));
    const lateSync = new Date('2026-01-08T00:00:00.000Z');
    expect(
      getNextEngagementSyncAt(publishedAt, lateSync, true, lateSync),
    ).toEqual(new Date('2026-01-09T00:00:00.000Z'));
  });
});
