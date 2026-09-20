import {
  calculatePostSchedule,
  MAX_POST_SPACING_MINUTES,
} from './post-flow-time-spacing';

describe('calculatePostSchedule', () => {
  const startTime = new Date('2026-09-20T10:00:00.000Z');
  const posts = [
    { post: { id: 'post-3' }, order: 2 },
    { post: { id: 'post-1' }, order: 0 },
    { post: { id: 'post-2' }, order: 1 },
  ];

  it('spaces posts in Post Flow order', () => {
    const result = calculatePostSchedule({
      startTime,
      posts,
      spacePostsApart: true,
      spacingMinutes: 2,
    });

    expect(result.map((item) => item.post.id)).toEqual([
      'post-1',
      'post-2',
      'post-3',
    ]);
    expect(result.map((item) => item.scheduledAt.toISOString())).toEqual([
      '2026-09-20T10:00:00.000Z',
      '2026-09-20T10:02:00.000Z',
      '2026-09-20T10:04:00.000Z',
    ]);
  });

  it('supports three-minute spacing', () => {
    const result = calculatePostSchedule({
      startTime,
      posts: posts.slice(0, 2),
      spacePostsApart: true,
      spacingMinutes: 3,
    });

    expect(result[1].scheduledAt.toISOString()).toBe(
      '2026-09-20T10:03:00.000Z',
    );
  });

  it('uses the same start time when spacing is disabled', () => {
    const result = calculatePostSchedule({
      startTime,
      posts,
      spacePostsApart: false,
      spacingMinutes: null,
    });

    expect(result.every((item) => item.scheduledAt.getTime() === startTime.getTime())).toBe(
      true,
    );
  });

  it('handles a single post', () => {
    const result = calculatePostSchedule({
      startTime,
      posts: [posts[1]],
      spacePostsApart: true,
      spacingMinutes: 3,
    });

    expect(result[0].scheduledAt.toISOString()).toBe(startTime.toISOString());
  });

  it.each([0, -1, 1.5, null])(
    'rejects invalid enabled spacing: %s',
    (spacingMinutes) => {
      expect(() =>
        calculatePostSchedule({
          startTime,
          posts,
          spacePostsApart: true,
          spacingMinutes,
        }),
      ).toThrow('Spacing must be an integer');
    },
  );

  it('rejects spacing over the configured maximum', () => {
    expect(() =>
      calculatePostSchedule({
        startTime,
        posts,
        spacePostsApart: true,
        spacingMinutes: MAX_POST_SPACING_MINUTES + 1,
      }),
    ).toThrow('Spacing cannot exceed');
  });

  it('rejects an invalid start time', () => {
    expect(() =>
      calculatePostSchedule({
        startTime: new Date('invalid'),
        posts,
        spacePostsApart: false,
        spacingMinutes: null,
      }),
    ).toThrow('Start time must be a valid date');
  });
});
