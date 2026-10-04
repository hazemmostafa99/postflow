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
- A later two-profile automatic run confirmed one profile processed one job
  while the other processed three distinct jobs sequentially in 19.1 seconds,
  matching the configured batch limit. Publishing-priority behavior still
  needs a dedicated run.
```

### Review Gate

Confirm maintenance cannot monopolize or interrupt publishing.

---

## Phase 7 — Pending-Approval Scheduler

### Checklist

- [x] Retain the backend age-based pending schedule.
- [x] Wake the pending scheduler every 10 minutes.
- [x] Add deterministic per-instance startup jitter.
- [x] Claim only due pending jobs.
- [x] Preserve `PENDING_APPROVAL` on not-found and technical failure.
- [x] Double failed-attempt delay, capped at 24 hours.
- [x] Release claims after every accepted result.
- [x] Confirm restart recovery through lease expiry.
- [x] Add schedule boundary tests.

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
Status: IMPLEMENTED — one-owner/two-profile isolation passed; recovery pending

Alarm configuration:

- Pending approval wakes every 10 minutes.
- The first wake uses a deterministic 0–2 minute offset derived from the
  persisted extension instance ID. The alarm is not moved on service-worker
  restarts once initialized.
- Manual maintenance remains on its one-minute queue wake.

Queue selection:

- Scheduled pending work is selected only when `nextCheckAt` is missing or due.
- A durable dashboard request is an explicit manual override and is selected
  by the manual-only queue, even when the normal age schedule is not due.

Jitter strategy:

- FNV-1a-style hashing maps the stable extension instance ID into the inclusive
  0–2 minute window. The ID itself is not logged.

Tests:

- `pending-sync-schedule.spec.ts` covers every age-band boundary and failure
  backoff/cap behavior.
- `maintenance-schedule.test.cjs` covers deterministic jitter and first-run
  calculation.
- API schedule tests and the extension build pass. The extension test runner
  remains subject to the environment's existing `spawn EPERM` limitation.

Manual validation received:

- On 2026-10-04, one owner profile armed the pending alarm with a 102,204 ms
  startup offset. Its manual-only coordinator correctly processed zero normal
  scheduled jobs, then the automatic coordinator claimed its pending post and
  persisted `STILL_PENDING` with `updated: true` in 5.2 seconds.
- A later two-profile capture confirmed connection
  `6ac121377d9ec29f45bd3556` (Facebook `61594593347843`, masked instance
  `pfi_…3966`) claimed pending job `6ac29436664315e2492a665b`, checked it once,
  and persisted `STILL_PENDING` with `updated: true` in 4.3 seconds.
- At the same time, connection `6ac2932046e01d0c0d641d11` (Facebook
  `100038098548578`, masked instance `pfi_…c173`) requested pending work,
  received `claim.empty`, processed zero pending items, and performed no
  pending-post navigation. This passes foreign-profile isolation for a job
  owned by the first profile.
- The inverse case with a pending job owned by the second profile and the
  five-minute lease-recovery run remain outstanding.

Manual validation required:

- Run two Chrome profiles with different extension instances and one pending
  job assigned to each. Capture the owner profile's pending scheduler wake and
  confirm the foreign profile does not claim or open the post.
- Stop the owner profile after a claim, wait for the five-minute lease to
  expire, restart it, and confirm the job can be claimed and completed once.
```

### Review Gate

Run a pending batch in two Chrome profiles before enabling broadly.

---

## Phase 8 — Engagement Analytics Scheduler

### Checklist

- [x] Retain the backend age-based analytics schedule.
- [x] Enable an analytics alarm every 15 minutes.
- [x] Add deterministic per-instance startup jitter.
- [x] Claim only due published jobs with valid permalinks.
- [x] Keep scheduled analytics in background tabs.
- [x] Disable foreground retry for automatic runs.
- [x] Preserve foreground retry only for explicit manual actions if needed.
- [x] Preserve previous metrics when detection is partial or fails.
- [x] Double failed-attempt delay, capped at 24 hours.
- [x] Add schedule and background-tab tests.
- [x] Correct scheduler documentation drift.

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
Status: COMPLETE — live two-profile background-tab validation passed

Alarm configuration:

- Chrome alarm `postflow-engagement-sync` wakes every 15 minutes.
- Its first wake uses a deterministic 0–2 minute offset derived from the
  extension instance ID plus an analytics namespace, avoiding alignment with
  the pending scheduler where possible.
