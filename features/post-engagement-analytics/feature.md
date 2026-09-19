# Facebook Post Engagement Analytics — Feature Specification

## Feature Name

Facebook Post Engagement Analytics

---

# Goal

Collect engagement analytics for Facebook Group posts that have already been successfully published.

Initial analytics:

```ts
reactionCount
commentCount
```

The Chrome Extension should periodically open published Facebook posts, read their visible engagement counters, and send the updated values to the backend.

---

# Existing Assumptions

The following functionality already exists:

```text
Post submission
      ↓
PUBLISHED / PENDING_APPROVAL
      ↓
Pending post synchronization
      ↓
PENDING_APPROVAL → PUBLISHED
```

This feature starts AFTER a post has reached:

```ts
status === "PUBLISHED"
```

The existing pending-post synchronization feature must not be redesigned as part of this work.

---

# High-Level Flow

```text
Published Posts
      ↓
Find posts requiring analytics refresh
      ↓
Chrome Extension
      ↓
Open Facebook Post URL
      ↓
Wait for post to load
      ↓
Find target post
      ↓
Extract engagement
      ↓
┌──────────────────────┐
│ reactionCount        │
│ commentCount         │
└──────────────────────┘
      ↓
Update Backend
      ↓
Display on Website
```

---

# Scope

Implement:

```text
Reaction count
Comment count
Last engagement sync timestamp
Engagement sync scheduling
Manual engagement refresh support
```

Do NOT implement yet:

```text
Comment bodies
Comment authors
Comment replies
Reaction users
Reaction-type breakdown
Shares
Sentiment analysis
Automatic replies
Historical engagement charts
```

---

# Important Architecture Rule

Facebook DOM inspection must happen inside the Chrome Extension using the authenticated Facebook session.

The backend remains responsible for:

```text
post records
analytics persistence
sync eligibility
latest analytics values
```

The extension remains responsible for:

```text
Facebook navigation
Facebook DOM detection
Facebook analytics extraction
```

---

# Eligible Posts

Only published posts should be considered.

Minimum eligibility:

```ts
post.status === "PUBLISHED"
```

Preferred:

```ts
post.status === "PUBLISHED" &&
post.postUrl != null
```

A valid `postUrl` should be the primary way to reach the post.

Avoid searching through the entire group feed when a permalink already exists.

---

# Engagement Data Model

Suggested domain type:

```ts
export type FacebookPostEngagement = {
  reactionCount: number;
  commentCount: number;
  lastSyncedAt: string;
};
```

Example post:

```ts
{
  id: "post_123",

  status: "PUBLISHED",

  postUrl:
    "https://www.facebook.com/groups/.../posts/.../",

  engagement: {
    reactionCount: 24,
    commentCount: 8,
    lastSyncedAt: "..."
  }
}
```

Follow the existing backend model structure instead of duplicating entities unnecessarily.

---

# Engagement Sync Result

Create a clear extension result type:

```ts
export type PostEngagementSyncResult =
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

`PARTIAL` is useful when Facebook exposes one counter but the other cannot be reliably detected.

---

# Core Data Integrity Rule

Never convert a parsing failure into zero.

Bad:

```ts
const reactionCount =
  extractReactionCount(post) ?? 0;
```

Because:

```text
null
```

means:

```text
could not determine the count
```

while:

```text
0
```

means:

```text
the post definitely has zero reactions
```

These are different states.

---

# Facebook Count Parser

Create one reusable parser:

```ts
parseFacebookCount(value: string): number | null
```

It should support common Facebook-style counters.

Examples:

```ts
parseFacebookCount("0")
// 0

parseFacebookCount("12")
// 12

parseFacebookCount("1K")
// 1000

parseFacebookCount("1.2K")
// 1200

