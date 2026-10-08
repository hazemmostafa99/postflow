# Multi-Platform Extension Publishing - Progress

## Goal

Refactor PostFlow into a platform-aware extension publishing system, preserve
the current Facebook behavior, deliver an Instagram Feed/Reel MVP, and then
reuse the same adapter architecture for a TikTok Video MVP.

Status: `PHASE 2 IN PROGRESS - PLATFORM QUEUE FOUNDATION ADDED`

## Source Documents

- `features/multi-platform-extension-publishing/feature.md`
- `features/profile-feed-publishing/feature.md`
- `features/multi-account-facebook-publishing/FEATURE.md`
- `features/extension-lifecycle-management/feature.md`

---

# Phase 0 - Feature Definition and Existing-System Review

## Checklist

- [x] Confirm extension-driven publishing is the selected approach for
      Instagram and TikTok.
- [x] Confirm the existing Post, PublishingJob, scheduling, leasing, and
      extension worker flow will remain the foundation.
- [x] Inspect the current publishing target and job schemas.
- [x] Inspect create-post target normalization and job creation.
- [x] Inspect job claiming and Facebook connection ownership.
- [x] Inspect background navigation and execution routing.
- [x] Inspect extension manifest platform permissions.
- [x] Inspect current media storage and delivery behavior.
- [x] Define the multi-platform target architecture and rollout phases.
- [x] Create the feature specification.

## Review Notes

```text
Status: COMPLETE - specification only
Review date: 2026-10-08

Current architecture:
- PostFlow already creates one PublishingJob per selected destination.
- Scheduling, flow ordering, leasing, cancellation, and parent Post status
  aggregation are reusable across platforms.
- PublishingTargetType currently supports GROUP and PROFILE_FEED only.
- PublishingJob ownership and indexes are based on facebookConnectionId.
- GET /api/jobs/next requires a verified Facebook connection and therefore
  cannot deliver Instagram or TikTok jobs safely in its current form.
- The background worker, tab management, readiness checks, and execution
  messages are explicitly Facebook-oriented.
- The manifest grants platform access and injects publishing content scripts
  only for facebook.com.
- Media is currently stored as Base64 data URLs and included in job payloads.
- Existing Facebook publishing, tracking, pending approval, engagement, and
  lifecycle behavior has substantial focused test coverage and must remain
  unchanged during the foundation refactor.

Decisions:
- Keep one shared PublishingJob queue and scheduling model.
- Add an explicit platform discriminator and generic platform connection.
- Preserve legacy Facebook fields during a compatibility migration.
- Route extension work through isolated Facebook, Instagram, and TikTok
  adapters.
- Process one job at a time per extension installation in the first release.
- Build Instagram before TikTok.
- Limit Instagram MVP to one Feed image or one Reel video.
- Limit TikTok MVP to one video.
- Add safer job-scoped Blob media delivery before TikTok rollout.
- Never automate CAPTCHA, checkpoints, verification, or security challenges.
- Never blindly retry an uncertain or accepted submission.

Files changed:
- features/multi-platform-extension-publishing/feature.md
- features/multi-platform-extension-publishing/progress.md

Tests/checks:
- Documentation files reviewed only.
- No application code changed.
- No build or automated test run was required.
```

## Review Gate

Feature scope and implementation order are defined. Phase 1 must preserve the
current Facebook database and queue contracts while introducing compatibility
fields and abstractions.

---

# Phase 1 - Platform-Aware Data and Connection Foundation

Status: `COMPLETE - MIGRATION APPLIED`

## Checklist

- [x] Add `PublishingPlatform` with Facebook, Instagram, and TikTok values.
- [x] Add a migration-safe `platform` field to PublishingJob.
- [x] Treat legacy jobs without a platform as Facebook jobs.
- [x] Add Instagram Feed, Instagram Reel, and TikTok Video target types.
- [x] Define and implement the generic platform-connection model.
- [x] Allow one installation to own independent connections per platform.
- [x] Store expected and detected platform identities separately.
- [x] Add platform-scoped connection health and worker status.
- [x] Add indexes for connection ownership and platform queue claims.
- [x] Preserve `facebookConnectionId` and existing Facebook job ownership
      during migration.
- [x] Add an idempotent migration/reporting strategy.
- [x] Add schema, validation, ownership, and legacy compatibility tests.
- [x] Run the API build and focused tests.

