import { getEngagementSyncDelayMs, getNextEngagementSyncAt } from './engagement-sync-schedule';

describe('engagement sync schedule', () => {
  const publishedAt = new Date('2026-01-01T00:00:00.000Z');

  it('refreshes more frequently for newer posts', () => {
    expect(getEngagementSyncDelayMs(publishedAt, new Date('2026-01-01T00:30:00.000Z'))).toBe(15 * 60_000);
    expect(getEngagementSyncDelayMs(publishedAt, new Date('2026-01-01T03:00:00.000Z'))).toBe(30 * 60_000);
    expect(getEngagementSyncDelayMs(publishedAt, new Date('2026-01-02T00:00:00.000Z'))).toBe(6 * 60 * 60_000);
  });

  it('backs off failures but never beyond one day', () => {
    const syncedAt = new Date('2026-01-01T00:30:00.000Z');
    expect(getNextEngagementSyncAt(publishedAt, syncedAt, false, syncedAt)).toEqual(
      new Date('2026-01-01T00:45:00.000Z'),
    );
    const lateSync = new Date('2026-01-08T00:00:00.000Z');
    expect(getNextEngagementSyncAt(publishedAt, lateSync, true, lateSync)).toEqual(
      new Date('2026-01-09T00:00:00.000Z'),
    );
  });
});
