# Pending Facebook Post Sync — Feature Specification

## Feature Name

Pending Facebook Post Synchronization

## Goal

Periodically re-check Facebook Group posts that were previously detected as:

```ts
PENDING_APPROVAL
```

If a pending post is later found published in the Facebook Group, update its status to:

```ts
PUBLISHED
```

and capture the Facebook post permalink when possible.

---

# Background

The current posting flow can already detect whether a newly submitted Facebook Group post is:

```ts
PUBLISHED
```

or:

```ts
PENDING_APPROVAL
```

Example stored record:

```ts
{
  id: "post_123",
  groupId: "group_456",
  groupUrl: "...",
  status: "PENDING_APPROVAL",
  submittedAt: "...",
  content: "...",
  postUrl: null
}
```

The problem is that a pending post may be approved later by a Facebook Group admin.

We need a synchronization mechanism that checks pending posts again and updates them once they become published.

---

# Scope

This feature should support this transition:

```text
PENDING_APPROVAL
        ↓
periodic re-check
        ↓
published post found
        ↓
PUBLISHED
```

The feature must NOT yet implement:

```text
REJECTED
REMOVED
DELETED
REACTIONS
COMMENTS
SHARES
ENGAGEMENT ANALYTICS
```

If a pending post cannot be found, it should remain:

```text
PENDING_APPROVAL
```

unless there is explicit evidence for another state.

---

# Core Rule

Not finding the post does NOT mean it was rejected.

This is invalid:

```ts
if (!postFound) {
  status = "REJECTED";
}
```

The correct behavior is:

```text
Post found
   ↓
PUBLISHED

Post not found
   ↓
keep PENDING_APPROVAL

Detection failed
   ↓
keep PENDING_APPROVAL
and record sync failure/debug information
```

---

# High-Level Architecture

The backend/database remains the source of truth for post records.

The Chrome Extension performs Facebook-specific checks.

Conceptual flow:

```text
Backend / Website
      ↓
get pending posts
      ↓
Chrome Extension
      ↓
open/check Facebook Group
      ↓
try to find matching post
      ↓
┌────────────────────────┐
│                        │
FOUND                  NOT FOUND
│                        │
↓                        ↓
PUBLISHED          PENDING_APPROVAL
│
↓
extract permalink
│
↓
update backend
```

---

# Important Constraint

Facebook checking should happen through the Chrome Extension using the user's active Facebook session.

Do not design this feature assuming the backend can directly query Facebook Groups.

The sync mechanism should integrate with the existing extension/background architecture.

---

# Pending Post Data Requirements

To reliably find a previously submitted post, each pending post should have enough metadata.

Suggested structure:

```ts
type PendingFacebookPost = {
  id: string;

  groupId: string;
  groupUrl: string;

  status: "PENDING_APPROVAL";

  content?: string;

  submittedAt: string;

  mediaCount?: number;

  textFingerprint?: string;

  lastCheckedAt?: string;

  syncAttempts?: number;
};
```

Use the existing project model where possible.

Do not create duplicate models unnecessarily.

---

# Post Fingerprint

The sync should not rely only on one signal.

Use a fingerprint derived from available information.

Possible fingerprint:

```ts
type FacebookPostFingerprint = {
  normalizedText?: string;
  submittedAt: number;
  mediaCount?: number;
};
```

Example normalization:

```ts
function normalizePostText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
```

---

# Matching Strategy

When checking a pending post, try to identify the published post using multiple signals.

Possible signals:

```text
same group
similar normalized text
expected author
matching media count
submission timestamp proximity
valid group post permalink
```

No single signal should be treated as perfect unless it is highly reliable.

---

# Step 1 — Fetch Pending Posts

The extension or website should request posts with:

```ts
status === "PENDING_APPROVAL"
```

Example:

```ts
const pendingPosts =
  await getPendingFacebookPosts();
```

Avoid loading unnecessary historical records.

Consider limiting the number of posts per sync batch.

Example:

```ts
{
  limit: 10
}
```

---

# Step 2 — Decide Which Posts Need Checking

Do not repeatedly check the same post too frequently.

Each record should support:

```ts
lastCheckedAt
```

and optionally:

```ts
nextCheckAt
```

Example eligibility:

```ts
function shouldCheckPost(post) {
  return !post.lastCheckedAt || Date.now() >= post.nextCheckAt;
}
```

---

# Step 3 — Open the Correct Facebook Group

For each eligible post:

```text
groupUrl
   ↓
open/navigate to group
   ↓
wait for page ready
```

Reuse existing group navigation logic from the posting feature when possible.

Do not duplicate Facebook navigation helpers.

---

# Step 4 — Find the Published Post

Create a reusable helper such as:

```ts
findPublishedPendingPost({
  post,
  groupElement,
})
```

Expected return:

```ts
{
  found: true,
  postElement: HTMLElement,
  postUrl?: string
}
```

or:

```ts
{
  found: false
}
```

---

# Step 5 — Extract Post Permalink

If the matching post is found:

```ts
const postUrl =
  extractPostPermalink(postElement);
```

Return:

```ts
{
  status: "PUBLISHED",
  postUrl
}
```

The permalink is preferred but should not block status update if publication evidence is strong.

---

# Step 6 — Update Backend

When the extension confirms publication, update the backend record.

Example request:

```ts
{
  postId: "post_123",
  status: "PUBLISHED",
  postUrl: "...",
  publishedDetectedAt: "..."
}
```

Backend result:

```ts
{
  success: true
}
```

The backend should ensure the transition is valid:

```text
PENDING_APPROVAL
        ↓
PUBLISHED
```

---

# Idempotency

The sync must be safe to run multiple times.

Example:

```text
first check:
PENDING_APPROVAL → PUBLISHED

second check:
already PUBLISHED
→ do nothing
```

Do not duplicate records or create repeated state transitions.

---

# Sync Scheduling

The feature should support periodic re-checking.

Use the existing extension scheduling/background mechanism if one exists.

If not, use the browser extension's supported scheduling mechanism rather than uncontrolled:

```ts
setInterval(...)
```

inside short-lived extension contexts.

Suggested conceptual schedule:

```text
recent pending posts
→ check more frequently

older pending posts
→ check less frequently
```

---

# Suggested Backoff Strategy

Example:

```text
0–1 hour old
check every 10–15 minutes

1–6 hours old
check every 30 minutes

6–24 hours old
check every 1–2 hours

1–7 days old
check a few times per day

older than 7 days
manual or very low frequency
```

Exact timings should follow product requirements and extension limitations.

Do not hardcode aggressive polling without review.

---

# Suggested Helper

```ts
function getNextPendingPostCheckAt(
  submittedAt: Date,
  lastCheckedAt?: Date
): Date
```

This keeps scheduling logic centralized.

---

# Sync Lock

Prevent two synchronization processes from checking the same record simultaneously.

Possible mechanisms:

```text
in-memory lock
extension storage lock
backend sync lock
```

Use the mechanism that fits the existing architecture.

---

# Batch Processing

Do not open dozens of Facebook Groups simultaneously.

Process pending posts sequentially or with very low concurrency.

Example:

```text
fetch 10 pending posts
      ↓
check post 1
      ↓
check post 2
      ↓
check post 3
```

This is preferred over opening many tabs at once.

---

# Result Type

Create a clear result type:

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

Important:

```text
STILL_PENDING
```

is an internal sync result.

The persisted business status remains:

```text
PENDING_APPROVAL
```

---

# Example Flow

```ts
const result =
  await checkPendingFacebookPost(post);

switch (result.status) {
  case "PUBLISHED":
    await updatePost({
      id: post.id,
      status: "PUBLISHED",
      postUrl: result.postUrl,
    });
    break;

  case "STILL_PENDING":
    await updatePostCheckMetadata({
      id: post.id,
      lastCheckedAt: new Date(),
    });
    break;

  case "CHECK_FAILED":
    await recordSyncFailure(...);
    break;
}
```

---

# Failure Handling

A sync failure must not change the business status.

For example:

```ts
{
  status: "CHECK_FAILED",
  reason: "Facebook group page did not load"
}
```

should leave the post as:

```text
PENDING_APPROVAL
```

Possible failures:

```text
Facebook not authenticated
group unavailable
network error
DOM changed
post feed did not load
extension tab closed
timeout
```

---

# Logging

Use structured logs:

```ts
console.log(
  "[PendingPostSync] Starting pending post check",
  { postId }
);
```

```ts
console.log(
  "[PendingPostSync] Published post detected",
  { postId, postUrl }
);
```

```ts
console.log(
  "[PendingPostSync] Post still pending",
  { postId }
);
```

```ts
console.warn(
  "[PendingPostSync] Check failed",
  { postId, reason }
);
```

Do not log full sensitive Facebook session information.

---

# Sync Metadata

Consider storing:

```ts
{
  lastCheckedAt: Date;
  nextCheckAt?: Date;
  syncAttempts: number;
  lastSyncError?: string;
}
```

This will help later with debugging and monitoring.

---

# Manual Refresh

The architecture should make it possible to add a website action later:

```text
Check Status
```

or:

```text
Refresh Pending Posts
```

The manual action should reuse the same sync logic as automatic checks.

Do not implement a separate duplicate checker.

---

# Manual Test Cases

## Test 1 — Still Pending

Initial state:

```text
PENDING_APPROVAL
```

Admin has not approved the post.

Expected:

```text
sync result:
STILL_PENDING

database:
PENDING_APPROVAL
```

---

## Test 2 — Approved Post

Initial state:

```text
PENDING_APPROVAL
```

Admin approves the post.

Next sync:

```text
matching post found
```

Expected database:

```ts
{
  status: "PUBLISHED",
  postUrl: "..."
}
```

---

## Test 3 — Facebook Loading Failure

Expected:

```text
CHECK_FAILED
```

Database status must remain:

```text
PENDING_APPROVAL
```

---

## Test 4 — Duplicate Sync

Run the sync twice.

Expected:

```text
first run:
PENDING_APPROVAL → PUBLISHED

second run:
no duplicate updates
```

---

## Test 5 — Similar Existing Post

An old post has similar text.

The sync must not incorrectly match it as the pending post.

Use timestamp/fingerprint/context signals.

---

# Out of Scope

Do not implement yet:

```text
REJECTED detection
post deletion/removal
reaction tracking
comment tracking
share tracking
analytics
historical importing
mass group crawling
```

---

# Implementation Rules for AI Agent

Before implementing:

1. Read this file.
2. Read `PENDING_POST_SYNC_PROGRESS.md`.
3. Read the existing post tracking implementation.
4. Reuse existing Facebook helpers where possible.
5. Find the first incomplete progress phase.
6. Implement only that phase.
7. Update the progress file.
8. Run relevant checks/tests.
9. Stop for review.

Do not automatically continue to the next phase.

---

# Definition of Done

This feature is complete when:

* Pending posts can be fetched.
* Eligible pending posts can be scheduled for re-check.
* The extension can navigate to the relevant group.
* The submitted post can be matched reliably.
* A confirmed post updates from `PENDING_APPROVAL` to `PUBLISHED`.
* The post permalink is captured when possible.
* Failed checks do not change the post status.
* Duplicate sync runs are safe.
* Sync frequency is controlled.
* The progress file is complete.
* Manual tests pass.