## Review Gate

Inspect migrated/legacy Facebook records and new connection invariants before
changing job delivery or extension execution.

## Review Notes

```text
Status: COMPLETE - migration applied successfully on 2026-10-08

Files changed:
- apps/api/src/schemas/publishing-platform.ts
- apps/api/src/schemas/publishing-target.ts
- apps/api/src/schemas/publishing-job.schema.ts
- apps/api/src/schemas/publishing-job.schema.spec.ts
- apps/api/src/schemas/platform-connection.schema.ts
- apps/api/src/schemas/platform-connection.schema.spec.ts
- apps/api/src/posts/publish-job-payload.ts
- apps/api/src/app.module.ts
- apps/api/scripts/migrate-publishing-platform.mjs
- apps/api/package.json
- features/multi-platform-extension-publishing/progress.md

Implementation:
- Added FACEBOOK, INSTAGRAM, and TIKTOK platform values. A missing platform
  resolves to FACEBOOK for legacy compatibility.
- Added INSTAGRAM_FEED, INSTAGRAM_REEL, and TIKTOK_VIDEO target values.
- Added target-to-platform validation. New Instagram/TikTok targets require a
  generic platform connection and reject Facebook ownership fields.
- Added PublishingJob.platform with a FACEBOOK default, optional
  platformConnectionId, provider correlation fields, and a generic queue
  index.
- Added PlatformConnection with expected/detected identities, platform-scoped
  health, active installation binding, archive metadata, and a compatibility
  pointer to the durable FacebookConnection.
- Enforced at most one non-archived connection per installation/platform and
  one generic compatibility record per legacy Facebook connection.
- Kept current job creation and claiming Facebook-only. Unsupported new target
  payloads fail closed until Phase 2 adapter-aware delivery exists.
- Added a report-only/apply migration that can create Facebook compatibility
  connections, backfill legacy job platforms, link generic ownership, and
  ensure indexes without changing legacy Facebook IDs.

Migration applied on 2026-10-08:
- 6 publishing jobs inspected; 1 required platform backfill (now FACEBOOK).
- 7 Facebook connections inspected; 1 active + 6 archived.
- 1 active PlatformConnection created with externalAccountId and activeExtensionInstallationId.
- 6 archived PlatformConnections created without externalAccountId to avoid unique index conflicts.
- 6 Facebook jobs updated with platform=FACEBOOK and platformConnectionId linked to active PlatformConnection.
- 0 unknown job platforms.
- 0 duplicate legacy Facebook mappings.
- 0 duplicate active installation/platform bindings.

Tests/checks:
- API build passes.
- 24 focused tests pass across 4 suites (publishing-platform, publishing-target, publishing-job, platform-connection, publish-job-payload).
- Focused ESLint passes for all changed TypeScript files.
- Migration script syntax check passes.
- Migration apply run passes against the configured database.
- git diff --check passes, with only Git's existing LF/CRLF conversion warnings.
- Full API suite: 219 tests pass and 1 unrelated existing phone-contact index expectation fails. No phone-contact files were changed by this phase.

Known limitations:
- Job claiming and extension routing still use the existing Facebook-only path by design; Phase 2 owns that change.
- Instagram and TikTok connection creation and publishing remain disabled.

```

---

# Phase 2 - Platform-Aware Queue and Extension Adapter Refactor

Status: `IN PROGRESS - FOUNDATION IMPLEMENTED`

## Checklist

- [x] Separate installation authentication from platform session health.
- [x] Make job claiming platform- and connection-aware.
- [x] Ensure a worker can claim only jobs owned by its installation's active
      platform connections.
- [x] Keep one active publishing execution per installation.
- [x] Add platform and target information to normalized job payloads.
- [x] Introduce the shared `PlatformPublisherAdapter` contract.
- [x] Wrap existing Facebook behavior behind the Facebook adapter.
- [ ] Move only orchestration concerns into the shared background worker.
- [ ] Keep Facebook selectors, navigation, and tracking inside Facebook code.
- [x] Add platform URL allowlisting.
- [x] Make queue pauses and interruption states platform-scoped.
- [x] Add feature flags for Facebook, Instagram, and TikTok execution.
- [x] Define a strict extension folder, dependency, reuse, and size contract.
- [ ] Split the flat extension entrypoints into the target folder structure
      incrementally without creating a second worker. (Deferred until after
      the Facebook regression gate.)
