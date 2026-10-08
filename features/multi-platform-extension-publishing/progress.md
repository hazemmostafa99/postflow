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

- [x] Add narrowly scoped Instagram manifest permissions for both root and
      `www` hosts.
- [x] Add an independent Instagram content-script bundle.
- [x] Detect whether an Instagram session exists.
- [x] Detect the strongest reliable Instagram account identity available to
      the sanitized DOM detector.
- [x] Report expected and detected identity separately for bound connections.
- [x] Auto-create a first-time Instagram connection from a verified session;
      keep existing-account recovery explicit and fail closed.
- [x] Keep an explicit Instagram connection-creation API and owned-installation
      listing as a manual/recovery fallback.
- [x] Add authenticated web proxy routes for installations and platform
      connection creation.
- [ ] Add Instagram connection/reconnection backend flows.
- [x] Add Instagram connection state to the extension popup.
- [x] Add Instagram connection state to the web dashboard.
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
Status: IN PROGRESS - automatic first-time connection binding

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
- apps/web/src/app/api/extensions/installations/route.ts
- apps/web/src/app/api/extensions/platform-connections/route.ts
- apps/web/src/app/(dashboard)/connections/platform-connections-panel.tsx
- apps/web/src/app/(dashboard)/connections/page.tsx
- apps/extension/src/platforms/instagram/popup.ts
- apps/extension/src/popup/popup.html
- apps/extension/src/popup/popup.ts

Implementation:
- Added a narrowly scoped Instagram host permission and independent content
  script pair. The identity detector prefers canonical/Open Graph/profile-link
  evidence and falls back to a normalized profile pathname.
- Added a small worker bridge that accepts only messages from Instagram tabs
  and reports session state to the credential-authenticated API endpoint.
- Added `POST /api/extensions/platform-session`. A first-time Instagram
  identity now creates an installation-owned generic connection automatically;
  repeated reports update that connection, keep expected/detected identities
  separate, and mark logout or mismatch without automatic rebinding.
- Kept dashboard-authenticated `GET /api/extensions/installations` and
  `POST /api/extensions/platform-connections` as a manual/recovery fallback.
  The normal first-time flow no longer requires a display name or username
  form; the backend derives `Instagram @username` from the detected session.
- Added authenticated Next.js proxy routes for those dashboard calls; no
  publishing selector is enabled yet.
- Added an independent dashboard panel that polls and displays automatically
  detected Instagram connections. The existing Facebook connections dashboard
  was not refactored.
- Added a small Instagram status card to the extension popup. It reads only
  redacted session/status state persisted by the Instagram worker bridge and
  does not add publishing controls.
- Added Instagram diagnostics at content-script load, identity detection,
  worker message receipt/API response, and backend session handling so a
  missing session report is distinguishable from a rejected connection.
- Made the Facebook network-spy asset path layout-aware so both the project
  root and the self-contained `apps/extension/dist` folder can be loaded as
  an unpacked extension without requesting `dist/dist/graphql-spy.js`.
- Instagram publishing remains disabled; no Instagram job creation or DOM
  composer automation was enabled.

Tests/checks:
- API build passes.
- Extension development build passes.
- Web production build passes.
- Focused API regression tests pass: six suites, 119 tests.
- Five sanitized identity fixture tests pass when run directly; the managed
  multi-file Node test runner still reports `spawn EPERM`, and live account
  validation is no longer pending for the Instagram session bridge: a real
  logged-in Instagram tab reported a normalized username and the API returned
  `CONNECTED` / `IDLE` with an automatically created connection.

Known limitations / next work:
- Existing-account reconnect/restore still needs a dedicated explicit action;
  automatic first-time setup intentionally stops if the same username already
  belongs to another active installation. The manual creation endpoint remains
  available as a controlled fallback.
- Add sanitized session fixture coverage for automatic creation and recovery
  blocking, then complete live validation before enabling Instagram publishing.
