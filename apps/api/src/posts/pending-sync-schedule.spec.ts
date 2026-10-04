import {
  getNextPendingPostCheckAt,
  getPendingPostCheckDelayMs,
} from './pending-sync-schedule';

describe('pending sync schedule', () => {
  const submittedAt = new Date('2026-01-01T00:00:00.000Z');

  it.each([
    ['under one hour', '2026-01-01T00:59:59.999Z', 10 * 60_000],
    ['at one hour', '2026-01-01T01:00:00.000Z', 30 * 60_000],
    ['at six hours', '2026-01-01T06:00:00.000Z', 60 * 60_000],
    ['at one day', '2026-01-02T00:00:00.000Z', 3 * 60 * 60_000],
    ['at seven days', '2026-01-08T00:00:00.000Z', 24 * 60 * 60_000],
  ])('uses the approved interval %s', (_label, now, expectedDelay) => {
    expect(getPendingPostCheckDelayMs(submittedAt, new Date(now))).toBe(
      expectedDelay,
    );
  });

  it('doubles technical failures and caps the delay at 24 hours', () => {
    const checkedAt = new Date('2026-01-01T00:30:00.000Z');
    expect(
      getNextPendingPostCheckAt(submittedAt, checkedAt, true, checkedAt),
    ).toEqual(new Date('2026-01-01T00:50:00.000Z'));

    const lateCheckedAt = new Date('2026-01-08T00:00:00.000Z');
    expect(
      getNextPendingPostCheckAt(
        submittedAt,
        lateCheckedAt,
        true,
        lateCheckedAt,
      ),
    ).toEqual(new Date('2026-01-09T00:00:00.000Z'));
  });
});