- [ ] Extract shared Chrome/API/job/media/diagnostic helpers and remove
      background-to-orchestrator circular imports. (Deferred cleanup; new
      platform code must still use the target boundaries.)
- [ ] Enforce module/function size budgets and public `index.ts` boundaries.
- [ ] Add adapter routing, claim isolation, cancellation, and stale-message
      tests.
- [ ] Run the complete extension test suite.
- [x] Run the API build and focused queue tests.

## Review Gate

Facebook Group and Profile Feed publishing must pass automated regression
checks and recorded manual baseline validation before Instagram job creation
is enabled.

## Review Notes

```text
Status: IN PROGRESS - platform-aware queue and adapter foundation implemented

Files changed:
- apps/api/src/extensions/extensions.controller.ts
- apps/api/src/extensions/extensions.service.ts
- apps/api/src/posts/jobs.controller.ts
- apps/api/src/posts/jobs.controller.spec.ts
- apps/api/src/posts/posts.module.ts
- apps/api/src/posts/publish-job-payload.ts
- apps/api/src/posts/publish-job-payload.spec.ts
- apps/api/src/schemas/platform-connection.schema.ts
- apps/extension/scripts/copy-static.mjs
- apps/extension/src/env.d.ts
- apps/extension/src/job-orchestrator.ts
- apps/extension/src/platform-adapter.ts
- apps/extension/src/platforms/registry.ts
- apps/extension/src/platforms/facebook/facebook-adapter.ts
- apps/extension/src/posting-config.ts
- apps/extension/src/background.ts

Implementation:
- Added platform-aware worker claim path. The API now authenticates the
  installation separately from platform health, then claims jobs through the
  installation's active PlatformConnection records.
- Fixed the generic claim query so platform-connection ownership is composed
  inside `$and` and cannot be overwritten by the status lease `$or`.
- Kept legacy Facebook fallback for installations still resolving through the
  existing FacebookConnection path.
- Added platform to publish job payloads and retained Facebook-compatible
  GROUP/PROFILE_FEED payload shapes.
- Added a PlatformPublisherAdapter contract plus adapter registry.
- Added a Facebook adapter wrapper that routes work to the existing Facebook
  content script instead of moving selectors or DOM automation into shared code.
- Added shared extension orchestration skeleton with platform URL allowlisting,
  per-platform queue pauses, one-job-at-a-time execution, and platform feature
  flags.
- Added extension build-time feature flags with safe defaults:
  FACEBOOK enabled unless explicitly false; INSTAGRAM/TIKTOK disabled unless
  explicitly true.
- Added platform status reporting endpoint for platform-scoped worker state.
- Added a strict extension code-organization contract to the feature
  specification: target folders, dependency direction, reusable-helper rules,
  module/function size budgets, no-circular-import policy, and migration
  requirements. Existing Facebook files are explicitly a legacy zone for now;
  all new Instagram/TikTok code must use the target structure. No bulk move
  was performed.

Tests/checks:
- API build passes.
- Extension development build passes.
- Focused API tests pass: six suites, 113 tests, including platform claim
  isolation and legacy Facebook compatibility.
- The extension test command is currently blocked by the managed Windows
  runner: all 14 files fail before execution with Node `spawn EPERM`; this is
  an environment/test-runner limitation, not an assertion failure.

Known limitations / next work:
- Facebook adapter currently preserves the existing content-script execution
  path and waits for terminal JOB_SUCCESS/JOB_FAILED/JOB_CANCELED messages
  from the active tab before the shared orchestrator persists the final result.
- Need focused tests for adapter routing, cancellation, stale messages, and
  platform-status reporting.
- The current extension still has flat legacy entrypoints (`background.ts`,
  `content.ts`, and several root-level Facebook modules). Their cleanup is
  deferred until after the Facebook regression gate; do not add new
  Instagram/TikTok logic to those legacy files. The only temporary bridge is
  the one-line Instagram worker registration hook in `background.ts`; its
  validation and API behavior live in `platforms/instagram/worker.ts`.
- The target structure is a contract, not a reason to create empty files or
  duplicate the Facebook worker. Each move must preserve the old public import
  until build/test coverage proves the new path is safe.
- Need a Facebook automated regression run and manual baseline validation
  before enabling Instagram connection or job creation.
```