```

---

# Phase 4 - Instagram Feed and Reel MVP

Status: `IN PROGRESS - QUEUE AND COMPOSER FOUNDATION`

## Checklist

- [x] Add Instagram Feed/Reel destinations to the create-post form; keep
      selection disabled until the publishing flag/live review is approved.
- [x] Validate target type against the Instagram platform connection.
- [x] Validate one Feed image or one Reel video before job creation.
- [x] Create Instagram jobs through the existing shared queue contract; UI
      destination controls remain gated until the adapter review is complete.
- [x] Implement allowlisted Instagram navigation and readiness checks.
- [x] Implement initial Instagram Feed/Reel composer detection.
- [x] Attach one expected media file and insert a caption through isolated DOM
      code; live selector verification is still pending.
- [x] Click only a visible, enabled Share control.
- [x] Re-check account identity and cancellation immediately before Share.
- [ ] Verify media preview and caption without duplication in live variants.
- [ ] Enable the Instagram feature flag after live review.
- [x] Detect published, failed, interrupted, and unknown outcomes.
- [x] Normalize and store reliable Instagram post/Reel URLs.
- [x] Treat accepted/unknown outcomes as terminal after the composer response;
      crash-window recovery still requires live validation.
- [x] Add sanitized DOM fixtures for Instagram selectors/composer flow and
      final pre-Share cancellation coverage.
- [x] Run the API and extension builds plus focused target/payload tests.
- [x] Polish Instagram connection and destination UI with explicit loading,
      verified, waiting, mismatch, and sign-in-required states.
- [x] Add manual refresh, last-seen feedback, setup steps, and accessible
      disabled-state explanations to the Instagram surfaces.
- [ ] Run the full API/web/extension validation suite.
- [ ] Complete recorded live validation with dedicated Instagram accounts.

## Review Gate

Instagram must be stable through the supported live UI variants and must show
no Facebook regressions before shared media work and TikTok implementation
begin.

## Review Notes

```text
Status: IN PROGRESS - foundation implemented; publishing remains feature-flagged

Implementation added:
- API target normalization and ownership/identity/media validation for
  `INSTAGRAM_FEED` and `INSTAGRAM_REEL`.
- Username-only Instagram identity support in claimed job payloads.
- `platforms/instagram/{selectors,composer,adapter,index}.ts` with allowlisted
  navigation, storage-backed account verification, isolated media/caption/Share
  flow, and safe `UNKNOWN` result semantics after Share.
- Instagram adapter registration while the Instagram publishing flag remains
  disabled.
- Web create-post form now loads verified Instagram connections and renders
  Feed/Reel destination controls. They submit `platformConnectionId` when the
  public web flag is enabled, but remain visibly gated during validation.
- Instagram connection and destination surfaces now show a clear auto-connect
  setup flow, refresh control, verified/mismatch/login/waiting states, last
  seen activity, media requirements, and an explicit rollout explanation when
  publishing is disabled.
- The Instagram composer now asks the background worker for a final identity
  and job-status check immediately before Share; it fails closed for account
  changes, cancellation, stale jobs, disabled Share controls, or API-check
  failures. A confirmed cancellation is reported as `CANCELED` to the shared
  orchestrator instead of being converted into a generic failure. Generic job
  ownership/status updates now support Instagram platform connections while
  preserving the legacy Facebook path.
- Added `tests/instagram-composer.test.cjs` with sanitized Feed/Reel fixtures
  covering control discovery, media/caption insertion, pre-Share checks, and
  the no-click-on-cancel safety path. The direct fixture run passes all five
  tests, including the current sidebar `a[role="link"]` + nested `New post`
  SVG shape captured from the dedicated test account.
- Updated Instagram control discovery to support the current sidebar link
  structure and added background logs around composer command/response
  handoff.
- Instagram outcome handling now detects a visible share confirmation or a
  canonical `/p/`/`/reel/` URL, normalizes the permalink on the extension and
  API paths, and persists `PUBLISHED` versus terminal `UNKNOWN` without an
  automatic retry after the response is received.
- Development-only Instagram publishing flags were enabled for the dedicated
  test account on 2026-10-08. Production flags remain disabled until the live
  review gate is approved.

Checks:
- API build passes.
- Web production build passes after the Instagram UI/UX update.
- Focused target, payload, and posts-service tests pass: 31 tests.
- Extension development build passes.

Remaining before enabling jobs:
- Complete real browser validation for current Instagram Feed/Reel UI variants.
- Verify accepted/unknown behavior across extension restart and lease recovery.
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

Continue Phase 4 validation before enabling Instagram publishing:

- Add cancellation and account re-check immediately before Share.
- Add sanitized composer fixtures and orchestration tests.
- Validate current Instagram Feed/Reel selectors in a real browser session.
- Run the complete API/web/extension validation suite.
- Keep the public Instagram publishing flag disabled until the live review
  passes; Facebook remains unchanged during this gate.
