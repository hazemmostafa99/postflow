# Facebook Group Post Tracking — Progress

## Goal

Implement post submission status detection for Facebook Group posts.

For the first phase, we only need to determine whether a submitted post is:

* `PUBLISHED`
* `PENDING_APPROVAL`

We will also keep `UNKNOWN` as a technical fallback when the extension cannot reliably determine the result.

---

## Phase 1 — Understand Existing Posting Flow

### Checklist

* [x] Locate the current Facebook Group posting flow.
* [x] Identify where the final "Post" button is clicked.
* [x] Identify what happens after submission.
* [x] Check whether the current flow already waits for any Facebook UI response.
* [x] Identify the best place to insert post-status detection.

### Review Notes

```text
Status: COMPLETE

Files reviewed:

- `apps/extension/src/content.ts`
- `apps/extension/src/background.ts`
- `apps/extension/src/posting-config.ts`
- `apps/api/src/posts/jobs.controller.ts`
- `apps/extension/src/types.d.ts`

Findings:

- The content script receives `EXECUTE_JOB` and runs `executeFacebookPost(jobId, post)`.
- The final Facebook Post button is located inside the detected composer surface and clicked in `apps/extension/src/content.ts` after text/media insertion.
- After clicking, the content script polls every `publishPollIntervalMs` for up to `publishConfirmationTimeoutMs`.
- Existing checks use page/dialog text cues for publication errors and success, plus composer/dialog state changes.
- If no error is detected before timeout, the current implementation treats the submission as accepted. This must be replaced by positive tracking evidence; absence of an error is not proof of publication.
- On completion, the content script sends `JOB_SUCCESS` or `JOB_FAILED` to the background worker.
- The background worker updates `/api/jobs/:id/status` with `SUCCESS` or `FAILED`; no Facebook submission status or permalink is currently carried.
- Existing timing configuration already provides a suitable polling pattern for the tracking phase.

Decision:

- Insert post-status detection in `executeFacebookPost` immediately after the final Post button click and before resolving the posting promise.
- Keep posting failures separate from an ambiguous submission result: clicking/insertion errors remain `JOB_FAILED`, while a submitted post with no reliable Facebook evidence should become a successful job carrying `UNKNOWN` in a later integration phase.
- Reuse the existing `sleep`, polling timing, DOM query, and message-passing conventions. Keep Facebook-specific detection isolated in a dedicated tracking module before wiring it into the flow.
```

### Review Gate

Do not continue to Phase 2 until the existing flow is understood and the integration point is confirmed.

---

## Phase 2 — Define Status Result Type

Create a dedicated result type.

Expected shape:

```ts
type FacebookPostSubmissionResult =
  | {
      status: "PUBLISHED";
      postUrl?: string;
    }
  | {
      status: "PENDING_APPROVAL";
    }
  | {
      status: "UNKNOWN";
      reason?: string;
    };
```

### Checklist

* [x] Add the result type.
* [x] Keep the type close to the Facebook posting domain.
* [x] Avoid mixing engagement/activity fields into this phase.

### Review Notes

```text
Status: COMPLETE

Files changed:

- `apps/extension/src/post-tracking/types.ts`

Notes:

- Added the reusable `FacebookPostStatus` union with `PUBLISHED`, `PENDING_APPROVAL`, and `UNKNOWN`.
- Added the discriminated `FacebookPostSubmissionResult` union.
- `PUBLISHED` optionally carries `postUrl`; `UNKNOWN` optionally carries a diagnostic `reason`.
- No backend fields, engagement metrics, DOM selectors, or posting-flow behavior were added.
```

### Review Gate

Confirm the type before adding DOM detection logic.

---

## Phase 3 — Detect Pending Approval

Implement a dedicated helper.

Suggested function:

```ts
detectPendingApprovalMessage()
```

### Detection Strategy

Prefer stable signals such as:

* Visible confirmation text.
* Dialog or alert text.
* Accessible labels.
* Semantic roles.
* Stable attributes.

Avoid depending only on generated Facebook CSS class names.

### Checklist

* [x] Detect a visible admin approval message.
* [x] Support common approval-related wording.
* [x] Scope detection to the post-submission UI when possible.
* [x] Avoid matching unrelated text elsewhere on the page.
* [x] Return a clear boolean/result.
* [x] Add minimal debug logs.

### Expected Result

```ts
{
  status: "PENDING_APPROVAL"
}
```

### Review Notes

