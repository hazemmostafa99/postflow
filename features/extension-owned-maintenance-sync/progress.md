# Extension-Owned Maintenance Sync — Progress

## Goal

Add safe automatic pending-approval and engagement refresh while guaranteeing
that every extension instance operates only on jobs assigned to its Facebook
connection.

Implementation must follow the phases below in order. Complete and review one
phase before continuing to the next.

---

## Phase 1 — Existing Architecture Review

### Checklist

- [x] Locate extension instance identity creation and persistence.
- [x] Confirm the instance ID is sent with extension API calls.
- [x] Locate Facebook connection ownership.
- [x] Trace ownership from Groups into Publishing Jobs.
- [x] Review publishing job claim behavior.
- [x] Review pending-approval scheduling and selection.
- [x] Review analytics scheduling and selection.
- [x] Review manual single-post refresh paths.
- [x] Identify fail-open and duplicate-work risks.

### Review Notes

```text
Status: COMPLETE

Existing strengths:

- Extension instance IDs persist in chrome.storage.local.
- Every normal extension API request includes x-extension-instance-id.
- Facebook connections are unique per PostFlow user and extension instance.
- Groups and newly created publishing jobs store facebookConnectionId.
- Normal publishing claims are atomic and have a 15-minute recovery lease.
- Pending and analytics batch queries filter by the resolved connection when a
  valid instance header is present.
- Pending and analytics retry schedules are centralized in backend helpers.

Risks found:

- Worker endpoints fall back to user-wide behavior when the instance header is
  missing.
- assertWorkerOwnsJob skips connection validation when no instance ID is sent.
- Single-post manual refresh trusts URLs and job data supplied by the webpage
  and can navigate before backend ownership validation.
- Pending and analytics queue reads have no backend lease or claim token.
- Automatic analytics is disabled even though its progress document describes
  the scheduler as complete.
- Analytics can activate a foreground Facebook tab on render retry.
- Automatic maintenance can delay newly available publishing work for the
  duration of a full batch.
- Connection-scoped due-work indexes are incomplete.

Decision:

- Keep facebookConnectionId as the canonical durable job owner.
- Use extensionInstanceId for verified worker authorization and temporary
  leases.
- Support one active extension instance per Facebook connection initially.
```

### Review Gate

Architecture and ownership decisions must be approved before implementation.

---

## Phase 2 — Ownership Migration and Indexes

### Checklist

- [x] Audit Groups without `facebookConnectionId`.
- [x] Audit Publishing Jobs without `facebookConnectionId`.
- [x] Make the existing ownership migration idempotent and report unresolved
  records.
- [x] Exclude unresolved jobs from automatic worker queues.
- [x] Add the pending due-work compound index.
- [x] Add the analytics due-work compound index.
- [x] Verify indexes do not conflict with existing deployments.
- [x] Add migration and query-filter tests.

### Review Notes

```text
Status: COMPLETE

Files changed:

- `apps/api/src/posts/jobs.controller.ts`
- `apps/api/src/schemas/publishing-job.schema.ts`
- `apps/api/scripts/migrate-connection-ownership.mjs`

Migration behavior:

- The ownership migration now considers both missing and null connection IDs.
- It reports the number of groups still without a connection and samples up to
  twenty unresolved job IDs.
- It only counts a job as migrated when the guarded update modifies it, so the
  script remains safe to rerun.

Indexes:

- Added connection-scoped due-work indexes for pending approval and analytics.
- Existing publishing and post indexes remain in place.

Queue behavior:

- Automatic publishing, pending, and analytics queue filters now exclude jobs
  without an explicit `facebookConnectionId`.
- Phase 3 now removes the no-header worker fallback entirely.

Checks:

- API build passes.
- Full Prettier check still reports pre-existing formatting differences in the
  touched files; no broad formatting rewrite was applied.
```

### Review Gate

Confirm all automatic work is either owned or deliberately excluded.

---

## Phase 3 — Strict Worker Authorization

### Checklist

- [x] Create/reuse one helper that requires a non-empty extension instance ID.
- [x] Resolve the instance to a verified Facebook connection.
- [x] Require strict ownership for `GET /api/jobs/next`.
- [x] Require strict ownership for individual worker job reads.
- [x] Require strict ownership for publishing status updates.
- [x] Require strict ownership for pending claims/results.
- [x] Require strict ownership for analytics claims/results.
- [x] Remove user-wide fallback behavior from worker endpoints.
- [x] Preserve non-worker website APIs where appropriate.
- [x] Add missing/invalid/foreign-instance tests.

