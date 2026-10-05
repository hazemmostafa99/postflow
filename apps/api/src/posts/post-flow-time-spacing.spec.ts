import {
  calculatePostSchedule,
  MAX_RANDOM_POST_SPACING_SECONDS,
  MIN_RANDOM_POST_SPACING_SECONDS,
} from './post-flow-time-spacing';

describe('calculatePostSchedule', () => {
  const startTime = new Date('2026-09-20T10:00:00.000Z');
  const posts = [
    { post: { id: 'post-3' }, order: 2 },
    { post: { id: 'post-1' }, order: 0 },
    { post: { id: 'post-2' }, order: 1 },
  ];

  it('spaces posts cumulatively in Post Flow order', () => {
    const randomValues = [0, 0.5];
    const result = calculatePostSchedule({
      startTime,
      posts,
      random: () => randomValues.shift() ?? 0,
    });

    expect(result.map((item) => item.post.id)).toEqual([
      'post-1',
      'post-2',
      'post-3',
    ]);
    expect(result.map((item) => item.scheduledAt.toISOString())).toEqual([
      '2026-09-20T10:00:00.000Z',
      '2026-09-20T10:00:30.000Z',
      '2026-09-20T10:01:45.000Z',
    ]);
  });

  it('includes both the 30 and 120 second bounds', () => {
    const minimum = calculatePostSchedule({
      startTime,
      posts: posts.slice(0, 2),
      random: () => 0,
    });
    const maximum = calculatePostSchedule({
      startTime,
      posts: posts.slice(0, 2),
      random: () => 0.999999,
    });

    expect(
      (minimum[1].scheduledAt.getTime() - minimum[0].scheduledAt.getTime()) /
        1000,
    ).toBe(MIN_RANDOM_POST_SPACING_SECONDS);
    expect(
      (maximum[1].scheduledAt.getTime() - maximum[0].scheduledAt.getTime()) /
        1000,
    ).toBe(MAX_RANDOM_POST_SPACING_SECONDS);
  });

  it('does not consume randomness for a single post', () => {
    const random = jest.fn(() => 0.5);
    const result = calculatePostSchedule({
      startTime,
      posts: [posts[1]],
      random,
    });

    expect(result[0].scheduledAt.toISOString()).toBe(startTime.toISOString());
    expect(random).not.toHaveBeenCalled();
  });

  it('rejects an invalid random source value', () => {
    expect(() =>
      calculatePostSchedule({
        startTime,
        posts: posts.slice(0, 2),
        random: () => 1,
      }),
    ).toThrow('Random source must return');
  });

  it('rejects an invalid start time', () => {
    expect(() =>
      calculatePostSchedule({
        startTime: new Date('invalid'),
        posts,
      }),
    ).toThrow('Start time must be a valid date');
  });
});
