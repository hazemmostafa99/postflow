# Post Flow — Time Spacing Feature Overview

## Overview

Add a **minimum time spacing** option when a user creates or uploads multiple posts in the same Post Flow.

Instead of scheduling all posts at the same time, the system will automatically add a delay between each post.

Example:

- Selected spacing: **3 minutes**
- First post: **10:00 AM**
- Second post: **10:03 AM**
- Third post: **10:06 AM**
- Fourth post: **10:09 AM**

The spacing value represents the **minimum delay between consecutive posts**.

---

## Goal

Prevent multiple posts from being published at exactly the same time and give the user control over the interval between posts.

---

## User Flow

1. User creates/selects multiple posts inside Post Flow.
2. User chooses the starting publish time.
3. User enables **Space posts apart**.
4. User selects a spacing duration.
5. System previews the calculated publish time for every post.
6. User confirms the flow.
7. Posts are scheduled using the calculated times.

---

## UI Requirements

### Time Spacing Control

Add a control inside the Post Flow scheduling section.

Suggested UI:

- Toggle: `Space posts apart`
- Label: `Minimum time between posts`
- Preset values:
  - 1 minute
  - 2 minutes
  - 3 minutes
  - 5 minutes
  - 10 minutes
  - 15 minutes
  - 30 minutes
- Optional custom value.

Recommended internal representation: **minutes as an integer**.

Example:

```ts
spacingMinutes: 3
```

### Schedule Preview

Before confirmation, display the calculated time beside every post.

Example:

```text
Post 1    10:00 AM
Post 2    10:03 AM
Post 3    10:06 AM
Post 4    10:09 AM
```

If the user changes the spacing value, preview times should update immediately.

---

## Scheduling Logic

Given:

- `startTime`
- `spacingMinutes`
- ordered list of posts

For post at index `i`:

```ts
scheduledAt = startTime + i * spacingMinutes
```

Example implementation:

```ts
function calculatePostSchedule(
  startTime: Date,
  posts: Post[],
  spacingMinutes: number,
) {
  return posts.map((post, index) => ({
    ...post,
    scheduledAt: new Date(
      startTime.getTime() + index * spacingMinutes * 60 * 1000,
    ),
  }));
}
```

---

## Validation Rules

- Spacing must be greater than `0` when the feature is enabled.
- Recommended minimum: `1 minute`.
- Backend must validate the value; frontend validation alone is not enough.
- The order used to calculate scheduled times must match the Post Flow order.
- A user cannot submit an invalid or negative spacing value.
- If custom spacing is supported, define a reasonable maximum limit.

Example validation:

```ts
if (spacePostsApart && spacingMinutes < 1) {
  throw new Error('Spacing must be at least 1 minute');
}
```

---

## Suggested Data Model

At Post Flow level:

```ts
interface PostFlow {
  id: string;
  startTime: Date;
  spacePostsApart: boolean;
  spacingMinutes: number | null;
}
```

Each post should still store its final calculated `scheduledAt` value.

Example:

```ts
interface ScheduledPost {
  id: string;
  flowId: string;
  order: number;
  scheduledAt: Date;
}
```

Keeping `scheduledAt` on each post makes execution reliable even if Post Flow settings later change.

---

## API Example

### Request

```json
{
  "startTime": "2026-09-20T10:00:00.000Z",
  "spacePostsApart": true,
  "spacingMinutes": 3,
  "posts": [
    { "id": "post_1", "order": 0 },
    { "id": "post_2", "order": 1 },
    { "id": "post_3", "order": 2 }
  ]
}
```

### Result

```json
{
  "posts": [
    {
      "id": "post_1",
      "scheduledAt": "2026-09-20T10:00:00.000Z"
    },
    {
      "id": "post_2",
      "scheduledAt": "2026-09-20T10:03:00.000Z"
    },
    {
      "id": "post_3",
      "scheduledAt": "2026-09-20T10:06:00.000Z"
    }
  ]
}
```

---

## Editing an Existing Flow

When the user changes:

- Start time
- Spacing duration
- Post order
- Number of posts

recalculate future unpublished posts.

Already-published posts must never be rescheduled.

Recommended behavior for partially completed flows:

1. Keep published posts unchanged.
2. Find the next unpublished post.
3. Recalculate only the remaining posts using the updated settings.

---

## Edge Cases

### One Post Only

Spacing has no practical effect. The first post uses `startTime`.

### Post Removed

Recalculate scheduled times for posts after the removed post if the flow has not started yet.

### Post Reordered

Recalculate schedule based on the new order.

### Flow Already Started

Do not modify published posts. Apply changes only to eligible future posts.

### Scheduling Conflict

If another business rule prevents posting at the calculated time, the backend should return a clear validation error or move the post according to the application's scheduling policy.

### Time Zones

Store schedule timestamps in UTC on the backend and convert to the user's timezone for display.

---

## Acceptance Criteria

- User can enable or disable time spacing.
- User can select at least 2-minute and 3-minute spacing values.
- User can see calculated publish times before confirming.
- Every post receives a unique scheduled time when spacing is enabled.
- Difference between consecutive posts is at least the selected spacing.
- Backend validates spacing.
- Reordering posts updates the preview correctly.
- Editing spacing updates future scheduled posts correctly.
- Published posts are never changed.
- Scheduling works consistently across time zones.

---

## Future Improvements

Possible later additions:

- Different spacing per social platform.
- Randomized spacing within a range, e.g. 2–5 minutes.
- Recommended spacing based on platform limits.
- Per-post manual override.
- Skip defined quiet hours.
- Different spacing presets saved per user/workspace.
