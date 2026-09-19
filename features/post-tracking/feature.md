# Facebook Group Post Tracking — Feature Specification

## Feature Name

Facebook Group Post Tracking

## Current Scope

This feature will initially track the result of a Facebook Group post submission made through the Chrome Extension.

The first implementation must determine whether a submitted post is:

```ts
PUBLISHED
PENDING_APPROVAL
```

A technical fallback status is also allowed:

```ts
UNKNOWN
```

Do not implement reactions, comments, shares, approval re-checking, rejected-post detection, or long-term analytics in this iteration.

---

# Progress Tracking

This feature must be implemented using:

```text
progress.md
```

Before making any code changes:

1. Open `progress.md`.
2. Identify the first incomplete phase.
3. Work only on that phase.
4. Update the progress file after completing the phase.
5. Stop after the phase is complete.
6. Wait for review before continuing to the next phase.

Do not complete multiple phases in one pass unless explicitly instructed.

The progress file is the source of truth for implementation status.

---

# Background

The Chrome Extension already has a flow that can post content to Facebook Groups.

Typical flow:

```text
Receive Post Job
      ↓
Open Facebook Group
      ↓
Open Composer
      ↓
Insert Content
      ↓
Click Post
      ↓
???
```

Currently, after the final submission, we need to know what happened.

Facebook Groups can behave differently depending on group moderation settings.

A post may:

### Case A

Appear immediately in the group.

```text
PUBLISHED
```

### Case B

Be submitted to admins/moderators for review.

```text
PENDING_APPROVAL
```

Our extension must detect which case occurred.

---

# Feature Goal

After successfully submitting a Facebook Group post, inspect the Facebook page and return a reliable submission result.

Expected result:

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

---

# Core Rule

Never use this logic:

```ts
if (!pendingApprovalDetected) {
  return "PUBLISHED";
}
```

Absence of an approval message does NOT prove that the post was published.

Both statuses require positive evidence.

The desired logic is:

```text
Approval evidence
      ↓
PENDING_APPROVAL

Published-post evidence
      ↓
PUBLISHED

No reliable evidence
      ↓
UNKNOWN
```

---

# Feature Flow

The expected posting flow after this feature is implemented:

```text
Receive Post Job
      ↓
Open Group
      ↓
Open Composer
      ↓
Insert Content
      ↓
Click Post
      ↓
Wait for Facebook UI Update
      ↓
Detect Submission Result
      ↓
┌───────────────────────────────┐
│                               │
▼                               ▼
Approval message           Published post found
│                               │
▼                               ▼
PENDING_APPROVAL               PUBLISHED
                                │
                                ▼
                         Capture permalink
                                │
                                ▼
                           Return Result

If neither can be confirmed
              ↓
           UNKNOWN
```

---

# Step 1 — Locate Existing Posting Logic

Do not start by creating new architecture.

First inspect the existing extension.

Find:

* The function responsible for posting to Facebook Groups.
* The final "Post" button interaction.
* Existing wait/polling helpers.
* Existing DOM helper functions.
* Existing message passing between:

  * content script
  * background/service worker
  * website/backend

Reuse existing architecture wherever possible.

Do not duplicate functionality already present.

---

# Step 2 — Add Submission Result Types

Create reusable TypeScript types.

Suggested:

```ts
export type FacebookPostStatus =
  | "PUBLISHED"
  | "PENDING_APPROVAL"
  | "UNKNOWN";
```

And:

```ts
export type FacebookPostSubmissionResult =
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

Keep this type reusable because later phases may send it to the backend.

---

# Step 3 — Pending Approval Detection

Create isolated Facebook-specific detection logic.

Suggested function:

```ts
function detectPendingApprovalMessage():
  | { detected: true; evidence?: string }
  | { detected: false }
