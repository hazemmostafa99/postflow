# Extension-Owned Maintenance Sync — Feature Specification

## Feature Name

Extension-Owned Pending Approval and Analytics Refresh

## Goal

Periodically refresh:

- Facebook posts waiting for Group approval.
- Engagement analytics for published Facebook posts.

Every extension installation must process only jobs assigned to its own
Facebook connection. An extension must never open, inspect, claim, or update a
job owned by another extension instance.

## Mandatory Review and Validation Role

The implementation agent must pause and request user input whenever a product,
ownership, migration, or data-retention decision could change the intended
behavior. It must not silently choose between materially different policies.

The implementation agent must also identify manual validation that requires
the user's browser or Facebook sessions. After the relevant code is ready, it
must provide a concrete manual test procedure, wait for the user's result, and
record the outcome in the progress file before marking the live-validation
phase complete.

Automated checks may be run autonomously. Manual Facebook or multi-profile
verification must be explicitly requested from the user and must never be
claimed as passed without the user's confirmation.

---

## Background

PostFlow can have multiple extension installations for the same PostFlow user.
Each installation represents a separate Chrome profile and Facebook session.

The current data model already provides most of the ownership chain:

```text
ExtensionInstallation.extensionInstanceId
        ↓
FacebookConnection.extensionInstanceId
        ↓
Group.facebookConnectionId
        ↓
PublishingJob.facebookConnectionId
```

`facebookConnectionId` is the canonical job owner. The instance ID identifies
the worker currently authorized to operate that connection.

The extension sends its identity in:

```http
x-extension-instance-id: <instance-id>
```

Worker APIs must resolve that value to a verified Facebook connection before
returning or changing any job.

---

## Core Ownership Rule

For every publishing, pending-approval, or analytics operation:

```text
requesting extension instance
        ↓
verified Facebook connection
        ↓
job.facebookConnectionId must match connection._id
```

If the instance header is missing, unknown, disconnected, unverified, or mapped
to a different connection, the backend must not return job data or accept a
result.

Ownership validation must fail closed. Missing ownership information must not
fall back to all jobs belonging to the PostFlow user.

Jobs without `facebookConnectionId` are legacy/unowned jobs. They must be
migrated or explicitly assigned before automatic processing.

---

## Canonical Ownership Decision

Store `facebookConnectionId` on publishing jobs as the durable owner.

Do not use `extensionInstanceId` as the only permanent owner because an
extension can be reinstalled or intentionally reassigned. The instance ID is
used for worker authorization and temporary leases.

The initial supported relationship is:

```text
one extension instance ↔ one Facebook connection
```

Sharing one Facebook connection across multiple active extension instances is
out of scope. If introduced later, it must use an explicit worker-election or
lease policy.

---

## Scope

This feature includes:

- Strict connection ownership on extension worker APIs.
- Automatic pending-approval refresh.
- Automatic engagement analytics refresh.
- Atomic maintenance-work claims and expiring leases.
- Safe single-post and batch manual refresh.
- Coordination between publishing and maintenance work.
- Retry/backoff scheduling.
- Indexes, diagnostics, and multi-instance tests.

This feature does not include:

- Detecting rejected or deleted Facebook posts.
- Scraping comment bodies or Facebook user data.
- Sharing a single connection between multiple extension installations.
- Running Facebook checks from the backend without an extension session.

---

## Scheduling Policy

The extension scheduler wakes periodically, while the backend decides whether
an individual job is due.

### Pending Approval

```text
Post age              Refresh interval
0–1 hour              10 minutes
1–6 hours             30 minutes
6–24 hours            1 hour
1–7 days              3 hours
Older than 7 days     24 hours
```

The pending scheduler should wake every 10 minutes.

### Engagement Analytics

```text
Post age              Refresh interval
0–1 hour              15 minutes
1–6 hours             30 minutes
6–24 hours            2 hours
1–7 days              6 hours
Older than 7 days     24 hours
```

The analytics scheduler should wake every 15 minutes.

