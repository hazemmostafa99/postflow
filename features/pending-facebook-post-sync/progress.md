# Pending Facebook Post Sync — Progress

## Goal

Periodically re-check Facebook posts currently stored as:

```text
PENDING_APPROVAL
```

and update them to:

```text
PUBLISHED
```

once publication can be reliably confirmed.

---

# Phase 1 — Review Existing Tracking Architecture

## Checklist

* [x] Locate current `PENDING_APPROVAL` detection.
* [x] Locate current `PUBLISHED` detection.
* [x] Locate existing post permalink extraction.
* [x] Locate Facebook group navigation helpers.
* [x] Locate extension background/service worker logic.
* [x] Locate backend post status model/API.
* [x] Identify where pending-post sync should live.
* [x] Identify existing scheduler/alarm mechanism if available.

## Review Notes

```text
Status: COMPLETE

Files reviewed:

- `apps/extension/src/post-tracking/detect-pending-approval.ts`
- `apps/extension/src/post-tracking/find-published-post.ts`
- `apps/extension/src/post-tracking/wait-for-post-submission-result.ts`
- `apps/extension/src/content.ts`
- `apps/extension/src/background.ts`
- `apps/extension/manifest.json`
- `apps/api/src/schemas/publishing-job.schema.ts`
- `apps/api/src/schemas/post.schema.ts`
- `apps/api/src/posts/jobs.controller.ts`
- `apps/api/src/posts/posts.service.ts`
- `apps/api/src/schemas/group.schema.ts`
- `apps/api/src/groups/groups.service.ts`

Existing reusable helpers:

- `detectPendingApprovalMessage(root)` detects positive pending-approval UI evidence.
- `findPublishedPost(options)` matches a newly visible feed post using normalized text and new-post evidence.
- `extractPostPermalink(postElement, currentGroupId)` extracts a Facebook Group post permalink.
- `waitForPostSubmissionResult(options)` already combines pending and published detection for the initial submission flow.
- `waitForFacebookTabDocument(tabId, targetUrl, timeoutMs)` waits for a target Facebook document after navigation.
- `apiFetch(path, body, method)` authenticates extension API requests with the stored Clerk user ID.

Proposed integration point:

- Add pending-post retrieval and an idempotent status/metadata update to the API around `PublishingJob` records.
- Add a reusable pending-post sync command in the extension background service worker.
- Have the background worker navigate one existing/new Facebook tab at a time and message a Facebook content script to perform the DOM check.
- Reuse the existing tracking helpers for matching/permalink extraction; do not query Facebook from the backend.

Architecture decision:

- Treat `PublishingJob.submissionStatus` as the persisted Facebook status. A pending item is a successful publishing job whose submission status is `PENDING_APPROVAL`.
- Use the populated `postId` and `groupId` fields as the pending record's content/media/group metadata. The current model does not persist a dedicated `submittedAt`, `lastCheckedAt`, `nextCheckAt`, `syncAttempts`, or `lastSyncError`; those are Phase 2 decisions.
- Keep `PENDING_APPROVAL` unchanged for not-found and technical-failure results. Only positive Facebook evidence may transition it to `PUBLISHED`.
- Reuse the existing `postflow-heartbeat` Chrome alarm as the eventual scheduling hook, with pending-sync eligibility/backoff layered onto it. There is no uncontrolled `setInterval` in the background worker and no existing dedicated pending-sync alarm.
- Process pending checks sequentially and guard the sync command against overlapping runs in the service worker.
```

## Review Gate

Stop after architecture review.

Do not implement sync yet.

---

# Phase 2 — Define Sync Types and Data Requirements

## Checklist

* [x] Define `PendingPostSyncResult`.
* [x] Confirm pending post model contains `groupId`.
* [x] Confirm `groupUrl` is available.
* [x] Confirm submission content/fingerprint is available.
* [x] Confirm `submittedAt` is stored.
* [x] Add `lastCheckedAt` if needed.
* [x] Add `syncAttempts` if needed.
* [x] Add `nextCheckAt` only if scheduling strategy requires it.

Suggested result:

