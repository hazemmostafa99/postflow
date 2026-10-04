export const MIN_RANDOM_POST_SPACING_SECONDS = 30;
export const MAX_RANDOM_POST_SPACING_SECONDS = 120;

export interface PostFlowScheduleItem<T> {
  post: T;
  order: number;
}

export interface ScheduledPostFlowItem<T> extends PostFlowScheduleItem<T> {
  scheduledAt: Date;
}

export interface CalculatePostScheduleOptions<T> {
  startTime: Date;
  posts: PostFlowScheduleItem<T>[];
  /** Injectable for deterministic tests. Must behave like Math.random. */
  random?: () => number;
}

/**
 * Calculate immutable schedule values in Post Flow order.
 *
 * The first destination uses `startTime`. Every following destination is
 * spaced from the previous one by a newly generated 30-120 second delay.
 * Generated timestamps are persisted by callers, so polling never rerolls
 * the schedule.
 */
export function calculatePostSchedule<T>({
  startTime,
  posts,
  random = Math.random,
}: CalculatePostScheduleOptions<T>): ScheduledPostFlowItem<T>[] {
  validateStartTime(startTime);

  let elapsedMilliseconds = 0;
  return [...posts]
    .sort((left, right) => left.order - right.order)
    .map((item, index) => {
      if (index > 0) {
        elapsedMilliseconds += randomSpacingSeconds(random) * 1000;
      }

      return {
        ...item,
        scheduledAt: new Date(startTime.getTime() + elapsedMilliseconds),
      };
    });
}

function validateStartTime(startTime: Date) {
  if (!(startTime instanceof Date) || Number.isNaN(startTime.getTime())) {
    throw new Error('Start time must be a valid date');
  }
}

function randomSpacingSeconds(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error('Random source must return a number from 0 up to 1');
  }

  const inclusiveRange =
    MAX_RANDOM_POST_SPACING_SECONDS - MIN_RANDOM_POST_SPACING_SECONDS + 1;
  return MIN_RANDOM_POST_SPACING_SECONDS + Math.floor(value * inclusiveRange);
}