### Review Notes

```text
Status: COMPLETE

Authorization helper:

- Added `requireExtensionInstanceId()` and made `assertWorkerOwnsJob()` fail
  closed when the worker header is missing.

Endpoints hardened:

- Publishing job claims now require a non-empty instance ID and a verified
  connection.
- Pending and analytics queue reads require the instance ID and filter by the
  resolved connection.
- Individual reads and all job status, pending-sync, and engagement updates
  require matching connection ownership.
- The user-wide no-header worker fallback was removed.

Compatibility notes:

- Extension API calls already send the instance header, so normal workers keep
  their existing flow.
- Website-facing non-worker APIs were not changed in this phase.

Tests:

- Jobs controller suite passes with missing-header, invalid-instance, and
  connection-routing coverage.
```

### Review Gate

Verify an extension cannot read or update another connection's jobs.

---

## Phase 4 — Atomic Maintenance Claims

### Checklist

- [x] Define maintenance lease fields and work types.
- [x] Generate a random claim token for every lease.
- [x] Atomically claim one due pending-approval job.
- [x] Atomically claim one due analytics job.
- [x] Filter claims by verified `facebookConnectionId`.
- [x] Exclude active leases.
- [x] Permit expired leases to be reclaimed.
- [x] Validate the claim token when a maintenance lease is present.
- [x] Release the lease after accepted results.
- [x] Ensure failures still schedule backoff and release the lease.
- [x] Add atomic-claim tests.
- [x] Add stale-token tests.

### Review Notes

```text
Status: COMPLETE

Lease model:

- Added `maintenanceClaimedByExtensionInstanceId`, `maintenanceClaimType`,
  `maintenanceClaimToken`, and `maintenanceClaimExpiresAt` to publishing jobs.
- Claims expire after five minutes and can be reclaimed after expiry.

Claim endpoints:

- Existing pending and analytics queue endpoints now atomically claim each
  returned job and include its claim token in the response.

Lease duration:

- Five minutes.

Recovery behavior:

- A second worker cannot claim an active lease. An expired lease becomes
  eligible again. Accepted result writes release all lease fields.

Tests:

- Jobs controller suite passes with pending/analytics claim coverage and stale
  token rejection.
- API and extension builds pass.
- The extension Node test runner is blocked in this environment by `spawn
  EPERM` before individual tests execute.

Compatibility note:

- Manual refresh now claims authoritative job data before Facebook navigation.
- Maintenance result writes require a matching claim token.
```

### Review Gate

Demonstrate that concurrent requests cannot claim the same maintenance job.

---

## Phase 5 — Safe Manual Refresh

### Checklist

- [x] Change the dashboard request to contain only the job ID and type.
- [x] Remove trust in website-provided Facebook and Group URLs.
- [x] Queue the request through the authenticated web API and claim it through
  the ownership-scoped worker API.
- [x] Navigate only after a successful claim.
- [x] Return a useful message when another connection owns the job.
- [x] Perform no Facebook navigation for foreign or invalid job IDs.
- [x] Reuse the same pending checker as automatic refresh.
- [x] Reuse the same engagement checker as automatic refresh.
- [x] Add manual-refresh ownership tests.

### Review Notes

```text
Status: IMPLEMENTED — cross-profile queue added; awaiting manual validation

Website payload:

- Pending and analytics events now send only the job ID.

Backend validation:

- `POST /api/jobs/:id/maintenance-request` queues a dashboard request using
  the authenticated web user without exposing job data to the clicking profile.
- The owning extension polls a connection-scoped queue and then uses
  `POST /api/jobs/:id/maintenance-claim` to verify ownership, eligibility, and
  active lease state.

Extension behavior:

- The owning extension polls manual requests every minute, claims authoritative
  job metadata, and only then opens a Facebook tab.
- Requests remain queued while the owning extension is offline.

Tests:

- API jobs controller tests pass; API, extension, and web builds pass.
- User validation confirmed a dashboard request was processed by the owning
  profile: the owner opened the post, completed the engagement check, and
  persisted it with `updated: true`; the other profile processed zero jobs.
```

### Review Gate

Verify a foreign job ID cannot cause the extension to open Facebook.