### Failure Backoff

Technical failures use twice the normal interval, capped at 24 hours.

Failures must not change the post's business status or replace valid analytics
values.

### Scheduler Jitter

Use a deterministic initial delay of zero to two minutes derived from the
extension instance ID. This prevents many installations from polling the API at
the same moment.

---

## Work Priority and Coordination

Facebook work must be processed in this order:

```text
1. New publishing jobs
2. Pending-approval checks
3. Engagement analytics
```

Only one Facebook navigation operation may run inside an extension at a time.

Automatic maintenance batches should:

- Process sequentially.
- Use a small default limit, initially three jobs per work type.
- Stop between items when a new publishing job is available.
- Observe a short execution budget so maintenance cannot monopolize the
  extension.
- Never use an automatic foreground-tab retry.

Manual refresh may provide a deliberate foreground retry when clearly reported
to the user.

---

## Backend Work Claim

Ordinary read queries are not sufficient because two overlapping requests can
receive the same due job.

Selection must atomically create a short maintenance lease. A conceptual lease
contains:

```ts
type MaintenanceLease = {
  type: "PENDING_APPROVAL" | "ENGAGEMENT";
  claimedByExtensionInstanceId: string;
  claimToken: string;
  expiresAt: Date;
};
```

The backend claim operation must include all of these filters:

```text
job.facebookConnectionId == requestingConnection._id
job is eligible for the requested work type
job.next...At is missing or due
no active maintenance lease exists
```

The result endpoint must require the matching claim token. A stale or foreign
worker cannot update the job.

Leases must expire so work can recover after a browser or service-worker
restart.

---

## Worker API Requirements

All extension job endpoints must require:

```text
x-clerk-user-id
x-extension-instance-id
verified Facebook connection
matching job.facebookConnectionId
```

This applies to:

- Publishing job claims and status updates.
- Pending-approval claims and results.
- Engagement claims and results.
- Reading an individual worker job.

Invalid ownership should return an authorization error or an empty claim
result, depending on whether the request targets a specific job or asks for the
next available job.

Legacy user-wide fallback behavior must not be used by extension worker APIs.

---

## Safe Manual Refresh

The website must send only the requested job ID and maintenance type to the
authenticated web API. The web API stores a durable maintenance request on the
job; it must not depend on the browser profile where the dashboard is open.

The website and clicking extension must not be the source of truth for:

- Facebook post URL.
- Group URL.
- Post content.
- Connection ownership.
- Eligibility state.

The extension assigned to the job's Facebook connection polls a
connection-scoped maintenance queue. It first claims the requested job from
the backend, then opens the authoritative Facebook URL returned by the claim.

The request remains queued if the owning extension is offline. The dashboard
may report that it is waiting for the owning extension; it must not attempt to
route through another extension instance.

The profile where the dashboard is open does not need to own the job and must
not receive the job's Facebook URL or counters. Only the owning extension can
claim, inspect, and update it.

Manual and automatic refresh must reuse the same check and persistence logic.

---

## Pending-Approval Behavior

Valid transitions remain:

```text
PENDING_APPROVAL + confirmed public post → PUBLISHED
PENDING_APPROVAL + still pending          → PENDING_APPROVAL
PENDING_APPROVAL + technical failure      → PENDING_APPROVAL
```

Not finding a post is not evidence that it was rejected.

The result must update scheduling metadata and release the maintenance lease.

---

## Analytics Behavior

Only successful jobs with:

```text
submissionStatus == PUBLISHED
non-empty postUrl
due nextEngagementSyncAt
```

are eligible.

Known reaction or comment counts may be updated independently. Missing or
unrecognized counts must preserve previous valid values.

Scheduled analytics runs must stay in background tabs. If Facebook does not
render a usable surface in the background, record a failed attempt and apply
backoff. Do not steal focus from the user.

---

## Database Indexes

Add indexes supporting connection-scoped due-work queries.

Conceptual pending index:

