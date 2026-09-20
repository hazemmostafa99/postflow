export const MIN_POST_SPACING_MINUTES = 1;

/**
 * Keep custom spacing bounded so a malformed request cannot create schedules
 * that are accidentally days apart. Presets can still be added later without
 * changing the scheduling contract.
 */
export const MAX_POST_SPACING_MINUTES = 24 * 60;

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
  spacePostsApart: boolean;
  spacingMinutes: number | null;
}

/**
 * Calculate immutable schedule values in Post Flow order.
 *
 * The returned array is sorted by `order`, which keeps the result deterministic
 * even if callers provide posts in a different order. The original Date and
 * post objects are never mutated.
 */
export function calculatePostSchedule<T>({
  startTime,
  posts,
  spacePostsApart,
  spacingMinutes,
}: CalculatePostScheduleOptions<T>): ScheduledPostFlowItem<T>[] {
  validateStartTime(startTime);
  const normalizedSpacing = validateSpacing(spacePostsApart, spacingMinutes);

  return [...posts]
    .sort((left, right) => left.order - right.order)
    .map((item, index) => ({
      ...item,
      scheduledAt: new Date(
        startTime.getTime() + index * normalizedSpacing * 60 * 1000,
      ),
    }));
}

function validateStartTime(startTime: Date) {
  if (!(startTime instanceof Date) || Number.isNaN(startTime.getTime())) {
    throw new Error('Start time must be a valid date');
  }
}

function validateSpacing(
  spacePostsApart: boolean,
  spacingMinutes: number | null,
): number {
  if (!spacePostsApart) return 0;

  if (
    spacingMinutes === null ||
    !Number.isInteger(spacingMinutes) ||
    spacingMinutes < MIN_POST_SPACING_MINUTES
  ) {
    throw new Error(
      `Spacing must be an integer of at least ${MIN_POST_SPACING_MINUTES} minute`,
    );
  }

  if (spacingMinutes > MAX_POST_SPACING_MINUTES) {
    throw new Error(
      `Spacing cannot exceed ${MAX_POST_SPACING_MINUTES} minutes`,
    );
  }

  return spacingMinutes;
}