---

# Phase 3 - Instagram Connection and Session Detection

Status: `IN PROGRESS - SESSION DETECTION FOUNDATION`

## Checklist

- [x] Add narrowly scoped Instagram manifest permission.
- [x] Add an independent Instagram content-script bundle.
- [x] Detect whether an Instagram session exists.
- [x] Detect the strongest reliable Instagram account identity available to
      the sanitized DOM detector.
- [x] Report expected and detected identity separately for bound connections.
- [ ] Add Instagram connection/reconnection backend flows.
- [ ] Add Instagram connection state to the extension popup.
- [ ] Add Instagram connection state to the web dashboard.
- [x] Block Instagram claims for logout, mismatch, pause, or archive states
      when a generic Instagram connection exists.
- [ ] Confirm an Instagram interruption does not block Facebook jobs.
- [ ] Add sanitized session and identity fixture tests.
- [x] Keep Instagram publishing execution disabled by feature flag.

## Review Gate

Validate login, logout, account switching, username changes, Arabic UI, and
English UI with dedicated test accounts before enabling Instagram publishing.

## Review Notes

```text
Status: IN PROGRESS - session reporting only; no connection binding

Files changed:
- apps/api/src/extensions/extensions.controller.ts
- apps/api/src/extensions/extensions.service.ts
- apps/api/src/extensions/extensions.controller.spec.ts
- apps/api/src/extensions/extensions.service.spec.ts
- apps/extension/manifest.json
- apps/extension/src/background.ts
- apps/extension/src/types.d.ts
- apps/extension/src/platforms/instagram/identity.ts
- apps/extension/src/platforms/instagram/content.ts
- apps/extension/src/platforms/instagram/worker.ts

Implementation:
- Added a narrowly scoped Instagram host permission and independent content
  script pair. The identity detector prefers canonical/Open Graph/profile-link
  evidence and falls back to a normalized profile pathname.
- Added a small worker bridge that accepts only messages from Instagram tabs
  and reports session state to the credential-authenticated API endpoint.
- Added `POST /api/extensions/platform-session`. It updates only an existing,
  installation-owned generic connection, keeps expected/detected identities
  separate, and marks logout or mismatch without automatic rebinding.
- Instagram publishing remains disabled; no Instagram job creation or DOM
  composer automation was enabled.

Tests/checks:
- API build passes.
- Extension development build passes.
- Extension/API controller and service tests pass: 61 tests.
- Four sanitized identity fixture tests pass when run directly; the managed
  multi-file Node test runner still reports `spawn EPERM`, and live account
  validation is pending.

Known limitations / next work:
- A dashboard/reconnect flow must explicitly create or bind an Instagram
  `PlatformConnection`; session reports intentionally return no connection for
  an unbound installation.
- Add popup/dashboard connection state and sanitized identity fixtures before
  enabling Instagram publishing.
```

---

# Phase 4 - Instagram Feed and Reel MVP

Status: `NOT STARTED`

## Checklist

- [ ] Add Instagram destinations to the create-post form.
- [ ] Validate target type against connection platform.
- [ ] Validate one Feed image or one Reel video before job creation.
- [ ] Create and schedule Instagram jobs through the shared queue.
- [ ] Implement allowlisted Instagram navigation and readiness checks.
- [ ] Implement Instagram Feed composer detection.
- [ ] Implement Instagram Reel composer detection.
- [ ] Attach the expected media and verify its preview.
- [ ] Insert and verify the caption without duplication.
- [ ] Re-check account identity and cancellation before Share.
- [ ] Click only a verified, enabled Share control.
- [ ] Detect published, failed, interrupted, and unknown outcomes.
- [ ] Normalize and store reliable Instagram post/Reel URLs.
- [ ] Prevent automatic retry after an accepted or uncertain result.
- [ ] Add sanitized DOM fixture and orchestration tests.
- [ ] Run the API, web, and extension builds/tests.
- [ ] Complete recorded live validation with dedicated Instagram accounts.

## Review Gate

Instagram must be stable through the supported live UI variants and must show
no Facebook regressions before shared media work and TikTok implementation
begin.

## Review Notes

```text
Status: NOT STARTED

No implementation files changed yet.
```