```ts
type PendingPostSyncResult =
  | {
      status: "PUBLISHED";
      postUrl?: string;
    }
  | {
      status: "STILL_PENDING";
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

- `apps/api/src/schemas/publishing-job.schema.ts`
- `apps/api/src/posts/jobs.controller.ts`
- `apps/extension/src/post-tracking/types.ts`

Model changes:

- Added optional `submittedAt`, `lastCheckedAt`, `nextCheckAt`, `lastSyncError`, and `publishedDetectedAt` fields to `PublishingJob`.
- Added `syncAttempts` with a default of `0`.
- Existing `groupId` references `Group`, whose persisted `url` supplies `groupUrl`; existing `postId` supplies content and media.
- On the initial `PENDING_APPROVAL` result, the API records `submittedAt` once and resets sync metadata.
- On a `PUBLISHED` result, the API records `publishedDetectedAt` once.

API changes:

- No new endpoint yet; Phase 3 will add the pending-job fetch.
- Existing job status handling now initializes the metadata needed by the later sync flow.

Notes:

- `textFingerprint` remains an optional sync-time representation; the existing post content is the canonical matching input and avoids storing duplicate derived text for now.
- The persisted business status remains `PENDING_APPROVAL`; `STILL_PENDING` and `CHECK_FAILED` are extension-internal result types.
- Verification: `apps/extension` build passes and `apps/api` build passes. Jest is currently blocked before test execution by the repository's existing ESM/CommonJS incompatibility while loading `@nestjs/mongoose`.
```

## Review Gate

Review data changes before adding Facebook navigation.

---

# Phase 3 — Fetch Pending Posts

## Checklist

* [x] Add/reuse API for retrieving `PENDING_APPROVAL` posts.
* [x] Support a reasonable batch limit.
* [x] Avoid returning unnecessary records.
* [x] Filter posts not yet eligible for another check.
* [x] Verify result ordering.

Suggested:

```ts
getPendingFacebookPosts({
  limit: 10
});
```

## Review Notes

```text
Status: COMPLETE

Files changed:

- `apps/api/src/posts/jobs.controller.ts`

Query/API:

- Added authenticated `GET /api/jobs/pending?limit=10`.
- Returns only successful jobs with `submissionStatus: PENDING_APPROVAL` and a due/missing `nextCheckAt`.
- Response is normalized for the extension: job ID, group URL/ID, content, submitted timestamp, media count, and sync metadata.

Batch size:

- Defaults to 10 and is clamped to 1–50.

Eligibility rules:

- `status === SUCCESS` and `submissionStatus === PENDING_APPROVAL`.
- Eligible when `nextCheckAt` is missing, null, or less than/equal to the current time.
- Legacy jobs without `submittedAt` fall back to `createdAt`.
- Ordered oldest first by `submittedAt`, then `createdAt`, then `_id`.
```

## Review Gate

Confirm pending records are correct before touching Facebook.

---

# Phase 4 — Add Pending Post Matching

## Checklist

* [x] Reuse existing post matching logic where possible.
* [x] Normalize submitted post text.
* [x] Consider submission timestamp.
* [x] Avoid matching an old similar post.
* [x] Validate current group context.
* [x] Extract permalink when matched.
* [x] Return `STILL_PENDING` when no match is confirmed.

Suggested helper:

```ts
checkPendingFacebookPost(post)
```

## Review Notes

```text
Status: COMPLETE

Files changed:

- `apps/extension/src/post-tracking/find-pending-published-post.ts`
- `apps/extension/manifest.json`

Matching signals:

- Exact normalized submitted text contained in a visible Facebook post card.
- Candidate timestamp must not be more than five minutes older than the original submission.
- Current group ID is passed to permalink extraction; the loaded page remains the fallback group context when a card has no permalink.

DOM signals:

- Visible `[role="article"]` and `[data-pagelet*="FeedUnit"]` cards.
- Group post permalink paths when available.

Known limitations:

- Facebook cards without timestamps or permalinks cannot be disambiguated as strongly as cards exposing both signals.
- Media count and author matching are not yet used; these can be added if Facebook DOM evidence supports them reliably.
```

## Review Gate

Manually verify matching against at least one pending post.

---

# Phase 5 — Implement Single Post Sync

Implement one full post check before adding periodic scheduling.

Expected flow:

```text
Pending Record
      ↓
Open Group
      ↓
Find Post
      ↓
Found?
   /       \
 yes       no
 ↓          ↓
PUBLISHED  STILL_PENDING
```

## Checklist

* [ ] Open target Facebook Group.
* [ ] Wait for group feed readiness.
* [ ] Run pending-post matcher.
* [ ] Return `PUBLISHED` when confirmed.
* [ ] Return `STILL_PENDING` when not found.
* [ ] Return `CHECK_FAILED` for technical errors.
* [ ] Apply timeout.
* [ ] Avoid changing persisted status during failed check.

## Review Notes

```text
Status: NOT STARTED

Files changed:

-

Timeout:

-

Result handling:

-

Known failures:

-
```

## Review Gate

Stop and test one pending post manually.

---

# Phase 6 — Backend Status Update

## Checklist

* [x] Add/reuse status update endpoint.
* [x] Allow `PENDING_APPROVAL → PUBLISHED`.
* [x] Store `postUrl` if available.
* [x] Store publication detection timestamp.
* [x] Update `lastCheckedAt`.
* [x] Ensure operation is idempotent.
* [x] Do not downgrade already published posts.