```ts
{
  facebookConnectionId: 1,
  status: 1,
  submissionStatus: 1,
  nextCheckAt: 1,
  submittedAt: 1
}
```

Conceptual analytics index:

```ts
{
  facebookConnectionId: 1,
  status: 1,
  submissionStatus: 1,
  nextEngagementSyncAt: 1,
  publishedDetectedAt: 1
}
```

Final index order should be verified using the actual MongoDB query plans.

---

## Logging and Diagnostics

Structured logs should include:

- Job ID.
- Work type.
- Facebook connection ID.
- Masked extension instance ID.
- Claim/lease outcome.
- Result status.
- Retry timestamp.

Do not log cookies, tokens, full Facebook DOM, or full post content.

Useful operational counters include:

- Claims created.
- Empty claim requests.
- Lease conflicts.
- Lease expirations.
- Successful refreshes.
- Failed refreshes by reason.
- Jobs rejected because of ownership mismatch.

---

## Migration

Before strict ownership is enabled:

1. Backfill `PublishingJob.facebookConnectionId` from the owned Group where
   possible.
2. Produce a report of jobs and groups that remain unowned.
3. Exclude unresolved jobs from all automatic worker queues.
4. Provide an explicit administrative assignment or archival decision for
   unresolved records.

The migration must be safe to rerun.

---

## Required Tests

### Ownership

- Instance A claims only Connection A jobs.
- Instance B claims only Connection B jobs.
- A cannot fetch, open, or update B's pending jobs.
- A cannot fetch, open, or update B's analytics jobs.
- Missing instance headers fail closed.
- Unknown or unverified instances fail closed.
- Legacy jobs without a connection are excluded.

### Claims and Recovery

- Two simultaneous claims return a job to only one worker.
- A result with the wrong claim token is rejected.
- An expired lease can be reclaimed by the owning connection.
- A stale worker cannot overwrite the newer worker's result.

### Scheduling

- Pending age bands calculate the expected next check.
- Analytics age bands calculate the expected next check.
- Failures double the delay and cap it at 24 hours.
- Non-due jobs are not claimed.

### Extension Coordination

- Publishing prevents maintenance navigation from starting.
- Maintenance yields to newly available publishing work between items.
- Pending and analytics batches do not overlap.
- Scheduled analytics never activates a foreground tab.

### Manual Refresh

- The page supplies only a job ID.
- The backend returns authoritative job data after ownership validation.
- A foreign job ID produces no Facebook navigation.
- Manual and automatic runs use the same checker and result endpoint.

### Live Multi-Profile Validation

- Run two Chrome profiles for one PostFlow user.
- Publish through both connections concurrently.
- Confirm each profile refreshes only its own pending posts and analytics.
- Close and restart one profile and confirm lease recovery.
- Confirm the other profile continues without interruption.

---

## Rollout Strategy

1. Add ownership tests and migration reporting.
2. Enforce strict worker authentication and exclude unowned jobs.
3. Add maintenance leases and claim-token result validation.
4. Convert manual refresh to claim by job ID.
5. Enable pending scheduling with conservative batch limits.
6. Enable background-only analytics scheduling.
7. Validate with two profiles before increasing batch sizes.
8. Monitor lease conflicts, failures, API load, and Facebook interruptions.

Use a feature flag for automatic analytics during initial rollout.

---

## Definition of Done

The feature is complete when:

- Every worker endpoint requires a verified extension instance.
- All worker selection and updates are scoped by `facebookConnectionId`.
- No missing-header or legacy fallback can expose user-wide work.
- Pending and analytics work is claimed atomically with expiring leases.
- Result writes require a valid claim token.
- Manual refresh validates ownership before Facebook navigation.
- Pending refresh follows the approved adaptive schedule.
- Analytics refresh follows the approved adaptive schedule.
- Publishing has priority over maintenance work.
- Scheduled analytics never steals foreground focus.
- Required automated tests pass.
- Two-profile live validation confirms complete fault and ownership isolation.