- The backend still controls actual eligibility using the approved age bands.

Automatic tab behavior:

- Scheduled analytics opens an inactive tab and allows only one background
  render attempt.
- An empty background surface becomes `CHECK_FAILED`; the tab is never
  activated and backend backoff is applied.
- Explicit dashboard/manual runs retain the existing foreground retry.
- Only due successful published jobs with supported Facebook post permalinks
  can be claimed. Invalid, feed, and pending-approval URLs are excluded.

Feature flag:

- Phase 9 adds the rollout flag and operational counters before production
  rollout. Phase 8 enables the scheduler implementation for live validation.

Tests:

- Engagement schedule tests cover all age-band boundaries, doubled failure
  delay, and the 24-hour cap.
- Eligibility tests cover supported permalinks and reject feeds, pending URLs,
  foreign hosts, and invalid values.
- Result tests verify partial and failed checks preserve known counters.
- `engagement-sync-policy.test.cjs` covers automatic background-only behavior;
  the policy also passed a direct runtime check because this environment's
  Node test runner is blocked by `spawn EPERM`.
- API tests and builds plus the extension build pass.

Manual validation received:

- On 2026-10-04, one owner profile armed the analytics alarm for 15 minutes
  with a 103,002 ms startup offset and `backgroundOnly: true`.
- Its automatic coordinator ran with `manualOnly: false`, `pending: false`,
  `analytics: true`, and `analyticsMode: AUTOMATIC`.
- It opened the owned post in an inactive analytics tab, completed the first
  background render attempt, persisted the result with `updated: true`, and
  processed one item in 6.8 seconds. No foreground-retry event occurred.
- Two-profile logs then confirmed strict routing: Facebook profile
  `61594593347843` (connection `6ac121377d9ec29f45bd3556`) processed only job
  `6ac29436664315e2492a665d`, while profile `100038098548578` (connection
  `6ac2932046e01d0c0d641d11`) processed three different jobs:
  `6ac2b102faeec9db0499e167`, `6ac2b153faeec9db0499e16a`, and
  `6ac29436664315e2492a665e`.
- All four results were persisted with `updated: true`. The three-job batch was
  sequential and completed in 19.1 seconds. Neither profile logged an ownership
  rejection, duplicate job, overlapping check, or foreground retry.
- The user confirmed Chrome did not switch away from the active browser tab
  during either profile's automatic analytics run. This completes the
  background-only review gate.

Manual validation required:

- Complete. Both profiles processed only their owned analytics jobs, and the
  temporary Facebook tabs stayed in the background and closed after results.
```

### Review Gate

Verify automatic analytics never steals focus from the user.

---

## Phase 9 — Diagnostics and Operational Safety

### Checklist

- [x] Add structured claim and result logs.
- [x] Mask extension instance IDs in logs.
- [x] Do not log tokens, cookies, DOM trees, or full post content.
- [x] Track empty claims.
- [x] Track lease conflicts and expirations.
- [x] Track ownership rejections.
- [x] Track success/failure counts by work type.
- [x] Add an automatic-analytics feature flag.
- [x] Document rollback behavior.

### Review Notes

```text
Status: COMPLETE — live diagnostics review passed

Logs/metrics:

- API structured events cover claim creation, empty claims, accepted results,
  ownership rejection, lease conflicts, and expired result leases.
- Extension structured events and per-profile persisted counters cover claim
  requests/creation, empty claims, ownership/lease failures, and successful or
  failed results for pending approval and engagement independently.
- Counters are stored in `chrome.storage.local` as
  `maintenanceDiagnosticsV1`. Instance IDs are masked; tokens, cookies, DOM,
  and post content are excluded.

Feature flag:

- Public build-time boolean `AUTOMATIC_ANALYTICS_ENABLED` controls only the
  scheduled analytics alarm. Development defaults to enabled; production
  defaults to disabled until rollout approval.
- When disabled, startup clears the analytics alarm while publishing, pending
  approval, and manual analytics remain available.

Rollback:

- Set the selected environment's flag to `false`, rebuild, and reload. No
  database rollback is required; metrics and scheduling timestamps remain,
  and abandoned leases expire after five minutes.
- The extension README and feature specification document the procedure and
  the service-worker command for reading local counters.