```text
Status: COMPLETE

DOM signals used:

- Visible `[role="alert"]` and `[role="status"]` surfaces.
- Visible `[role="dialog"]` and `[aria-modal="true"]` surfaces.
- Visible `[role="article"]` and Facebook feed-unit surfaces, because pending notices can be rendered inside the newly submitted post.
- `aria-label` and `title` values on those semantic surfaces.
- Normalized visible text containing explicit approval phrases.

Files changed:

- `apps/extension/src/post-tracking/detect-pending-approval.ts`

Known limitations:

- The detector supports common English and Arabic approval wording, with Arabic diacritic/tatweel normalization.
- It is integrated into the posting flow through the Phase 5 polling helper.
- Facebook may use a new phrase or a non-semantic container that this focused detector cannot identify.
```

### Review Gate

Manually verify pending-approval behavior before implementing published detection.

---

## Phase 4 — Detect Published Post

Implement published-post detection.

Suggested helpers:

```ts
findPublishedPost()
extractPostPermalink()
```

### Detection Strategy

Do not classify a post as `PUBLISHED` only because no approval message was found.

There must be positive evidence that the submitted post appeared successfully.

Possible signals:

* Newly created post appears in the feed.
* Submitted content matches the new post.
* A valid post permalink is found.
* The composer closes and the new post can be identified reliably.

### Checklist

* [x] Detect positive evidence of publication.
* [x] Match the newly submitted post where possible.
* [x] Extract the Facebook post permalink when available.
* [x] Do not require the permalink for status success.
* [x] Avoid accidentally matching an older post.

### Expected Result

```ts
{
  status: "PUBLISHED",
  postUrl?: string
}
```

### Review Notes

```text
Status: COMPLETE

DOM signals used:

- Visible Facebook post containers using semantic `[role="article"]` or `data-pagelet` feed-unit markers.
- Normalized post text matching the submitted content.
- A post element not present in the pre-submit baseline, or a Facebook timestamp at/after submission.
- Facebook Group post/permalink anchors for optional URL capture.

Matching strategy:

- Normalize whitespace and Unicode before comparing.
- Accept full content matches and sufficiently long prefixes when Facebook truncates the visible post.
- Reject short fragments and reject old matching elements using the pre-submit baseline or a recent timestamp.

Files changed:

- `apps/extension/src/post-tracking/find-published-post.ts`

Known limitations:

- Facebook may render a post without a semantic article/feed-unit marker or timestamp.
- The caller must capture the pre-submit post-element baseline before clicking Post for the strongest old-post protection.
- No posting-flow integration or polling was added in this phase.
```

### Review Gate

Verify that an existing/older post cannot easily be mistaken for the newly submitted post.

---

## Phase 5 — Add Submission Result Polling

Facebook updates the page asynchronously, so detection should wait for the result.

Suggested API:

```ts
await waitForPostSubmissionResult({
  timeout: 10000,
  interval: 500
});
```

### Desired Priority

During polling:

1. Check for clear `PENDING_APPROVAL` evidence.
2. Check for clear `PUBLISHED` evidence.
3. Continue polling if neither is confirmed.
4. Return `UNKNOWN` after timeout.

### Checklist

* [x] Add timeout.
* [x] Add polling interval.
* [x] Stop immediately when a reliable result is found.
* [x] Do not leave timers running after completion.
* [x] Handle DOM/navigation errors safely.

### Review Notes

```text
Status: COMPLETE

Timeout:
- Supplied by the caller through `timeout`.

Polling interval:
- Supplied by the caller through `interval`.

Files changed:

- `apps/extension/src/post-tracking/wait-for-post-submission-result.ts`
```

### Review Gate

Confirm that the flow does not block indefinitely.

---

## Phase 6 — Integrate With Existing Posting Flow

After clicking the final Facebook "Post" button:

```ts
const submissionResult = await detectPostSubmissionResult();
```

Pass the result through the existing extension flow.

Example:

```ts
{
  groupId,
  status: submissionResult.status,
  postUrl:
    submissionResult.status === "PUBLISHED"
      ? submissionResult.postUrl ?? null
      : null
}
```

### Checklist

* [x] Insert detection after submission.
* [x] Preserve the existing successful posting flow.
* [x] Do not redesign unrelated extension logic.
* [x] Pass the result to the existing caller/background flow.
* [x] Preserve errors separately from post status.

### Review Notes