---

## Phase 6 — Maintenance Coordinator

### Checklist

- [x] Create a single coordinator for Facebook maintenance work.
- [x] Keep the local single-flight navigation guard.
- [x] Give new publishing jobs highest priority.
- [x] Run pending approval before analytics.
- [x] Check for publishing work between maintenance items.
- [x] Stop maintenance when publishing work becomes available.
- [x] Process maintenance jobs sequentially.
- [x] Limit automatic pending work to three items initially.
- [x] Limit automatic analytics work to three items initially.
- [x] Add an execution-time budget.
- [x] Ensure alarms safely skip when another operation is active.
- [x] Add priority and overlap tests where practical.

### Review Notes

```text
Status: IMPLEMENTED — awaiting review and live validation

Coordinator entry point:

- `runMaintenanceCoordinator()` in the extension service worker.

Priority behavior:

- Publishing is checked before every maintenance item. Pending approval is
  processed before engagement analytics. A new publishing job is run before
  the next maintenance item.

Batch/time limits:

- Three items per maintenance type and a 45-second execution budget. Queue
  alarms skip when publishing or another maintenance navigation is active.

Tests:

- Extension typecheck/build passes. Background coordinator behavior depends on
  Chrome APIs, so live multi-job priority validation remains required.

Manual validation:

- User logs confirmed the owner coordinator processed one analytics request in
  7.4 seconds and the foreign profile processed zero requests.
- Publishing-priority and multi-job sequential behavior still need a dedicated
  run.
```

### Review Gate

Confirm maintenance cannot monopolize or interrupt publishing.

---

## Phase 7 — Pending-Approval Scheduler

### Checklist

- [ ] Retain the backend age-based pending schedule.
- [ ] Wake the pending scheduler every 10 minutes.
- [ ] Add deterministic per-instance startup jitter.
- [ ] Claim only due pending jobs.
- [ ] Preserve `PENDING_APPROVAL` on not-found and technical failure.
- [ ] Double failed-attempt delay, capped at 24 hours.
- [ ] Release claims after every accepted result.
- [ ] Confirm restart recovery through lease expiry.
- [ ] Add schedule boundary tests.

### Approved Cadence

```text
0–1 hour:          10 minutes
1–6 hours:         30 minutes
6–24 hours:        1 hour
1–7 days:          3 hours
Older than 7 days: 24 hours
```

### Review Notes

```text
Status: NOT STARTED

Alarm configuration:

-

Jitter strategy:

-

Tests:

-
```

### Review Gate

Run a pending batch in two Chrome profiles before enabling broadly.

---

## Phase 8 — Engagement Analytics Scheduler

### Checklist

- [ ] Retain the backend age-based analytics schedule.
- [ ] Enable an analytics alarm every 15 minutes.
- [ ] Add deterministic per-instance startup jitter.
- [ ] Claim only due published jobs with valid permalinks.
- [ ] Keep scheduled analytics in background tabs.
- [ ] Disable foreground retry for automatic runs.
- [ ] Preserve foreground retry only for explicit manual actions if needed.
- [ ] Preserve previous metrics when detection is partial or fails.
- [ ] Double failed-attempt delay, capped at 24 hours.
- [ ] Add schedule and background-tab tests.
- [ ] Correct scheduler documentation drift.

### Approved Cadence

```text
0–1 hour:          15 minutes
1–6 hours:         30 minutes
6–24 hours:        2 hours
1–7 days:          6 hours
Older than 7 days: 24 hours
```

### Review Notes

```text
Status: NOT STARTED

Alarm configuration:

-

Automatic tab behavior:

-

Feature flag:

-

Tests:

-
```

### Review Gate

Verify automatic analytics never steals focus from the user.

---

## Phase 9 — Diagnostics and Operational Safety

### Checklist

- [ ] Add structured claim and result logs.
- [ ] Mask extension instance IDs in logs.
- [ ] Do not log tokens, cookies, DOM trees, or full post content.
- [ ] Track empty claims.
- [ ] Track lease conflicts and expirations.
- [ ] Track ownership rejections.
- [ ] Track success/failure counts by work type.
- [ ] Add an automatic-analytics feature flag.
- [ ] Document rollback behavior.

### Review Notes

```text
Status: NOT STARTED

Logs/metrics:

-

Feature flag:

-

Rollback:

-
```