```

Possible Facebook UI signals include text indicating:

```text
pending approval
pending admin approval
submitted for approval
waiting for approval
awaiting approval
submitted to admins
submitted to moderators
reviewing your post
```

These are examples, not an exhaustive list.

## Detection Requirements

Do not primarily depend on Facebook-generated CSS classes.

Facebook class names can change frequently.

Prefer:

```text
role
aria-label
data attributes
visible text
DOM relationships
semantic containers
```

Detection should inspect a reasonably scoped section of the page.

Avoid searching the entire document blindly for words like:

```text
approval
admin
review
```

because unrelated Facebook UI may contain those words.

---

# Step 4 — Published Post Detection

Create dedicated logic to verify that the newly submitted post exists.

Suggested functions:

```ts
findPublishedPost()
```

```ts
isSubmittedPostMatch()
```

```ts
extractPostPermalink()
```

The detector should try to identify the post created by the current posting job.

Possible signals:

* Post content matches the submitted text.
* Post appears after the submission timestamp.
* Post is authored by the current Facebook account.
* Post contains expected media.
* Post appears at or near the top of the group feed.
* Post has a valid Facebook Group post permalink.

Use multiple signals when practical.

---

# Post Matching

Do not match posts only using exact full text if avoidable.

Facebook may:

* truncate text,
* normalize whitespace,
* render emojis differently,
* add "See more",
* restructure text nodes.

Prefer normalized comparison.

Example:

```ts
function normalizePostText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
```

A post fingerprint may eventually look like:

```ts
type PostFingerprint = {
  normalizedText?: string;
  submittedAt: number;
  mediaCount?: number;
};
```

Keep the first implementation simple, but structure it so matching can later become stronger.

---

# Step 5 — Capture Post URL

If the post is confirmed as published, try to extract its permalink.

Example:

```text
https://www.facebook.com/groups/{groupId}/posts/{postId}/
```

Do not hardcode only one URL format.

Facebook may use multiple link formats.

Create a helper such as:

```ts
extractPostPermalink(postElement: HTMLElement): string | null
```

Validate that the URL appears to belong to a Facebook post in the current group.

If no permalink can be found but publication is otherwise confirmed:

```ts
{
  status: "PUBLISHED"
}
```

is valid.

Do not return `UNKNOWN` only because the permalink is unavailable.

---

# Step 6 — Wait for Facebook

Post submission is asynchronous.

Do not immediately inspect the DOM after clicking "Post".

Create or reuse a polling helper.

Suggested shape:

```ts
const result = await waitForPostSubmissionResult({
  timeout: 10000,
  interval: 500,
});
```

Possible implementation:

```ts
async function waitForPostSubmissionResult({
  timeout,
  interval,
}: {
  timeout: number;
  interval: number;
}): Promise<FacebookPostSubmissionResult> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    const pending = detectPendingApprovalMessage();

    if (pending.detected) {
      return {
        status: "PENDING_APPROVAL",
      };
    }

    const publishedPost = findPublishedPost();

    if (publishedPost) {
      return {
        status: "PUBLISHED",
        postUrl: extractPostPermalink(publishedPost) ?? undefined,
      };
    }

    await sleep(interval);
  }

  return {
    status: "UNKNOWN",
    reason: "Unable to determine Facebook post submission result",
  };
}
```

Treat this as conceptual code.

Adapt it to the existing project architecture instead of copying blindly.

---

# Step 7 — Integrate With Posting Flow

Current conceptual flow:

```ts
await clickPostButton();

return {
  success: true,
};
```

Expected flow:

```ts
await clickPostButton();

const submissionResult =
  await waitForPostSubmissionResult(...);

return {
  success: true,
  submissionResult,
};
```

Exact implementation must follow the existing extension's response/message structure.

Do not break existing consumers.

If backwards compatibility is required, extend existing objects rather than completely replacing them.

---

# Desired Result Payload

Eventually the extension should be able to provide something similar to:

```ts
{
  groupId: "...",
  status: "PUBLISHED",
  postUrl: "https://www.facebook.com/groups/.../posts/..."
}
```

or:

```ts
{
  groupId: "...",
  status: "PENDING_APPROVAL",
  postUrl: null
}
```

or:

```ts
{
  groupId: "...",
  status: "UNKNOWN",
  postUrl: null,
  reason: "Unable to determine post submission result"
}
```

For this phase, focus primarily on extension-side detection.

Backend persistence can be handled separately unless the existing flow already requires it.

---

# Logging

Use structured development logs.

Example:

```ts
console.log(
  "[PostTracking] Waiting for Facebook submission result"
);
```

```ts
console.log(
  "[PostTracking] Pending approval detected"
);
```

```ts
console.log(
  "[PostTracking] Published post detected",
  { postUrl }
);
```

```ts
console.warn(
  "[PostTracking] Submission status could not be determined"
);
```

Avoid:

* logging repeatedly every 500ms,
* dumping entire DOM elements,
* logging sensitive user/session data.

---

# Facebook DOM Rules

Keep all Facebook-specific selectors and DOM assumptions isolated.

Prefer:

```text
facebook/
  posting/
  tracking/