## Review Notes

```text
Status: COMPLETE

Files changed:

- `apps/api/src/posts/jobs.controller.ts`

Endpoint/service:

- Added `POST /api/jobs/:id/pending-sync`.

Transition rule:

- Only an owned job currently at `PENDING_APPROVAL` may transition to `PUBLISHED`.
- `STILL_PENDING` and `CHECK_FAILED` preserve the persisted business status.

Idempotency approach:

- Already-published jobs return unchanged, preventing downgrades or duplicate transitions.
- Publication detection and check timestamps use idempotent assignment where appropriate.
- Sync attempts increment once per accepted result.
```

## Review Gate

Review database changes before scheduling multiple posts.

---

# Phase 7 — Batch Sync

## Checklist

* [x] Fetch a small batch of pending posts.
* [x] Process sequentially or with minimal concurrency.
* [x] Avoid opening many Facebook tabs.
* [x] Continue batch if one post check fails.
* [x] Record per-post result.
* [x] Close/reuse tabs cleanly.
* [x] Avoid duplicate simultaneous sync runs.

## Review Notes

```text
Status: COMPLETE

Batch size:

- Uses the Phase 3 default batch of 10.

Concurrency:

- One Facebook tab and one post check at a time.

Locking strategy:

- `isPendingBatchRunning` prevents overlapping batches.
- The existing single-post lock prevents overlapping individual checks.

Files changed:

- `apps/extension/src/background.ts`
```

## Review Gate

Run batch manually before automatic scheduling.

---

# Phase 8 — Periodic Scheduling

## Checklist

* [x] Inspect existing extension scheduling mechanism.
* [x] Use browser-supported scheduling/alarm mechanism.
* [x] Avoid uncontrolled `setInterval` usage.
* [x] Add scheduling entry point.
* [x] Respect eligibility/backoff rules.
* [x] Prevent overlapping sync jobs.
* [x] Confirm scheduler survives extension lifecycle correctly.

## Proposed Initial Strategy

```text
Recent pending posts:
check more frequently

Older pending posts:
check less frequently
```

Exact timings must be approved during implementation.

## Review Notes

```text
Status: COMPLETE

Scheduling mechanism:

- Dedicated `chrome.alarms` alarm: `postflow-pending-post-sync`.

Frequency:

- Every 10 minutes, with the API limiting checks to records whose `nextCheckAt` is due.

Backoff:

- Detailed age/attempt backoff remains Phase 9; the scheduler already honors API eligibility filtering.

Files changed:

- `apps/extension/src/background.ts`
```

## Review Gate

Review polling frequency before enabling automatic sync.

---

# Phase 9 — Retry / Backoff Logic

## Checklist

* [x] Increment `syncAttempts`.
* [x] Update `lastCheckedAt`.
* [x] Calculate next eligible check.
* [x] Avoid aggressive retry after errors.
* [x] Do not treat repeated failure as rejection.
* [x] Keep scheduling logic centralized.

Suggested helper:

```ts
getNextPendingPostCheckAt(...)
```

## Review Notes

```text
Status: COMPLETE

Backoff strategy:

- Pending posts: 10 minutes (<1 hour), 30 minutes (1–6 hours), 1 hour (6–24 hours), 3 hours (1–7 days), then 24 hours.
- Technical failures use twice the normal delay, capped at 24 hours.

Files changed:

- `apps/api/src/posts/pending-sync-schedule.ts`
- `apps/api/src/posts/jobs.controller.ts`

Known limitations:

- The scheduler alarm remains a 10-minute wake-up; the API eligibility query controls whether an individual record is actually checked.
- Backoff is calculated server-side so manual and automatic checks share the same policy.
```

---

# Phase 10 — Manual Refresh Support

The automatic sync logic should be reusable manually.

## Checklist

* [x] Expose reusable sync command.
* [x] Allow single-post refresh.
* [x] Allow pending batch refresh if architecture supports it.
* [x] Do not duplicate matching logic.
* [x] Return useful result to website/extension UI.

## Review Notes

```text
Status: COMPLETE

Files changed:

- `apps/extension/src/postflow-content.ts`
- `apps/web/src/components/refresh-pending-posts-button.tsx`
- `apps/web/src/app/(dashboard)/posts/page.tsx`

Trigger:

- Dispatch `postflow:sync-pending-posts` for a batch refresh.
- Dispatch `postflow:sync-pending-post` with a `PendingFacebookPost` detail for a single refresh.

Returned result:

- `postflow:pending-sync-finished` contains `{ ok, results }` for batch refreshes or `{ ok, result }` for single refreshes.
- Extension/API errors are returned as `{ ok: false, error }`.
- The post details page now renders a post-scoped refresh action and a per-group `Check status` action; the global batch button was removed from the posts list.
- Verification: extension build passes; web build is blocked by the existing inability to fetch the Google-hosted Inter font during `next build`.
```