### Review Gate

Confirm rollout can be observed and automatic analytics can be disabled safely.

---

## Phase 10 — Automated Verification

### Checklist

- [ ] Run ownership unit tests.
- [ ] Run simultaneous-claim tests.
- [ ] Run lease recovery tests.
- [ ] Run pending schedule tests.
- [ ] Run analytics schedule tests.
- [ ] Run manual-refresh safety tests.
- [ ] Run API typecheck/build.
- [ ] Run extension typecheck/build.
- [ ] Run web typecheck/build.
- [ ] Run relevant lint checks.
- [ ] Record any unrelated pre-existing failures separately.

### Review Notes

```text
Status: NOT STARTED

API checks:

-

Extension checks:

-

Web checks:

-

Known unrelated failures:

-
```

### Review Gate

All feature-specific automated checks must pass before live validation.

---

## Phase 11 — Live Multi-Profile Validation

### Checklist

- [ ] Connect Chrome Profile A and Profile B to the same PostFlow user.
- [ ] Verify each profile has a different extension instance and connection.
- [ ] Create Group jobs assigned to both connections.
- [ ] Confirm A never publishes B jobs.
- [ ] Confirm B never publishes A jobs.
- [ ] Confirm A refreshes only A pending approvals.
- [ ] Confirm B refreshes only B pending approvals.
- [ ] Confirm A refreshes only A analytics.
- [ ] Confirm B refreshes only B analytics.
- [ ] Trigger simultaneous scheduler wakes.
- [ ] Close Profile A during a leased maintenance job.
- [ ] Confirm Profile B continues normally.
- [ ] Restart Profile A and confirm safe lease recovery.
- [ ] Confirm no duplicate updates or cross-profile navigation.
- [ ] Confirm scheduled analytics never foregrounds a tab.

### Review Notes

```text
Status: NOT STARTED

Profiles tested:

-

Ownership result:

-

Restart result:

-

Issues found:

-
```

### Review Gate

Live two-profile ownership and fault isolation must pass before rollout.

---

## Phase 12 — Rollout and Cleanup

### Checklist

- [ ] Enable strict ownership in production.
- [ ] Enable pending scheduling with conservative batch limits.
- [ ] Enable automatic analytics behind its feature flag.
- [ ] Monitor API load and empty claim rate.
- [ ] Monitor ownership rejections and lease conflicts.
- [ ] Monitor Facebook navigation failures.
- [ ] Increase limits only after stable observation.
- [ ] Remove obsolete queue-read paths.
- [ ] Remove temporary debug logging.
- [ ] Update related feature documentation.
- [ ] Mark this progress file complete.

### Review Notes

```text
Status: NOT STARTED

Rollout date:

-

Initial limits:

-

Monitoring result:

-

Cleanup:

-
```

---

## Progress Summary

| Phase | Status | Reviewed |
| --- | --- | --- |
| 1. Existing architecture review | Complete | Pending approval |
| 2. Ownership migration and indexes | Complete | Pending approval |
| 3. Strict worker authorization | Complete | Pending manual validation |
| 4. Atomic maintenance claims | Complete | Pending manual validation |
| 5. Safe manual refresh | Implemented | Pending manual two-profile validation |
| 6. Maintenance coordinator | Implemented | Pending manual two-profile validation |
| 7. Pending-approval scheduler | Not started | No |
| 8. Engagement analytics scheduler | Not started | No |
| 9. Diagnostics and operational safety | Not started | No |
| 10. Automated verification | Not started | No |
| 11. Live multi-profile validation | Not started | No |
| 12. Rollout and cleanup | Not started | No |

---

## Current Status

```text
Status: Phase 6 implementation complete; awaiting manual validation.
Current phase: Phase 6 review gate.
Next action: Validate that publishing work takes priority and that maintenance
requests run sequentially in the owning profile without cross-profile access.
```

---

## Implementation Workflow

For every implementation session:

1. Read `feature.md` completely.
2. Read this progress file completely.
3. Work only on the first incomplete phase.
4. Preserve unrelated worktree changes.
5. Add or update tests for the phase.
6. Run relevant checks.
7. Update the phase notes and progress summary.
8. If a decision could materially change ownership, migration, or data
   behavior, ask the user before proceeding.
9. Identify and request any required manual browser/Facebook validation.
10. Stop for review before starting the next phase.