Checks:

- Relevant API suites pass with 45 tests, including masked structured events,
  stale-token conflicts, and explicit expired-lease rejection.
- API build, development extension build, and production extension build pass.
  The production artifact was verified to emit
  `AUTOMATIC_ANALYTICS_ENABLED = false`; the development artifact was restored
  afterward with the flag enabled.
- Diagnostics masking/counter helpers passed a direct runtime check. The full
  extension Node test runner remains blocked by the environment's existing
  `spawn EPERM` limitation.

Manual validation required:

- Complete. On 2026-10-05, the development extension reported automatic
  analytics `ON`, emitted structured pending and engagement claim events with
  masked instance ID `pfi_…3966`, and independently incremented claim-request
  and empty-claim counters for both work types. The empty maintenance run
  completed in 1.3 seconds.
- The visible delay before the first events matched the expected identity
  verification, one-minute manual poll, and deterministic 102–103 second
  automatic startup jitter; it was not maintenance execution time.
```

### Review Gate

Confirm rollout can be observed and automatic analytics can be disabled safely.

---

## Phase 10 — Automated Verification

### Checklist

- [x] Run ownership unit tests.
- [x] Run simultaneous-claim tests.
- [x] Run lease recovery tests.
- [x] Run pending schedule tests.
- [x] Run analytics schedule tests.
- [x] Run manual-refresh safety tests.
- [x] Run API typecheck/build.
- [x] Run extension typecheck/build.
- [x] Run web typecheck/build.
- [x] Run relevant lint checks.
- [x] Record any unrelated pre-existing failures separately.

### Review Notes

```text
Status: COMPLETE — feature-specific automated review gate passed

API checks:

- Four focused suites pass with 47/47 tests: ownership and manual-refresh
  safety, atomic maintenance claims, pending scheduling, analytics scheduling,
  result preservation, and strict connection routing.
- Added explicit concurrent-claim coverage. Two simultaneous requests for the
  same due job result in one claim and one empty response.
- Added explicit recovery coverage. An expired maintenance lease can be
  reclaimed with a new token.
- The API build passes.
- The isolated scheduling and eligibility files pass ESLint with formatting
  disabled so repository line-ending noise does not mask semantic lint errors.

Extension checks:

- All maintenance-specific direct Node tests pass: deterministic alarm jitter,
  automatic background-only analytics policy, diagnostics masking/counters,
  and engagement extraction behavior.
- Across the extension's direct test files, 70 tests pass and one unrelated
  GraphQL-spy test fails as recorded below.
- The development extension build/typecheck passes. The production build also
  passed during Phase 9 and emitted automatic analytics as disabled by default.

Web checks:

- The production web build passes and includes the maintenance-request route.
- Web lint completes with zero errors and three existing warnings: two
  `no-img-element` warnings and one unused `props` warning.

Known unrelated failures:

- A broader API Posts test run passes 78 tests in eight suites, but
  `posts.controller.spec.ts` cannot start because the CommonJS Jest setup loads
  the ESM `@nestjs/mongoose/dist/index.js` package. The focused feature suites
  do not have this harness failure.
- The extension GraphQL-spy suite has one existing failure in the encoded
  composer-video-ID response test (`assert.ok(trusted)`). It is outside the
  maintenance scheduler, ownership, and analytics flow.
- A broad API lint invocation reports the repository's existing CRLF/Prettier
  differences plus legacy unsafe-enum/`any` findings in the large jobs
  controller/spec. No broad auto-format or unrelated lint rewrite was applied.
- `git diff --check` reports no whitespace errors; Git only warns that its
  configured checkout will convert the touched LF files to CRLF.
```

### Review Gate

All feature-specific automated checks must pass before live validation.

---

## Phase 11 — Live Multi-Profile Validation

### Checklist

- [x] Connect Chrome Profile A and Profile B to the same PostFlow user.
- [x] Verify each profile has a different extension instance and connection.
- [ ] Create Group jobs assigned to both connections.
- [ ] Confirm A never publishes B jobs.
- [ ] Confirm B never publishes A jobs.
- [x] Confirm A refreshes only A pending approvals.
- [ ] Confirm B refreshes only B pending approvals.
- [x] Confirm A refreshes only A analytics.
- [x] Confirm B refreshes only B analytics.
- [ ] Trigger simultaneous scheduler wakes.
- [ ] Close Profile A during a leased maintenance job.
- [ ] Confirm Profile B continues normally.
- [ ] Restart Profile A and confirm safe lease recovery.
- [x] Confirm no duplicate updates or cross-profile navigation.
- [x] Confirm scheduled analytics never foregrounds a tab.

### Review Notes

```text
Status: DEFERRED BY USER — partial validation retained, remaining cases not passed