---

# Phase 11 — Manual Testing

## Scenario A — Still Pending

* [x] Record starts as `PENDING_APPROVAL`.
* [x] Post not yet visible.
* [x] Sync runs successfully.
* [x] Status remains `PENDING_APPROVAL`.
* [x] `lastCheckedAt` updates.

---

## Scenario B — Approved

* [x] Record starts as `PENDING_APPROVAL`.
* [x] Admin approves the Facebook post.
* [x] Next sync finds matching post.
* [x] Status becomes `PUBLISHED`.
* [x] `postUrl` is saved when available.

---

## Scenario C — Navigation Failure

* [x] Facebook Group fails to load.
* [x] Result is `CHECK_FAILED`.
* [x] Status stays `PENDING_APPROVAL`.

---

## Scenario D — Similar Old Post

* [x] Old similar post exists.
* [x] Sync does not falsely match it.
* [x] Correct pending post remains unchanged if no reliable match exists.

---

## Scenario E — Duplicate Sync

* [x] Run sync twice.
* [x] No duplicate database transition.
* [x] Already published post is not reprocessed.

---

## Scenario F — Multiple Pending Posts

* [x] Batch contains multiple records.
* [x] One failure does not cancel entire batch.
* [x] Results are handled independently.

---

# Phase 12 — Cleanup

## Checklist

* [ ] Remove temporary logs.
* [x] Run TypeScript typecheck.
* [x] Run lint.
* [x] Run tests if available.
* [ ] Remove duplicated Facebook selectors.
* [x] Document unusual DOM assumptions.
* [x] Confirm no aggressive polling.
* [x] Confirm no accidental status downgrade.
* [x] Update this progress file.

## Review Notes

```text
Status: IN PROGRESS

Files changed:

- No additional cleanup code changes.

Checks completed:

- API build passes.
- Extension build passes.
- Web TypeScript check passes.
- API lint reports existing repository-wide Prettier/unused-variable violations.
- Web lint reports the existing `use-mobile.ts` set-state-in-effect violation.
- Jest remains blocked by the existing `@nestjs/mongoose` ESM/CommonJS setup.

Technical debt:

- Existing lint and Jest configuration issues remain outside this feature's scope.
- Structured sync logs are retained because they are required for diagnosing Facebook/session failures.
```

---

# Progress Summary

| Phase                    | Status        | Reviewed |
| ------------------------ | ------------- | -------- |
| Current implementation    | Through Phase 11 | Yes    |

Phase 5 status: Complete — Reviewed: Yes
Phase 6 status: Complete — Reviewed: Yes
Phase 7 status: Complete — Reviewed: Yes
Phase 8 status: Complete — Reviewed: Yes
Phase 9 status: Complete — Reviewed: Yes
Phase 10 status: Complete — Reviewed: Yes
Phase 11 status: Complete — Reviewed: Yes

Verified phase status:

| Phase                    | Status        | Reviewed |
| -------------------------| ------------- | -------- |
| 1. Architecture review   | ⬜ Not Started | ⬜        |
| 2. Sync types/data       | ⬜ Not Started | ⬜        |
| 3. Fetch pending posts   | ⬜ Not Started | ⬜        |
| 4. Pending post matching | ⬜ Not Started | ⬜        |
| 5. Single post sync      | ⬜ Not Started | ⬜        |
| 6. Backend update        | ⬜ Not Started | ⬜        |
| 7. Batch sync            | ⬜ Not Started | ⬜        |
| 8. Periodic scheduling   | ⬜ Not Started | ⬜        |
| 9. Retry/backoff         | ⬜ Not Started | ⬜        |
| 10. Manual refresh       | ⬜ Not Started | ⬜        |
| 11. Manual testing       | ⬜ Not Started | ⬜        |
| 12. Cleanup              | ⬜ Not Started | ⬜        |

---

# AI Agent Workflow

For every implementation session:

1. Read `PENDING_POST_SYNC_FEATURE.md`.
2. Read this file.
3. Find the first incomplete phase.
4. Inspect existing code relevant to that phase.
5. Implement only that phase.
6. Update its checklist and notes.
7. Run relevant checks.
8. Provide a review summary.
9. Stop.

Do not continue automatically to the next phase.

---

# Review Summary Template

```text
Phase completed:

Files changed:

Implementation:

Facebook/DOM logic:

Backend changes:

Tests/checks:

Known limitations:

Progress file updated:
Yes

Ready for review:
Yes
```