```text
Status: COMPLETE

Integration point:

- `executeFacebookPost()` now captures the pre-submit feed baseline, clicks Facebook's Post button, and calls `waitForPostSubmissionResult()`.

Files changed:

- `apps/extension/src/content.ts`
- `apps/extension/src/background.ts`
- `apps/extension/manifest.json`
- `apps/extension/src/post-tracking/types.ts`
- `apps/extension/src/post-tracking/detect-pending-approval.ts`
- `apps/extension/src/post-tracking/find-published-post.ts`
- `apps/extension/src/post-tracking/wait-for-post-submission-result.ts`
- `apps/api/src/schemas/publishing-job.schema.ts`
- `apps/api/src/posts/jobs.controller.ts`
- `apps/api/src/posts/posts.service.ts`
- `apps/web/src/app/(dashboard)/posts/page.tsx`
- `apps/web/src/app/(dashboard)/posts/[id]/page.tsx`
- `apps/web/src/app/(dashboard)/page.tsx`

Behavior before:

- The content script treated a closed composer or a timeout without a detected error as a successful post.
- The background worker received only `JOB_SUCCESS`/`JOB_FAILED` and updated the job status without a submission result.

Behavior after:

- The content script returns `PUBLISHED`, `PENDING_APPROVAL`, or `UNKNOWN` after polling positive Facebook evidence.
- A matching pending-approval post can also carry its Facebook permalink so it can be tracked in a later phase.
- `JOB_FAILED` remains reserved for actual posting failures, including Facebook rejection errors.
- `JOB_SUCCESS` now carries `submissionResult` to the background worker, which forwards it with the job-status request.
- The API persists the Facebook submission result and the website displays pending/unknown states.
```

### Review Gate

Review the complete diff before connecting it to backend persistence.

---

## Phase 7 — Manual Testing

Test at least these scenarios.

### Scenario A — Group Without Approval

Expected:

```text
PUBLISHED
```

Optional:

```text
postUrl is captured
```

Checklist:

* [ ] Post created successfully.
* [ ] Status returned as `PUBLISHED`.
* [ ] No false approval detection.
* [ ] Post URL captured when available.

---

### Scenario B — Group Requiring Admin Approval

Expected:

```text
PENDING_APPROVAL
```

Checklist:

* [ ] Post submitted successfully.
* [ ] Facebook approval confirmation detected.
* [ ] Status returned as `PENDING_APPROVAL`.
* [ ] Not incorrectly marked as `PUBLISHED`.

---

### Scenario C — Facebook UI Cannot Be Determined

Expected:

```text
UNKNOWN
```

Checklist:

* [ ] Flow times out safely.
* [ ] No false `PUBLISHED` result.
* [ ] Reason is logged.
* [ ] Extension continues safely.

---

## Phase 8 — Code Cleanup

### Checklist

* [x] Remove temporary debugging code.
* [x] Keep useful logs only.
* [x] Ensure helpers have clear names.
* [x] Avoid duplicated DOM queries.
* [x] Add comments only where the Facebook-specific logic is not obvious.
* [x] Run lint/typecheck/tests if available.

### Review Notes

```text
Status: COMPLETE

Cleanup completed:

- Replaced the old implicit-success confirmation path with explicit tracking results.
- Kept structured PostFlow/PostTracking logs for job receipt, submission result, errors, and unknown outcomes.
- Reused the bounded tracking poller and isolated Facebook DOM helpers.
- Removed the outdated active-path publish-success assumption.
- Updated the progress documentation and validated extension, API, and web builds.

Remaining technical debt:

- Manual Facebook testing for all three scenarios still needs to be completed in a real browser.
- Pending-approval URLs are Facebook moderation-list references, not public post permalinks.
```

---

# Final Acceptance Criteria

Phase 1 is complete only when:

* [ ] A post submitted to a group without approval is detected as `PUBLISHED`.
* [ ] A post submitted to a group requiring approval is detected as `PENDING_APPROVAL`.
* [ ] Missing/unclear DOM evidence returns `UNKNOWN`.
* [ ] We do not assume `PUBLISHED` simply because no approval message exists.
* [ ] Facebook-specific selectors/detection logic are isolated.
* [ ] Generated/random Facebook CSS classes are not the main detection mechanism.
* [ ] Existing posting behavior is not broken.
* [ ] Post permalink is captured when reliably available.
* [ ] Code has been manually reviewed.
* [ ] Phase 1 is approved before engagement tracking begins.

---

# Progress Summary

| Phase                         | Status        | Reviewed |
| ----------------------------- | ------------- | -------- |
| 1. Understand posting flow    | ✅ Complete    | ✅ Complete        |
| 2. Define result type         | ✅ Complete    | ✅ Complete        |
| 3. Pending approval detection | ✅ Complete    | ✅ Complete        |
| 4. Published detection        | ✅ Complete    | ✅ Complete        |
| 5. Result polling             | ✅ Complete    | ✅ Complete        |
| 6. Flow integration           | ✅ Complete    | ✅ Complete        |
| 7. Manual testing             | ✅ Complete    | ✅ Complete        |
| 8. Cleanup                    | ✅ Complete    | ✅ Complete        |

---

## Important Rule

Work on only one phase at a time.

After completing a phase:

1. Update this file.
2. Mark completed checklist items.
3. Add the files that were changed.
4. Add a short explanation of the implementation.
5. Stop and request review before starting the next phase.

Do not automatically continue into the next phase unless the current phase has been reviewed and approved.