parseFacebookCount("2M")
// 2000000
```

Handle whitespace and formatting safely.

Do not spread count parsing across different DOM helpers.

---

# Localization

Do not assume Facebook is always displayed in English.

Potential UI may be:

```text
12 comments
12 تعليق
1.2K reactions
...
```

Prefer:

```text
aria-label
role
semantic relationships
stable attributes
```

over exact English text when possible.

Any localized text parsing must be isolated so additional languages can be added later.

---

# Reaction Count Detection

Create an isolated helper:

```ts
extractReactionCount(
  postElement: HTMLElement
): number | null
```

Possible signals:

```text
reaction summary
reaction button
aria-label
accessible text
reaction counter container
```

Avoid Facebook-generated CSS class names as the primary detection strategy.

---

# Reaction Rules

The helper should distinguish:

```text
Confirmed zero reactions
```

from:

```text
Reaction UI not detected
```

Examples:

```ts
return 0;
```

only if the UI positively indicates zero/no reactions.

Return:

```ts
return null;
```

if detection fails.

---

# Comment Count Detection

Create:

```ts
extractCommentCount(
  postElement: HTMLElement
): number | null
```

Possible Facebook signals:

```text
comment summary
comment button
aria-label
visible comment count
```

Possible visible formats may include:

```text
1 comment
12 comments
1K comments
View 8 more comments
```

Do not scrape comment bodies in this phase.

---

# Locate Target Post

When opening:

```ts
post.postUrl
```

wait until the target post is rendered.

Create/reuse a helper:

```ts
findTargetPostElement()
```

Avoid reading engagement from unrelated recommended posts or feed items.

---

# Single Post Analytics Flow

Implement a single-post flow before batching.

Suggested function:

```ts
async function syncPostEngagement(
  post: PublishedFacebookPost
): Promise<PostEngagementSyncResult>
```

Conceptual behavior:

```ts
await navigateToPost(post.postUrl);

const postElement =
  await waitForTargetPost();

const reactionCount =
  extractReactionCount(postElement);

const commentCount =
  extractCommentCount(postElement);
```

Then return the appropriate result.

---

# Success Example

```ts
{
  status: "SUCCESS",
  reactionCount: 25,
  commentCount: 7
}
```

---

# Partial Example

```ts
{
  status: "PARTIAL",
  reactionCount: 25,
  reason: "Comment count could not be detected"
}
```

---

# Failure Example

```ts
{
  status: "CHECK_FAILED",
  reason: "Facebook post did not load"
}
```

---

# Backend Update

After a successful or partial sync, send only values that were positively detected.

Example:

```ts
{
  postId: "post_123",
  reactionCount: 25,
  commentCount: 7,
  syncedAt: "..."
}
```

Partial:

```ts
{
  postId: "post_123",
  reactionCount: 25,
  syncedAt: "..."
}
```

Do not send:

```ts
commentCount: 0
```

unless zero was actually confirmed.

---

# Backend Update Rules

The backend should:

```text
verify post exists
verify post is published
update provided metrics only
store last engagement sync timestamp
avoid overwriting values that were not provided
```

Updates should be idempotent.

---

# Analytics Metadata

Consider storing:

```ts
{
  lastEngagementSyncAt?: Date;
  nextEngagementSyncAt?: Date;

  engagementSyncAttempts?: number;

  lastEngagementSyncError?: string;
}
```

Keep these separate from pending-post status sync metadata.

Do not overload:

```ts
lastCheckedAt
```

if it currently represents approval-status checking.

Prefer:

```ts
lastStatusCheckAt
lastEngagementSyncAt
```

when both concepts exist.

---

# Selecting Posts for Sync

Create/reuse an endpoint such as:

```ts
getPublishedPostsForEngagementSync({
  limit: 10
});
```

Eligibility may include:

```text
PUBLISHED
has postUrl
not synced recently
not currently locked
within analytics tracking window
```

---

# Initial Batch Size

Start small.

Example:

```ts
limit: 5
```

or:

```ts
limit: 10
```

Do not process large numbers of Facebook posts concurrently.

---

# Batch Processing

Preferred:

```text
fetch eligible posts
      ↓
Post 1
      ↓
Post 2
      ↓
Post 3
```

Use sequential processing or extremely low concurrency.

One failed post must not stop the rest of the batch.

---

# Analytics Scheduling

Engagement typically changes faster soon after publishing.

Suggested conceptual strategy:

```text
0–1 hour old
→ check more frequently

1–6 hours
→ medium frequency

6–24 hours
→ lower frequency

1–7 days
→ occasional sync

older posts
→ manual / very low-frequency
```

Exact values should be decided during implementation and review.

---

# Example Initial Schedule

Potential starting point:

```text
0–1 hour
every 15 minutes

1–6 hours
every 30 minutes

6–24 hours
every 2 hours

1–7 days
every 6 hours

