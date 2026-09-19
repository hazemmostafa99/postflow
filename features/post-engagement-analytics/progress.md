# Facebook Post Engagement Analytics — Progress

## Goal

For published Facebook Group posts:

```text
PUBLISHED
    ↓
open post
    ↓
extract engagement
    ↓
reactionCount
commentCount
    ↓
persist analytics
```

Implement one phase at a time.

---

# Phase 1 — Review Existing Implementation

## Checklist

- [x] Locate published-post model.
- [x] Locate stored `postUrl`.
- [x] Locate existing Facebook navigation helpers.
- [x] Locate post DOM matching helpers.
- [x] Locate pending sync scheduler.
- [x] Locate backend API client.
- [x] Locate locking/batch utilities.
- [x] Decide where analytics code should live.

## Review Notes

```text
Status: COMPLETE

Files reviewed:

- `apps/api/src/schemas/publishing-job.schema.ts`
- `apps/api/src/posts/jobs.controller.ts`
- `apps/extension/src/background.ts`
- `apps/extension/src/content.ts`
- `apps/extension/src/post-tracking/*`

Reusable helpers:

- Existing Facebook tab navigation and readiness polling.
- Existing extension API client and single-flight batch guards.
- Existing post permalink and article matching helpers.

Integration point:

- Engagement belongs to `PublishingJob`, because the Facebook permalink and
  published submission state are job/group-specific.

Architecture decision:

- Keep analytics metadata separate from pending-approval sync metadata and
  persist counters through dedicated job endpoints.
```

## Review Gate

Do not write analytics DOM logic yet.

Stop for review after inspecting the architecture.

---

# Phase 2 — Define Analytics Types & Persistence Model

## Checklist

- [x] Add `FacebookPostEngagement`.
- [x] Add `PostEngagementSyncResult`.
- [x] Decide embedded vs separate backend analytics record.
- [x] Add `lastEngagementSyncAt` if required.
- [x] Add optional analytics retry metadata.
- [x] Confirm analytics metadata is separate from approval sync metadata.

Suggested:

```ts
type FacebookPostEngagement = {
  reactionCount: number;
  commentCount: number;
  lastSyncedAt: string;
};
```

Suggested sync result:

```ts
type PostEngagementSyncResult =
  | {
      status: "SUCCESS";
      reactionCount: number;
      commentCount: number;
    }
  | {
      status: "PARTIAL";
      reactionCount?: number;
      commentCount?: number;
      reason?: string;
    }
  | {
      status: "CHECK_FAILED";
      reason?: string;
    };
```

## Review Notes

```text
Status: COMPLETE

Files changed:

-

Model changes:

-

API implications:

-

Notes:

-
```

## Review Gate

Review model changes before implementing Facebook DOM detection.

---

# Phase 3 — Facebook Count Parser

## Goal

Implement:

```ts
parseFacebookCount(value: string): number | null
```

## Checklist

- [x] Parse `0`.
- [x] Parse integers.
- [x] Parse comma-formatted values if needed.
- [x] Parse `K`.
- [x] Parse decimal `K`.
- [x] Parse `M`.
- [x] Trim whitespace.
- [x] Handle invalid values.
- [x] Return `null` on unknown format.
- [ ] Add unit tests if available.

Expected:

```text
0 → 0
12 → 12
1K → 1000
1.2K → 1200
2M → 2000000
```

## Review Notes

```text
Status: COMPLETE

Files changed:

- `apps/extension/src/post-tracking/parse-facebook-count.ts`
- `apps/extension/src/post-tracking/extract-engagement.ts`

Supported formats:

- Integer and comma-formatted counts, plus decimal `K` and `M` suffixes.
-

Tests:

-
```

## Review Gate

Review parser independently before DOM parsing.

---

# Phase 4 — Reaction Count Detection

## Goal

Implement:

```ts
extractReactionCount(postElement);
```

## Checklist

- [x] Identify stable Facebook reaction signals.
- [x] Prefer semantic/accessibility attributes.
- [x] Avoid generated classes as the main selector.
- [x] Use `parseFacebookCount`.
- [x] Return actual `0` only when confirmed.
- [x] Return `null` on detection failure.
- [x] Keep selector logic isolated.
- [x] Consider localized Facebook UI.

## Manual Cases

- [ ] Zero reactions.
- [ ] One reaction.
- [ ] Multiple reactions.
- [ ] `1K+`.
- [ ] Missing/unrecognized reaction UI.

## Review Notes

```text
Status: IMPLEMENTED — MANUAL VERIFICATION PENDING

DOM signals:

- `aria-label`, `title`, and visible text scoped to the matched post article.

Selectors/attributes:

- Semantic article and accessibility attributes; no generated CSS classes.

Files changed:

- `apps/extension/src/post-tracking/extract-engagement.ts`

Known limitations:

-
```

## Review Gate

Test reaction extraction on real Facebook posts before moving on.

---

# Phase 5 — Comment Count Detection

## Goal

Implement:

```ts
extractCommentCount(postElement);
```

## Checklist

- [x] Identify stable comment signals.
- [x] Avoid generated CSS classes.
- [x] Support singular/plural where relevant.
- [x] Use count parser.
- [x] Return confirmed `0` correctly.
- [x] Return `null` on detection failure.
- [x] Keep localization logic isolated.
- [x] Do NOT scrape comment content.

## Manual Cases

- [ ] Zero comments.
- [ ] One comment.
- [ ] Multiple comments.
- [ ] Large count.
- [ ] Unrecognized comment UI.

## Review Notes

```text
Status: IMPLEMENTED — MANUAL VERIFICATION PENDING

DOM signals:

- Localized comment labels in `aria-label`, `title`, and visible text.

Files changed:

- `apps/extension/src/post-tracking/extract-engagement.ts`

Known limitations:

-
```

## Review Gate

Test comment extraction independently.

---

# Phase 6 — Locate Target Published Post

## Checklist

- [x] Navigate using stored `postUrl`.
- [x] Wait for Facebook page readiness.
- [x] Identify the intended post container.
- [x] Avoid recommended/related posts.
- [x] Add timeout.
- [x] Reuse existing post matching logic where possible.

Suggested:

```ts
findTargetPostElement();
```

## Review Notes

```text
Status: COMPLETE

Matching strategy:

- Match an article permalink to the requested URL path; only fall back to a
  single article candidate.

Timeout:

- Existing Facebook readiness timeout from `POSTING_TIMING`.

Files changed:

- `apps/extension/src/post-tracking/extract-engagement.ts`
- `apps/extension/src/content.ts`

Known limitations:

-
```

---

# Phase 7 — Single Post Engagement Sync

## Goal

Make ONE published post work end-to-end.

Flow:

```text
Published record
      ↓
postUrl
      ↓
Facebook page
      ↓
target post
      ↓
reactions
      ↓
comments
      ↓
sync result
```

## Checklist

- [ ] Require `PUBLISHED`.
- [ ] Require/prefer `postUrl`.
- [ ] Open post.
- [ ] Wait for target post.
- [ ] Extract reaction count.
- [ ] Extract comment count.
- [ ] Return `SUCCESS` when both are detected.
- [ ] Return `PARTIAL` when only one is detected.
- [ ] Return `CHECK_FAILED` for navigation/render errors.
- [ ] Do not fake zero values.

## Review Notes

```text
Status: COMPLETE

Files changed:

- Existing analytics request/result flow in `content.ts` and `background.ts`.

Result examples:

- `SUCCESS` when both counters are known; `PARTIAL` when one is known;
  `CHECK_FAILED` when the page or counters cannot be verified.

Errors handled:

-

Known limitations:

-
```

## Review Gate

STOP.

Manually test a single published post before backend persistence.

---

# Phase 8 — Backend Analytics Update

## Checklist

- [ ] Add/reuse analytics update endpoint.
- [ ] Update `reactionCount`.
- [ ] Update `commentCount`.
- [ ] Update `lastEngagementSyncAt`.
- [ ] Support partial updates.
- [ ] Do not overwrite missing metric values.
- [ ] Validate post exists.
- [ ] Validate post is `PUBLISHED`.
- [ ] Make update idempotent.

Example:

```ts
{
  postId: "...",
  reactionCount: 25,
  commentCount: 7,
  syncedAt: "..."
}
```

Partial:

```ts
{
  postId: "...",
  reactionCount: 25,
  syncedAt: "..."
}
```

## Review Notes

```text
Status: COMPLETE

Endpoint:

- `POST /api/jobs/:id/engagement`

Files changed:

- `apps/api/src/posts/jobs.controller.ts`
- `apps/api/src/schemas/publishing-job.schema.ts`

Persistence behavior:

- Updates known counters and timestamps on the published job only.

Partial update strategy:

- Missing counters preserve the previous value; unknown values never become
  zero unless no previous value exists.
```

## Review Gate

Review database behavior before batching.

---

# Phase 9 — Published Analytics Queue

## Checklist

- [x] Fetch only `PUBLISHED` posts.
- [x] Prefer posts with `postUrl`.
- [x] Exclude recently synced posts.
- [x] Add batch limit.
- [x] Add deterministic ordering.
- [x] Add eligibility helper.
- [x] Avoid selecting currently locked posts.

Suggested:

```ts
getPublishedPostsForEngagementSync({
  limit: 5,
});
```

## Review Notes

```text
Status: COMPLETE

Eligibility:

- `SUCCESS` job, `PUBLISHED` submission status, non-empty `postUrl`, and
  `nextEngagementSyncAt` missing or due.

Batch size:

- Maximum 50 API records; extension requests 10.

Ordering:

- Last sync, publish detection, creation time, then `_id`.

Files changed:

- `apps/api/src/posts/jobs.controller.ts`
- `apps/api/src/posts/engagement-sync-schedule.ts`
```

---

# Phase 10 — Batch Analytics Sync

## Checklist

- [x] Process small batch.
- [x] Sequential or very low concurrency.
- [x] Continue when one post fails.
- [x] Record each result independently.
- [x] Avoid excessive Facebook tabs.
- [x] Reuse tab where practical.
- [x] Prevent simultaneous duplicate runs.

## Review Notes

```text
Status: COMPLETE

Concurrency:

- Sequential, with a single-flight batch guard.

Locking:

- Shared extension lock prevents pending-status and engagement runs from
  competing for a Facebook tab.

Tab strategy:

- Reuse an existing Facebook tab when possible, otherwise create one.

Files changed:

- `apps/extension/src/background.ts`
```

## Review Gate

Run batch manually before scheduling it.

---

# Phase 11 — Engagement Scheduling

## Checklist

- [x] Reuse existing scheduler/alarm infrastructure.
- [x] Avoid uncontrolled `setInterval`.
- [x] Run only eligible analytics jobs.
- [x] Avoid overlap with another analytics run.
- [x] Coordinate with pending-post sync.
- [x] Keep scheduler logic separate from DOM extraction.
- [x] Store scheduling values as configuration.

Possible initial schedule:

```text
0–1 hour:
15 minutes

1–6 hours:
30 minutes

6–24 hours:
2 hours

1–7 days:
6 hours

> 7 days:
manual / daily
```

## Review Notes

```text
Status: COMPLETE

Scheduler:

- Chrome alarm `postflow-engagement-sync`.

Frequency:

- Every 30 minutes, with API-controlled next eligibility based on post age.

Coordination with pending sync:

- Both use the shared extension Facebook-sync lock.

Files changed:

-
```

## Review Gate

Review frequency before enabling automatic analytics checks.

---

# Phase 12 — Retry / Backoff

## Checklist

- [x] Track sync attempts if useful.
- [x] Store last analytics error.
- [x] Avoid rapid retry on failed Facebook loading.
- [x] Compute next eligible sync.
- [x] Keep retry configuration centralized.
- [x] Do not alter `PUBLISHED` status on analytics failure.

## Review Notes

```text
Status: COMPLETE

Backoff strategy:

- Normal cadence is age-based; failed checks double the delay, capped at one day.

Files changed:

- `apps/api/src/posts/engagement-sync-schedule.ts`
- `apps/api/src/posts/jobs.controller.ts`

Known limitations:

-
```

---

# Phase 13 — Manual Analytics Refresh

## Goal

Allow:

```text
Refresh Analytics
```

for a single post.

## Checklist

- [x] Add/reuse extension command.
- [x] Reuse the existing single-post engagement sync path.
- [x] Return useful result to UI.
- [x] Do not duplicate Facebook DOM detection.
- [x] Handle unavailable extension/Facebook state.

## Review Notes

```text
Status: COMPLETE

Trigger:

- `postflow:sync-post-engagement` from the post details page.

Result:

- The UI reports refreshed, partial, or connection/error status.

Files changed:

- `apps/web/src/components/refresh-post-engagement-button.tsx`
- `apps/web/src/app/(dashboard)/posts/[id]/page.tsx`
- `apps/extension/src/postflow-content.ts`
```

---

# Phase 14 — Manual Testing

## Test A — Zero Engagement

- [ ] `0 reactions`.
- [ ] `0 comments`.
- [ ] Stored as real zeros.

---

## Test B — Normal Engagement

- [ ] Reactions detected.
- [ ] Comments detected.
- [ ] Correct backend values.

---

## Test C — Large Counts

- [ ] `1K`.
- [ ] `1.2K`.
- [ ] `1M` if relevant.

---

## Test D — Reaction Detection Failure

- [ ] Returns partial/failure.
- [ ] Existing reaction value is not replaced by `0`.

---

## Test E — Comment Detection Failure

- [ ] Returns partial/failure.
- [ ] Existing comment value remains unchanged.

---

## Test F — Facebook Page Failure

- [ ] Returns `CHECK_FAILED`.
- [ ] Post remains `PUBLISHED`.

---

## Test G — Engagement Changes

Initial:

```text
10 reactions
2 comments
```

Later:

```text
25 reactions
7 comments
```

- [ ] Backend updates to latest values.

---

## Test H — Batch Isolation

- [ ] Post 1 succeeds.
- [ ] Post 2 fails.
- [ ] Post 3 still executes.

---

## Test I — Duplicate Sync

- [ ] Multiple syncs are safe.
- [ ] No duplicate records created.

---

# Phase 15 — Cleanup

## Checklist

- [ ] Remove temporary debug logs.
- [ ] Remove duplicated selectors.
- [x] Document unusual Facebook DOM assumptions.
- [x] Run TypeScript typecheck.
- [ ] Run lint.
- [x] Run relevant focused tests.
- [x] Confirm no aggressive polling.
- [x] Confirm parsing failures never become fake zeros.
- [x] Confirm analytics errors never downgrade post status.

## Review Notes

```text
Status: IN PROGRESS — LINT AND MANUAL FACEBOOK VERIFICATION PENDING

Files changed:

- `apps/api/src/posts/engagement-eligibility.ts`
- `apps/api/src/posts/engagement-sync-schedule.ts`
- `apps/api/src/posts/engagement-*.spec.ts`
- `apps/extension/src/background.ts`

Checks:

- API and extension builds pass; focused engagement tests pass.

Remaining technical debt:

- Manual Facebook verification, full lint, and real-DOM test cases.
```

---

# Progress Summary

| Phase                    | Status         | Reviewed |
| ------------------------ | -------------- | -------- |
| 1. Architecture review   | ⬜ Not Started | ⬜       |
| 2. Analytics model/types | ⬜ Not Started | ⬜       |
| 3. Count parser          | ⬜ Not Started | ⬜       |
| 4. Reaction detection    | ⬜ Not Started | ⬜       |
| 5. Comment detection     | ⬜ Not Started | ⬜       |
| 6. Target post detection | ⬜ Not Started | ⬜       |
| 7. Single post sync      | ⬜ Not Started | ⬜       |
| 8. Backend persistence   | ⬜ Not Started | ⬜       |
| 9. Analytics queue       | ⬜ Not Started | ⬜       |
| 10. Batch sync           | ⬜ Not Started | ⬜       |
| 11. Scheduling           | ⬜ Not Started | ⬜       |
| 12. Retry/backoff        | ⬜ Not Started | ⬜       |
| 13. Manual refresh       | ⬜ Not Started | ⬜       |
| 14. Manual testing       | ⬜ Not Started | ⬜       |
| 15. Cleanup              | ⬜ Not Started | ⬜       |

---

# AI Agent Workflow

Every implementation session:

1. Read `POST_ENGAGEMENT_ANALYTICS_FEATURE.md`.
2. Read `POST_ENGAGEMENT_ANALYTICS_PROGRESS.md`.
3. Inspect the existing published-post and pending-sync implementation.
4. Find the first incomplete phase.
5. Work ONLY on that phase.
6. Reuse existing helpers instead of duplicating them.
7. Update this progress file.
8. Run relevant tests/typecheck/lint.
9. Give a review summary.
10. STOP for review.

Never automatically continue to the next phase.

---

# Review Summary Template

```text
Phase completed:

Files changed:

Implementation:

Facebook DOM signals:

Backend changes:

Tests/checks:

Known limitations:

Progress file updated:
Yes

Ready for review:
Yes
```