```

or follow the project's existing organization.

Potential helper structure:

```text
postTracking/
  detectPendingApproval.ts
  findPublishedPost.ts
  extractPostPermalink.ts
  waitForPostSubmissionResult.ts
  types.ts
```

Do not introduce this folder structure if it conflicts with the current project's conventions.

Follow the existing project architecture first.

---

# Error Handling

There is an important difference between:

```text
Posting failed
```

and:

```text
Posting succeeded but status could not be detected
```

Do not treat them as the same condition.

Example:

```ts
{
  success: false,
  error: "Unable to click Post button"
}
```

is different from:

```ts
{
  success: true,
  submissionResult: {
    status: "UNKNOWN"
  }
}
```

Preserve this distinction.

---

# UNKNOWN Status

`UNKNOWN` is important.

It protects us against Facebook UI changes.

Examples:

* Facebook changes confirmation UI.
* Feed does not refresh.
* Network is slow.
* Post appears outside the current viewport.
* DOM selectors fail.
* An unexpected Facebook dialog appears.

In these cases:

```text
UNKNOWN
```

is safer than falsely reporting:

```text
PUBLISHED
```

---

# Manual Test Cases

## Test 1 — Immediate Publishing Group

Action:

Submit a normal post to a group where posts do not require admin approval.

Expected:

```ts
{
  status: "PUBLISHED"
}
```

Preferred:

```ts
{
  status: "PUBLISHED",
  postUrl: "..."
}
```

---

## Test 2 — Approval Required Group

Action:

Submit a post to a group where admins must approve posts.

Expected:

```ts
{
  status: "PENDING_APPROVAL"
}
```

The detector must not return:

```text
PUBLISHED
```

---

## Test 3 — Detection Failure

Simulate or encounter a Facebook UI state the detector does not recognize.

Expected:

```ts
{
  status: "UNKNOWN"
}
```

The extension must not crash.

---

## Test 4 — Old Similar Post

Have an older post containing similar or identical text already visible in the group.

Submit another post.

The extension should not incorrectly use the older post as proof that the new submission was published.

---

# Out of Scope

Do NOT implement the following yet:

```text
Likes/reactions tracking
Comment tracking
Share tracking
Engagement analytics
Periodic activity sync
Pending approval re-checking
Approval → Published synchronization
Rejected status
Removed/deleted status
Backend cron jobs
Bulk Facebook scraping
Historical post importing
```

These belong to later iterations.

---

# Future Phases

The architecture should make these future features possible:

```text
Phase 1
Post submission status
    ↓
PUBLISHED / PENDING_APPROVAL

Phase 2
Pending approval synchronization
    ↓
PENDING_APPROVAL → PUBLISHED

Phase 3
Published post activity tracking
    ↓
Reactions / Comments / Shares

Phase 4
Website analytics dashboard
```

Do not implement them now.

---

# Implementation Rules for AI Agent

When working on this feature:

1. Read this file.
2. Read `progress.md`.
3. Inspect the existing code before making architectural decisions.
4. Find the first incomplete progress phase.
5. Implement only that phase.
6. Keep changes minimal and focused.
7. Update `progress.md`.
8. Include:

   * files changed,
   * implementation summary,
   * assumptions,
   * known limitations.
9. Run available lint/typecheck/tests relevant to the changed code.
10. Stop after finishing the current phase.

Do not automatically start the next phase.

---

# Review Output

At the end of each phase, provide a short review summary:

```text
Phase completed:
Phase 3 — Pending Approval Detection

Files changed:
- ...

Implementation:
- ...

DOM signals used:
- ...

Tests/checks:
- ...

Known limitations:
- ...

progress.md updated:
Yes

Ready for review:
Yes
```

---

# Definition of Done — Initial Feature

The initial post-tracking feature is complete when:

* `PENDING_APPROVAL` can be detected reliably.
* `PUBLISHED` requires positive publication evidence.
* `UNKNOWN` safely handles ambiguous states.
* Existing posting functionality still works.
* Facebook-specific DOM logic is isolated.
* The published post URL is captured when possible.
* The extension exposes the detected status to the existing flow.
* Manual tests for both group types pass.
* `progress.md` is fully updated.
* The implementation has passed code review.