> 7 days
manual or daily
```

Treat these as configuration, not scattered hardcoded values.

---

# Scheduler

Reuse the existing extension scheduler/alarm infrastructure if available.

Avoid uncontrolled:

```ts
setInterval(...)
```

inside extension contexts that may be destroyed.

Create a clear entry point such as:

```ts
runEngagementAnalyticsSync()
```

---

# Sync Lock

Avoid duplicate analytics jobs.

Possible strategies:

```text
extension-level lock
storage lock
backend lock
```

Reuse existing locking from pending-post sync if possible.

---

# Manual Refresh

The architecture should support:

```text
Refresh Analytics
```

for a single post.

Example:

```ts
refreshPostEngagement(postId)
```

This must reuse the same:

```ts
syncPostEngagement()
```

logic.

Do not implement separate DOM logic for manual refresh.

---

# Logging

Use structured logs.

Start:

```ts
console.log(
  "[PostAnalytics] Starting engagement sync",
  { postId }
);
```

Success:

```ts
console.log(
  "[PostAnalytics] Engagement synced",
  {
    postId,
    reactionCount,
    commentCount
  }
);
```

Partial:

```ts
console.warn(
  "[PostAnalytics] Partial engagement result",
  { postId }
);
```

Failure:

```ts
console.warn(
  "[PostAnalytics] Engagement sync failed",
  { postId, reason }
);
```

Do not log Facebook cookies, tokens, session data, or full DOM trees.

---

# Suggested Code Organization

Follow existing architecture first.

Potential structure:

```text
facebook/
  analytics/
    types.ts
    parseFacebookCount.ts
    extractReactionCount.ts
    extractCommentCount.ts
    findTargetPostElement.ts
    syncPostEngagement.ts
    syncPublishedPosts.ts
```

Reuse existing:

```text
navigation helpers
post permalink helpers
Facebook wait helpers
scheduler
API client
locking
```

Do not duplicate existing code.

---

# Manual Test Cases

## Test 1 — No Engagement

Facebook post has:

```text
0 reactions
0 comments
```

Expected:

```ts
{
  status: "SUCCESS",
  reactionCount: 0,
  commentCount: 0
}
```

---

# Test 2 — Normal Engagement

Facebook displays:

```text
24 reactions
8 comments
```

Expected:

```ts
{
  status: "SUCCESS",
  reactionCount: 24,
  commentCount: 8
}
```

---

# Test 3 — Large Reaction Count

Facebook displays:

```text
1.2K reactions
```

Expected:

```ts
reactionCount === 1200
```

---

# Test 4 — Count Parsing Failure

Facebook's reaction structure is not recognized.

Expected:

```ts
reactionCount === undefined/null
```

Do not store:

```ts
reactionCount = 0
```

---

# Test 5 — Partial Result

Reaction count is detected but comments are not.

Expected:

```ts
{
  status: "PARTIAL",
  reactionCount: 24
}
```

The previous valid comment count must remain unchanged.

---

# Test 6 — Facebook Post Unavailable

Expected:

```ts
{
  status: "CHECK_FAILED"
}
```

Do not change the post's business status.

---

# Test 7 — Updated Engagement

Previous database:

```ts
{
  reactionCount: 10,
  commentCount: 2
}
```

Facebook now shows:

```text
25 reactions
7 comments
```

Expected database:

```ts
{
  reactionCount: 25,
  commentCount: 7
}
```

---

# Test 8 — Batch Failure Isolation

Batch:

```text
Post A → success
Post B → fails
Post C → success
```

Expected:

```text
A updated
B records failure
C updated
```

Post B must not stop the complete batch.

---

# Test 9 — Duplicate Sync

Run analytics sync multiple times.

Expected:

```text
No duplicate post records
No duplicated analytics objects
Latest counters remain correct
```

---

# Future Features

Future phases may add:

```text
reaction breakdown
comment bodies
comment replies
shares
engagement history
engagement growth charts
engagement rate
notification rules
```

These should build on this analytics layer.

---

# AI Agent Workflow

Every implementation session must:

1. Read `POST_ENGAGEMENT_ANALYTICS_FEATURE.md`.
2. Read `POST_ENGAGEMENT_ANALYTICS_PROGRESS.md`.
3. Inspect existing pending-post and published-post implementations.
4. Find the first incomplete analytics phase.
5. Implement only that phase.
6. Reuse existing navigation, scheduling, API, and locking utilities.
7. Update the progress file.
8. Run relevant tests, typecheck, and lint.
9. Provide a review summary.
10. Stop for review.

Do not continue automatically to another phase.

---

# Definition of Done

The feature is complete when:

* Published posts can be selected for analytics synchronization.
* The extension can open the correct post reliably.
* Reaction count can be detected.
* Comment count can be detected.
* Facebook formatted numbers can be parsed.
* Zero can be distinguished from parsing failure.
* Partial results are handled safely.
* Analytics are persisted to the backend.
* Existing valid metrics are not overwritten by failed detection.
* Batch analytics sync works.
* Analytics scheduling works.
* Duplicate sync runs are safe.
* Manual refresh can reuse the same analytics logic.
* Manual test cases pass.
* Progress file is completed.
