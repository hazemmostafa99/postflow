# Post Flow — Automatic Destination Spacing

## Overview

Every post sent to multiple publishing destinations is processed in order with
an automatic random delay between destinations. Users do not configure or
disable this delay.

The delay between each pair of consecutive destinations is independently
selected from **30 through 120 seconds**, inclusive.

## Publishing modes

### Now

- The first destination is eligible immediately.
- Every later destination is scheduled 30–120 seconds after the previous one.

### Schedule

- The first destination uses the date and time selected by the user.
- Every later destination is scheduled 30–120 seconds after the previous one.

### Reschedule

- Only jobs that are still `PENDING` are changed.
- The first pending destination uses the new time, or becomes eligible
  immediately when the start-time field is cleared.
- Remaining pending destinations receive new 30–120-second gaps.
- Running, published, failed, canceled, or otherwise completed jobs are never
  rescheduled.

## Scheduling logic

The backend owns randomization. Starting with an elapsed duration of zero, it
sorts destinations by Post Flow order and adds a new random delay before every
destination except the first:

```ts
let elapsedSeconds = 0;

orderedDestinations.map((destination, index) => {
  if (index > 0) {
    elapsedSeconds += randomIntegerBetween(30, 120);
  }

  return {
    destination,
    scheduledAt: new Date(startTime.getTime() + elapsedSeconds * 1000),
  };
});
```

Each calculated `scheduledAt` value is persisted on its publishing job. The
schedule is generated once when a post is created or explicitly rescheduled;
polling and page refreshes do not reroll it.

## UI requirements

- The Create New Post form offers `Now` and `Schedule` modes.
- There is no “Space destinations apart” checkbox or fixed-interval selector.
- The form explains that destinations use random 30–120-second gaps.
- Before creation or rescheduling, the UI shows the exact first time and
  describes later entries as “30–120 sec after previous.”
- After saving, persisted job timestamps are displayed wherever exact schedule
  times are available.

## Validation and edge cases

- The selected scheduled start must be a valid date.
- A single destination uses the start time and consumes no random value.
- Destination order must be preserved.
- Random delay bounds are inclusive.
- Timestamps are stored in UTC and displayed in the user's local timezone.
- Backend job claiming must continue to reject jobs whose `scheduledFor` time
  is still in the future.

## Acceptance criteria

- `Now` makes the first destination immediately eligible.
- `Schedule` keeps the first destination at the selected time.
- Consecutive scheduled timestamps differ by 30–120 seconds.
- Gaps are independently randomized and cumulative.
- Randomized timestamps remain stable after they are stored.
- The create and reschedule screens contain no manual spacing controls.
- Rescheduling changes pending jobs only.