---

# Phase 5 - Job-Scoped Media Delivery

Status: `NOT STARTED`

## Checklist

- [ ] Define authenticated, job-scoped media delivery.
- [ ] Authorize media access against the claiming installation and job.
- [ ] Add short-lived, non-reusable media references or tokens.
- [ ] Fetch media as a Blob without exposing PostFlow credentials to the page.
- [ ] Convert the Blob to the expected `File` inside the isolated content
      script context.
- [ ] Avoid repeatedly copying large Base64 videos through Chrome messages.
- [ ] Enforce expiry, cancellation, size, and MIME validation.
- [ ] Ensure logs never contain media bytes or access tokens.
- [ ] Preserve current Facebook media behavior during migration.
- [ ] Add authorization, expiry, cancellation, and large-media tests.
- [ ] Run API and extension memory/stability checks.

## Review Gate

The media path must be verified with the maximum supported TikTok MVP video
before TikTok publishing is enabled.

## Review Notes

```text
Status: NOT STARTED

No implementation files changed yet.
```

---

# Phase 6 - TikTok Connection and Video MVP

Status: `NOT STARTED`

## Checklist

- [ ] Add narrowly scoped TikTok manifest permission.
- [ ] Add an independent TikTok content-script bundle.
- [ ] Implement TikTok session and account identity detection.
- [ ] Add TikTok connection state to popup and dashboard.
- [ ] Add TikTok Video to the create-post form.
- [ ] Validate one supported video before job creation.
- [ ] Create and schedule TikTok jobs through the shared queue.
- [ ] Implement allowlisted upload navigation and readiness checks.
- [ ] Fetch and attach video through job-scoped media delivery.
- [ ] Detect upload progress and preparation completion.
- [ ] Insert and verify the caption without duplication.
- [ ] Preserve privacy and advanced controls PostFlow does not manage.
- [ ] Re-check account identity and cancellation before Post.
- [ ] Click only a verified, enabled Post control.
- [ ] Distinguish uploading, processing, published, failed, and unknown states.
- [ ] Normalize and store reliable TikTok post URLs.
- [ ] Prevent automatic retry after accepted, processing, or uncertain results.
- [ ] Confirm TikTok failures do not block Facebook or Instagram jobs.
- [ ] Add sanitized DOM fixture and orchestration tests.
- [ ] Run the API, web, and extension builds/tests.
- [ ] Complete recorded live validation with dedicated TikTok accounts.

## Review Gate

Verify account switching, logout, processing timeout, challenge, cancellation,
service-worker restart, and duplicate prevention before controlled rollout.

## Review Notes

```text
Status: NOT STARTED

No implementation files changed yet.
```

---

# Phase 7 - Controlled Rollout and Hardening

Status: `NOT STARTED`

## Checklist

- [ ] Enable Instagram and TikTok independently for internal connections.
- [ ] Record publish success, failure, interruption, and unknown-result rates.
- [ ] Verify platform-specific kill switches stop only new claims/creation.
- [ ] Preserve terminal reporting for already-submitted jobs during rollback.
- [ ] Verify rollback never converts uncertain work into retryable work.
- [ ] Add operational diagnostics for unsupported platform UI variants.
- [ ] Document selector maintenance and platform outage procedures.
- [ ] Complete final Facebook regression validation.
- [ ] Complete final Instagram live validation.
- [ ] Complete final TikTok live validation.
- [ ] Record known limitations and deferred targets.

## Review Gate

General availability requires explicit approval after reviewing live validation
evidence and duplicate-prevention behavior for all three platforms.

## Review Notes

```text
Status: NOT STARTED

No implementation files changed yet.
```

---

## Current Next Action

Continue with Phase 3 using only new structured Instagram modules:

- Add the generic Instagram session/identity reporting contract.
- Add `platforms/instagram/identity.ts` and its independent content script.
- Keep Instagram job creation disabled until session detection and connection
  ownership are validated.
- Return to the legacy Facebook folder split only after the Facebook
  regression gate is approved.
- Add adapter routing, cancellation, stale-message, and platform-status tests.
- Run Facebook automated regression checks and record the manual baseline.
- Resolve the extension test-runner `spawn EPERM` environment limitation.
- Keep Instagram/TikTok adapters and job creation disabled until that gate is
  approved.