Profiles tested:

- Profile A: connection `6ac121377d9ec29f45bd3556`, Facebook
  `61594593347843`, masked extension instance `pfi_…3966`.
- Profile B: connection `6ac2932046e01d0c0d641d11`, Facebook
  `100038098548578`, masked extension instance `pfi_…c173`.

Ownership result:

- Profile A claimed and completed its pending job
  `6ac29436664315e2492a665b` as `STILL_PENDING`, `updated: true`.
- Profile B had no pending job, received an empty pending claim, and did not
  open Profile A's group or job. No ownership rejection was needed because the
  backend connection filter excluded the foreign job before claiming.
- Earlier automatic analytics evidence confirms both profiles process only
  their own analytics jobs.

Restart result:

- Not tested yet. The five-minute expired-lease recovery scenario remains.

Issues found:

- None in this capture. The inverse pending ownership case still needs a
  pending job assigned to Profile B; simultaneous wake and publishing-priority
  behavior also remain to be validated.
- On 2026-10-05, the user directed work to proceed to Phase 12 without running
  the remaining live lease-recovery and publishing-priority scenarios. Those
  unchecked items are intentionally retained and must not be represented as
  passed during rollout.
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
- [x] Remove obsolete queue-read paths.
- [x] Remove temporary debug logging.
- [x] Update related feature documentation.
- [ ] Mark this progress file complete.

### Review Notes

```text
Status: IN PROGRESS — repository rollout preparation complete; not deployed

Rollout date:

- Not deployed. Moving to this phase did not authorize a production deployment
  or enable automatic analytics in the production extension.

Initial limits:

- Pending wake: 10 minutes; analytics wake: 15 minutes; deterministic startup
  jitter: 0–2 minutes; maximum batch: 3 per work type; execution budget: 45
  seconds; maintenance lease: 5 minutes.
- Production `AUTOMATIC_ANALYTICS_ENABLED` remains `false`. A production build
  was verified to emit the disabled value, then the local development artifact
  was restored with analytics enabled for continued local testing.

Monitoring result:

- Structured API events and per-profile extension counters are available, but
  no production observation has occurred. `rollout.md` defines required
  signals, halt conditions, deployment order, and rollback.

Cleanup:

- Removed the unused webpage event bridge and extension runtime messages for
  direct current-profile pending/engagement refresh. Dashboard maintenance now
  has one path: durable web API request followed by an ownership-scoped claim
  from the correct extension.
- Removed the obsolete engagement queue `postId` filter that existed only for
  the deleted direct bridge. Specific dashboard work continues through the
  authoritative maintenance request/claim path.
- Removed the unused bulk pending-refresh component.
- Audited maintenance logging. Structured operational diagnostics were kept;
  no claim tokens, cookies, DOM trees, or post content are logged.
- Added `rollout.md` and linked it from the feature specification.
- After cleanup, the focused API suites pass 47/47 tests and API, web,
  development extension, and production extension builds pass.
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
| 7. Pending-approval scheduler | Implemented | Pending manual two-profile validation |
| 8. Engagement analytics scheduler | Complete | Complete |
| 9. Diagnostics and operational safety | Complete | Complete |
| 10. Automated verification | Complete | Complete |
| 11. Live multi-profile validation | Deferred by user | Partial |
| 12. Rollout and cleanup | In progress | Repository preparation complete |

---

## Current Status

```text
Status: Phase 12 repository rollout preparation is complete. Production has
not been changed, deployed, or monitored. Automatic analytics remains disabled
in the production extension environment.
Current phase: Phase 12 rollout and cleanup. The user chose to defer the
remaining Phase 11 live lease-recovery, inverse-pending, simultaneous-wake, and
publishing-priority checks; their review gate remains partial.
Next action: Obtain explicit production rollout approval, run the ownership
migration report, then deploy in the staged order documented in `rollout.md`.
Do not enable production automatic analytics until the pending-only observation
is reviewed and separately approved.
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
