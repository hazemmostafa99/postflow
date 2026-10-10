# Multi-Platform Extension Publishing - Progress

## Goal

Refactor PostFlow into a platform-aware extension publishing system, preserve
the current Facebook behavior, deliver an Instagram Feed/Reel MVP, and then
reuse the same adapter architecture for a TikTok Video MVP.

Status: `PHASE 6 IN PROGRESS - CONTROLLED TIKTOK TEST PUBLISHING ENABLED`

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
- [x] Add an isolated Instagram post-detail engagement extractor for likes and
      comments, including explicit `No comments yet` zero evidence.
- [x] Add an Instagram engagement message and background-tab worker path.
- [x] Make the engagement claim queue and result endpoint accept verified
      Instagram platform connections without changing the Facebook path.
- [ ] Validate Instagram analytics against live likes/comments and challenge
      or login variants.
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
  the no-click-on-cancel safety path. The direct fixture run passes all six
  tests, including the current sidebar `a[role="link"]` + nested `New post`
  SVG shape captured from the dedicated test account.
- Updated Instagram control discovery to support the current sidebar link
  structure and added background logs around composer command/response
  handoff.
- Dedicated-account DOM captures confirmed the current composer sequence:
  `Create new post` dialog, native file input, `Next`/Edit step, then a
  `role="button"` Share control and Lexical caption textbox. Added stage logs
  and API error details to identify any remaining pre-Share failure without
  clicking blindly.
- Instagram outcome handling now detects a visible share confirmation or a
  canonical `/p/`/`/reel/` URL, normalizes the permalink on the extension and
  API paths, and persists `PUBLISHED` versus terminal `UNKNOWN` without an
  automatic retry after the response is received.
- A dedicated-account run confirmed Instagram rendered `aria-label="Post
  shared"` with `Your post has been shared.` after the Share click. The
  detector now checks success dialog labels/text (not only body text), waits
  up to 15 seconds for slower uploads, and dismisses the modal's `Done`
  control after confirmation so a successful publish is reported as
  `PUBLISHED` instead of being misclassified as `UNKNOWN`.
- Instagram's success modal does not include a permalink and the tab remains
  on the profile URL. The composer now snapshots existing `/p/` and `/reel/`
  links before Share, waits for the newly rendered profile tile after the
  confirmation, and returns the new canonical permalink as `postUrl` when it
  is available. Focused fixtures verify both URL discovery and the no-URL
  success fallback.
- Added adapter recovery for Chrome's "message channel closed" error during
  Instagram SPA navigation. The adapter now recovers a canonical tab URL as
  `PUBLISHED`, or records terminal `UNKNOWN` without automatic retry when the
  publish state cannot be proven, preventing duplicate posts after a context
  reload.
- The adapter now independently probes the Instagram tab DOM with the
  extension `scripting` permission before sending the composer command and
  compares `/p/`/`/reel/` links after a response or channel closure. This
  catches a newly rendered profile tile even when Instagram returns to the
  profile URL and destroys the content-script message port.
- The adapter also observes `chrome.tabs.onUpdated` for canonical Instagram
  permalink transitions during the job. A transient `/p/...` or `/reel/...`
  navigation is treated as strong publish evidence and preserved even if the
  page later returns to the profile URL.
- The composer no longer clicks the success modal's `Done` control before
  returning its async response; closing that modal can reload Instagram and
  destroy the content-script message port. The modal remains visible until
  the publishing response and permalink probes finish.
- The independent permalink probe now scans both anchors and serialized page
  markup for `/p/...` and `/reel/...` references, not only `a[href]` nodes.
- Dedicated-account profile captures showed Instagram uses username-prefixed
  tile paths such as `/ema.d1852/p/<shortcode>/` and
  `/ema.d1852/reel/<shortcode>/`. Extension and API normalizers now accept
  both prefixed and canonical paths, so before/after snapshots can identify
  the newly inserted first tile and persist a canonical `https://www.instagram.com/p/.../`
  or `/reel/.../` URL.
- If the new tile is not rendered immediately, the adapter performs one
  controlled profile refresh after publish confirmation, then repeats the
  before/after comparison. It never opens the first tile blindly, avoiding a
  false permalink from an older post.
- Baseline collection now waits briefly for the Instagram profile grid to
  render before sending Create/Share. This prevents a valid loaded tab with
  an asynchronously empty DOM from producing a false `baselineCount: 0`.
- Dedicated-account validation confirmed the full recovery path: after
  `PUBLISHED`, the first probe found no new tile, one controlled profile
  refresh exposed the new profile-prefixed link, and the API-bound canonical
  permalink was recovered as `https://www.instagram.com/p/DeOaDcwHEsk/`.
  The expected first-probe miss is now informational; only failure after the
  refresh is logged as a warning.
- Development-only Instagram publishing flags were enabled for the dedicated
  test account on 2026-10-08. Production flags remain disabled until the live
  review gate is approved.
- The post-details page now reads the job `platform`/target type and labels
  Instagram jobs as `Instagram - Feed` or `Instagram - Reel` instead of the
  legacy `Facebook group` fallback. Engagement refresh controls now appear for
  supported Facebook and Instagram permalinks, while TikTok remains disabled;
  Instagram URLs no longer go through the Facebook-only analytics endpoint.
  Stale sync errors are scoped to supported analytics rows and an unsynced
  Instagram row shows `Instagram analytics pending`.
- The supplied Instagram post-detail DOM confirms the post permalink and
  `No comments yet.` state, so comment zero can be extracted safely. It does
  not expose a numeric Like count in this capture; the extractor keeps likes
  unknown until a numeric Instagram Like count becomes visible.
- Follow-up dedicated-account captures showed two supported layouts: a
  full-page post with controls but no numeric Like count, and a details view
  with standalone numeric spans (`Unlike 1`, `Comment 1`). The extractor now
  matches the target permalink without relying on CSS visibility, chooses the
  containing post scope instead of stopping at the toolbar, and returns
  `SUCCESS` with `reactionCount: 0` and `commentCount: 0` for the first layout
  or `SUCCESS` with both counters for the second. This follows the product
  policy that a rendered Like/Unlike control with no numeric Like counter is
  treated as zero likes.
- Explicit Instagram copy such as `Be the first to like this` is now treated
  as verified `reactionCount: 0` as well. A missing post scope still fails
  separately instead of being converted to zero.
- Added `platforms/instagram/engagement.ts`, which scopes extraction to the
  target `/p/` or `/reel/` permalink and returns `SUCCESS`, `PARTIAL`, or
  `CHECK_FAILED` without guessing a missing Like count.
- Extended Instagram analytics readiness for slow post-detail pages: the
  content extractor now waits up to 45 seconds for the post scope/counters,
  while the background tab waits up to 60 seconds for navigation and the
  engagement message. Both paths emit progress/timeout diagnostics instead of
  using the shorter Facebook tab timeout.
- Added `CHECK_INSTAGRAM_POST_ENGAGEMENT` handling, background-tab navigation,
  platform-aware engagement claims, and Instagram result persistence. The
  queue now routes Instagram jobs to the Instagram extractor while retaining
  the existing Facebook extractor and ownership checks.
- Refactored Instagram permalink probing into `platforms/instagram/permalink.ts`
  so the adapter remains a thin publish coordinator. Removed the unused
  success-notice export from `result.ts`; all Instagram modules remain under
  the platform boundary and stay below the 300-line module budget.
- Updated the Instagram composer for the current Reel flow: it supports the
  extra `Next` transition from Edit to New reel and now targets the labelled
  Lexical `Add a caption...` textbox. The initial native insertion/DOM fallback
  was later replaced by the transaction-based caption fix below after reports
  of captions appearing in the editor but missing from published posts.
- Caption verification now normalizes zero-width characters, non-breaking
  spaces, and Lexical whitespace. Retry diagnostics now report lengths and
  verification flags only, without logging caption contents.
- Expanded publish-confirmation detection for the Reel-specific success modal:
  both `Shared reel` and `Your reel has been shared.` are now accepted, in
  addition to the existing post variants. The dedicated composer fixture now
  covers this exact confirmation shape.
- Replaced the short 15-second post-Share window with terminal-signal polling:
  Feed waits up to 45 seconds and Reels up to 90 seconds for a success dialog
  or canonical permalink, with periodic progress logs and a safety timeout.
  This prevents slower video processing from being reported as `UNKNOWN` before
  Instagram displays `Your reel has been shared.`.
- Made Instagram caption insertion idempotent and changed verification to an
  exact normalized match. A caption already present in the Lexical editor is
  now left untouched, while duplicated text cannot pass verification silently.
  Added a direct fixture that inserts the same caption twice and confirms it is
  stored only once. The composer also performs a short post-input settle check
  and replaces the field once if Instagram's controlled editor adds a duplicate
  during its own input update.
- Removed the synthetic caption payload from the native `execCommand` path.
  Lexical already emits its own input event; sending another event with
  `data: caption` was causing Instagram to append the same text a second time
  and then fail exact verification. The DOM fallback introduced at this stage
  has since been removed: a synthetic event after direct DOM mutation is not
  sufficient evidence that the editor committed the caption.
- Added an immediate dashboard-to-extension analytics trigger. After the web
  app queues an engagement refresh, the injected bridge asks the extension to
  claim it immediately; the one-minute manual alarm remains as a fallback. The
  Instagram page/counter readiness waits are unchanged, so this removes queue
  latency without weakening extraction accuracy.
- Fixed the Facebook content-script bootstrap after feature flags introduced an
  ES-module import into `posting-config.js`. Timing configuration now lives in
  the import-free `posting-timing.js` content script, while the module-only
  platform flags remain available to the background worker.
- Extracted caption reading/insertion into `platforms/instagram/caption.ts`
  and added payload-length diagnostics at the adapter/content boundary. The
  composer accepts the canonical `content` field plus safe `caption`/`text`
  fallbacks, making an omitted caption distinguishable from an editor failure
  without logging the caption itself.
- Replaced the post-upload fixed delay with stage-aware composer readiness: the
  flow now waits for Next or the final caption/Share state and supports up to
  three transitions, covering the delayed Create new post -> Crop -> Edit ->
  New reel sequence captured from the dedicated account.
- Fixed Instagram analytics persistence when an installation has multiple
  active/recreated connections for the same platform. Maintenance ownership now
  verifies the exact `platformConnectionId` stored on the job (including the
  owning installation, platform, archive state, session, and identity) instead
  of resolving an arbitrary active connection by platform. Facebook's legacy
  connection path remains unchanged. Platform claim discovery now applies the
  same `clerkUserId` ownership constraint, preventing a claim that could never
  be persisted by the authenticated user.
- Preserved legacy Facebook publishing and engagement claims when the same
  installation also has an Instagram platform connection. The worker now
  resolves the verified Facebook connection independently instead of assuming
  every Facebook job has a `PlatformConnection` record.
- Kept Facebook `activeExecution` alive until both the adapter and legacy
  result listener can observe the terminal publish message. This removes a
  harmless but misleading `JOB_SUCCESS ... no active execution` race and keeps
  post-publish reconciliation available for jobs that still need it.
- Fixed automatic Facebook post-link reconciliation to persist through the
  publishing job-status endpoint. The scheduled `/pending-sync` endpoint still
  requires a maintenance claim token; immediate post-publish checks now use
  the publishing worker's existing ownership instead of producing `401
  Maintenance claim required`.
- Added a safe Facebook profile-video permalink fallback. The worker snapshots
  visible profile video URLs before upload, then polls a hidden profile-feed tab
  after Facebook accepts the video and compares canonical URLs before/after.
  The existing processed-video notification watcher remains a fallback, and
  neither path reloads or takes control of the composer tab. The accepted
  confirmation surface now hands off to this reconciler after a short grace
  period so a slow Facebook video does not block the publishing queue for the
  full permalink timeout. The platform orchestrator also waits on a
  profile-video completion gate, so scheduled work cannot overlap the hidden
  profile/notification reconciliation.
- Hardened the profile-video comparison against stale composer DOM: the
  background baseline is passed into the content script, old URLs are merged
  into the rejection set, and video DOM links are ignored when no trustworthy
  baseline exists. Baseline capture now waits for actual profile feed cards (or
  an explicit empty-profile state) instead of treating an unhydrated page as
  an empty feed.
- Stabilized Instagram caption entry across Lexical editor re-renders. Caption
  insertion now re-finds the live editor, requires consecutive exact reads,
  repairs a field that changes before Share, and avoids rebuilding the editor's
  child tree. Added a fixture for the editor-replacement race.
- Removed DOM-only caption success and direct contenteditable mutations.
  Contenteditable insertion now requires a browser editing transaction with
  an input event; controlled textareas use the native prototype value setter
  before dispatching input, bypassing React's instance value tracker. The
  composer requires consecutive matching reads after blur and checks the live
  field again after asynchronous pre-share checks, immediately before clicking
  Share. Unsupported insertion or a lost transaction stops submission. These
  checks cover editor state transitions, not server-side caption persistence;
  fresh Feed/Reel posts still need live validation.
- Unified the create-post Instagram destination UI (2026-10-09). Accounts are
  selected once using media-independent keys; one image automatically resolves
  to a Photo post/INSTAGRAM_FEED job and one video to a Reel/INSTAGRAM_REEL job.
  The inferred type is shown in the destination menu, selected chips, and
  schedule preview. Missing, unsupported, multiple, and mixed attachments block
  Instagram submission with an explanatory message. Replacing/removing media
  preserves the selected accounts. A reusable dashboard media/target resolver
  builds explicit API targets without changing persisted jobs, backend
  validation, platform ownership, or the shared extension composer.
- Added Arabic Feed/Reel publishing confirmation support (2026-10-09), including
  the supplied `تمت مشاركة المنشور` dialog label and `تمت مشاركة منشورك.`
  message. Reel completion phrases are supported too. Control/caption labels
  normalize Arabic diacritics, tatweel, and bidi markers; the caption selector
  recognizes Arabic descriptions among multiple editors. Completion remains
  independent of permalink discovery and does not click Done, preserving the
  response channel. Sharing progress, negative completion text, and Done alone
  do not establish publication. Arabic analytics localization is not part of
  this publishing change.
- Fixed stale upload-dialog lookup after the Arabic composer report. The
  supplied markup already contains a file input inside the multipart form;
  waiting on the initially captured dialog could miss it after a modal
  replacement. Media readiness now re-resolves the current dialog on every
  poll and accepts only a connected, enabled input. Dialog selection prefers
  the upload form over an outgoing modal. Diagnostics distinguish a missing
  input from failed media conversion/attachment without exposing media data.
- Fixed Reel Like/Comment counter cross-contamination after reproducing
  `Unlike1Comment` from the supplied SVG-title/button markup. Removed the
  flattened action-text counter parser and unbounded document-order scan;
  each action now reads its own wrapper (or immediate compact counter sibling)
  and stops before a shared toolbar. Prose fallback excludes SVG titles and
  requires whitespace before counter labels. The supplied one-Like/empty-
  Comment shape now returns 1/0 under the existing loaded-Reel zero policy.
- Added the centralized Instagram session evidence manager (2026-10-09).
  Unknown/loading pages now produce CHECKING rather than an inferred logout.
  English/Arabic own-profile evidence is supported; public profile metadata and
  post-author avatars no longer identify the viewer. Background challenges are
  bound to the sending Chrome document and current tab/navigation generation,
  with serialized API writes and persisted account/source/time provenance.
  Explicit logout/mismatch revokes previously observed documents so stale DOM
  cannot restore access. Verification expires after 60 seconds, refreshed by
  15-second observations and swept by one minute alarm across worker restarts.
  The backend stores evidence state/time/source, preserves connection health on
  CHECKING, and uses PENDING for STALE. Legacy Instagram false reports no longer
  become LOGIN_REQUIRED; Facebook/TikTok behavior is unchanged. Share requires
  two direct checks of its own document around the asynchronous job-status
  request, not another tab's cached identity. Dashboard/menu show expired proof,
  and Connections displays last verification time. No credentials or cookies
  are exposed to Instagram and no database migration/destructive writes were
  performed.

Checks:
- Session/identity tests pass directly: 21 tests covering Arabic sidebar,
  public-owner rejection, loading analytics, freshness expiry/restart, explicit
  logout/mismatch, stale-document revocation, iframe rejection, navigation
  during observation/API persistence, queued writes, and post-job-check identity
  loss. API Extensions controller/service suites pass: 72 tests. Existing
  Instagram composer/engagement suites pass: 28/13 tests. Web Instagram form and
  Connections suites pass: 10/10 tests. Extension, API, and web builds pass.
- Direct Instagram engagement fixtures pass: 13 tests, including nested buttons
  with SVG titles, one-Like/empty-Comment, empty-Like/nonzero-Comment,
  independent counters, compact title concatenation, abbreviated counters,
  and neighboring Reel isolation. Extension development build passes after
  the counter-isolation fix. Existing saved analytics require a fresh sync;
  no stored results were changed or live browser checks performed here.
- Unified Instagram dashboard verification: 10 new direct tests pass, including
  actual form callbacks for one selector, media replacement, submission guards,
  Facebook-only recovery, and scheduled destination order. The 10 existing
  Connections tests also pass directly. Web TypeScript and production build
  pass; targeted ESLint reports no errors (one existing image-element warning).
  The standard `npm test` subprocess runner is blocked by Windows `spawn EPERM`
  in this sandbox; both test files were run directly instead.
- API build passes.
- Focused API jobs-controller tests pass: 32 tests, including exact Instagram
  platform-connection ownership and legacy Facebook claims beside Instagram.
- Web production build passes after the Instagram UI/UX update.
- Focused target, payload, and posts-service tests pass: 31 tests.
- Direct Instagram composer fixture run passes: 28 tests, including Lexical
  caption selection, Reel caption insertion, duplicate-caption prevention,
  delayed Reel success confirmation, DOM-only false-success rejection,
  controlled textarea state updates, editor input consumption, and caption
  loss during asynchronous pre-share checks, Arabic control/caption selectors,
  delayed Arabic Feed/Reel confirmation, label-only and text-only success, and
  rejection of Arabic progress/failure text, upload-form modal selection,
  replaced upload dialogs for Feed and Reel, and distinct attachment failure.
  Development extension build passes after localization/upload-readiness
  changes; live Arabic platform validation is still pending.
- Direct Instagram engagement fixture run passes: 5 tests, including zero-like
  and zero-comment states plus nested post-scope counter extraction.
- Added Reel-viewer fixtures for the current DOM shape where the active video
  has Like/Comment controls but no permalink anchor. The extractor now scopes
  from the visible video instead of aggregating the whole virtualized `<main>`;
  it returns `0/0` for the empty toolbar and reads standalone counters when
  they are present. It now stops at the smallest active toolbar ancestor so
  neighboring Reel counters cannot be mixed into the result. The engagement
  fixture suite now passes 8 tests.
- Added support for Instagram's plural Reel permalink form
  `/reels/{shortcode}/`, observed in the dedicated account. API eligibility,
  job URL normalization, background navigation matching, permalink probing, and
  the Instagram extractor now canonicalize it to `/reel/{shortcode}/`, so these
  jobs can enter the engagement queue instead of being skipped.
- Added `tests/instagram-engagement.test.cjs` with numeric-counter and
  explicit-zero-comment fixtures. The managed Windows test runner currently
  fails before execution with `spawn EPERM`; the TypeScript extension build
  remains green.
- Extension development build passes.
- Extension development build passes after the profile-feed video permalink
  reconciliation update.
- Added profile video before/after candidate fixture coverage. The managed
  Windows Node test runner still fails before assertions with `spawn EPERM` in
  this environment.
- Instagram adapter/permalink refactor compiles with the development build.
- API engagement eligibility and jobs-controller tests pass: 51 tests.

Remaining before enabling jobs:
- Live-validate session management with English/Arabic, multiple analytics tabs,
  logout/account switching, and worker reload. Restart/update the API before
  reloading the extension, then refresh Instagram tabs to load the new evidence
  responder. Unsupported identity markup safely stays CHECKING; no live session
  or publishing was exercised during this implementation.
- Validate the unified Instagram account selector and automatic media labels
  interactively in the dashboard; no live platform post was created for this UI
  change.
- Complete real browser validation for current Instagram Feed/Reel UI variants.
- Confirm caption persistence on freshly published Feed images and Reels after
  reloading the extension and refreshing the Instagram tab.
- Verify accepted/unknown behavior across extension restart and lease recovery.
```

---

# Phase 5 - Job-Scoped Media Delivery

Status: `IN PROGRESS - AUTHENTICATED DELIVERY FOUNDATION IMPLEMENTED`

## Checklist

- [x] Define authenticated, job-scoped media delivery.
- [x] Authorize media access against the claiming installation and job.
- [x] Add short-lived, non-reusable media references or tokens.
- [x] Fetch media as a Blob without exposing PostFlow credentials to the page.
- [x] Convert the Blob to the expected `File` inside the isolated content
      script context.
- [x] Avoid repeatedly copying large Base64 videos through Chrome messages.
- [x] Enforce expiry, cancellation, size, and MIME validation.
- [x] Ensure logs never contain media bytes or access tokens.
- [x] Preserve current Facebook media behavior during migration.
- [x] Add authorization, expiry, cancellation, and large-media tests.
- [ ] Run API and extension memory/stability checks.

## Review Gate

The media path must be verified with the maximum supported TikTok MVP video
before TikTok publishing is enabled.

## Review Notes

```text
Status: IN PROGRESS - authenticated delivery foundation implemented

Files changed:
- apps/api/src/posts/job-media-delivery.ts
- apps/api/src/posts/job-media-delivery.spec.ts
- apps/api/src/posts/publish-job-payload.ts
- apps/api/src/posts/publish-job-payload.spec.ts
- apps/api/src/posts/jobs.controller.ts
- apps/api/src/posts/jobs.controller.spec.ts
- apps/api/src/posts/posts.service.ts
- apps/api/src/schemas/publishing-job.schema.ts
- apps/extension/src/shared/media/media-types.ts
- apps/extension/src/shared/media/media-runtime.ts
- apps/extension/src/shared/media/index.ts
- apps/extension/tests/job-media.test.cjs
- apps/extension/package.json
- features/multi-platform-extension-publishing/progress.md

Implementation:
- A platform-aware claim now creates a random short-lived media bearer token,
  stores only its SHA-256 hash, and binds its expiry to the existing job lease.
- TikTok job payloads replace Base64 media with metadata-only job-scoped
  references. Facebook and the current Instagram flow retain their existing
  payload shape during migration.
- Added `GET /api/jobs/:id/media/:index`. It serves only supported image/video
  data while the job is RUNNING, the lease is live, and the bearer token
  matches the hash stored on that exact job.
- Cancellation and terminal status handling revoke media access. Responses are
  non-cacheable, MIME checked, capped at 25 MiB, and never place the bearer
  token in the URL or server request log. Creation-time limits now use exact
  decoded byte counts rather than Base64 string-length approximations.
- Added a shared classic-script media runtime that fits the extension's
  unbundled content-script build. It fetches media with only the scoped bearer
  token, validates response type and size, bounds streamed bodies at 25 MiB
  (cancelling an oversized response), and creates the File in the isolated
  content-script context. Missing `Content-Length` is treated as unknown rather
  than as zero. No PostFlow installation credential is exposed to the platform
  page.

Tests/checks:
- API build passes.
- Extension development build passes.
- 72 focused API tests pass across job media, payload, queue/status,
  cancellation, and schema suites.
- Eight focused extension media-reference/runtime tests pass directly,
  including exact-25MiB streaming, cancellation, and Blob-only fallback
  fixtures.
- Full API suite: 254 tests pass and the same unrelated existing
  phone-contact index expectation fails; no phone-contact files were changed.
- The managed multi-file extension runner remains blocked before assertions by
  Node `spawn EPERM`; the new media test passes when run directly.
- `git diff --check` passes with only existing LF/CRLF warnings.
- The repository-wide API lint target remains noisy from existing formatting
  and type-lint debt in already modified files; the new standalone API media
  modules were formatted directly.

Known limitations / next work:
- The deterministic runtime boundary is covered at the maximum 25 MiB size; an
  end-to-end browser memory and stability run is still required before TikTok
  publishing can be enabled.
- The TikTok content script and adapter do not consume this contract yet;
  that remains Phase 6 work behind the disabled TikTok feature flag.
- No live platform action was performed in this phase.
```

---

# Phase 6 - TikTok Connection and Video MVP

Status: `IN PROGRESS - CONTROLLED TEST PUBLISHING ENABLED; LIVE VALIDATION PENDING`

## Checklist

- [x] Add narrowly scoped TikTok manifest permission.
- [x] Add an independent TikTok content-script bundle.
- [x] Implement TikTok session and account identity detection.
- [x] Add TikTok connection state to popup and dashboard.
- [x] Add TikTok Video to the create-post form (disabled by default).
- [x] Validate one supported video before job creation.
- [x] Create and schedule TikTok jobs through the shared queue behind the server flag.
- [x] Implement allowlisted upload navigation and readiness checks (offline fixtures).
- [x] Fetch and attach video through job-scoped media delivery (offline fixtures).
- [x] Detect upload progress and preparation completion (offline fixtures).
- [x] Insert and verify the caption without duplication (offline fixtures).
- [x] Preserve privacy and advanced controls PostFlow does not manage.
- [x] Re-check account identity and cancellation before Post.
- [x] Click only a verified, enabled Post control (offline fixtures).
- [x] Distinguish uploading, processing, published, failed, and unknown states.
- [x] Normalize and store reliable TikTok post URLs (offline checks).
- [x] Prevent automatic retry after accepted, processing, or uncertain results.
- [ ] Confirm TikTok failures do not block Facebook or Instagram jobs.
- [ ] Add sanitized DOM fixture and orchestration tests.
- [ ] Run the API, web, and extension builds/tests.
- [ ] Complete recorded live validation with dedicated TikTok accounts.

## Review Gate

Verify account switching, logout, processing timeout, challenge, cancellation,
service-worker restart, and duplicate prevention before controlled rollout.

## Review Notes

```text
Status: IN PROGRESS - connection and identity foundation implemented

Files changed:
- apps/api/src/extensions/extensions.controller.ts
- apps/api/src/extensions/extensions.controller.spec.ts
- apps/api/src/extensions/extensions.service.ts
- apps/api/src/extensions/extensions.service.spec.ts
- apps/extension/manifest.json
- apps/extension/package.json
- apps/extension/src/background.ts
- apps/extension/src/platforms/tiktok/identity.ts
- apps/extension/src/platforms/tiktok/content.ts
- apps/extension/src/platforms/tiktok/worker.ts
- apps/extension/src/platforms/tiktok/popup.ts
- apps/extension/src/popup/popup.html
- apps/extension/src/popup/popup.ts
- apps/extension/tests/tiktok-identity.test.cjs
- apps/extension/tests/tiktok-worker.test.cjs
- apps/web/src/app/api/extensions/platform-connections/route.ts
- apps/web/src/app/(dashboard)/connections/page.tsx
- apps/web/src/app/(dashboard)/connections/tiktok-connections-panel.tsx
- features/multi-platform-extension-publishing/progress.md

Implementation:
- Added only `https://www.tiktok.com/*` host access and an independent TikTok
  content-script bundle; no unrestricted host permission was introduced.
- Added a sanitized viewer-identity detector. It trusts an explicit own-profile
  navigation link, or a profile pathname only when an Edit profile control
  proves ownership. Public profile authors and ordinary routes remain
  `CHECKING`; only explicit login/signup routes report `LOGIN_REQUIRED`.
- Added a background session bridge that accepts reports only from a top-level
  HTTPS TikTok document, validates the username, and sends the sanitized
  identity through the credential-authenticated generic platform-session API.
  PostFlow installation credentials never enter the TikTok content script.
- First-time verified TikTok sessions now create an installation-owned generic
  PlatformConnection automatically. Existing accounts bound elsewhere remain
  recovery cases and are not silently moved.
- The manual/recovery connection API now accepts both Instagram and TikTok,
  while connection listing supports an allowlisted platform query.
- Added TikTok state cards to the extension popup and connections dashboard.
  Both surfaces explicitly keep video publishing in beta/disabled state.
- TikTok publishing execution and post creation remain disabled. No upload,
  caption, settings, or final Post control is automated by this slice.

Tests/checks:
- API build passes.
- Extension development build passes.
- Web production build passes.
- 75 focused API extension/controller tests pass, including automatic and
  explicit TikTok connection creation.
- The full API suite runs 291 tests: 290 pass, with the only failure in the
  pre-existing phone-contact index expectation (it omits the schema's `_id`
  tie-breaker); no phone-contact files were changed by this phase.
- Five sanitized TikTok identity fixtures pass directly.
- Three TikTok worker fixtures pass directly, covering host/frame rejection and
  sanitized API forwarding.
- `git diff --check` passes with only existing LF/CRLF warnings.
- No live TikTok account or publishing action was used.

Known limitations / next work:
- Live English/Arabic TikTok identity markup still needs validation with a
  dedicated account before the connection detector is considered stable.
- Phase 5 still requires the maximum-size browser memory/stability run.
- TikTok adapter/composer behavior, processing states, permalink recovery, and
  duplicate-prevention recovery remain unimplemented.
```

### Video target and creation follow-up

- Added a TikTok Video destination picker, selected chips/counts, and schedule
  preview entries. Selection requires a connected identity-matched account.
  Caption is optional; images and mixed attachments block TikTok submission.
- Added typed TikTok target normalization, owner-scoped generic connection
  resolution, cross-platform/identity validation, and immediate/scheduled
  `TIKTOK_VIDEO` jobs. The existing decoded-byte validation enforces 25MiB.
- API creation and new claims require
  `TIKTOK_EXTENSION_PUBLISHING_ENABLED=true`; missing/false disables TikTok.
  Direct RUNNING/PENDING status updates are also blocked during rollback,
  while terminal reporting remains available. The local API, web, and both
  extension build profiles now have the TikTok gate enabled for controlled
  test publishing; a deployed API must set the same server flag before jobs
  can be created there.
- The web picker requires `NEXT_PUBLIC_TIKTOK_PUBLISHING_ENABLED=true`.
  The extension has its independent existing execution flag. Local gates are
  enabled for controlled test publishing; keep any broader deployment rollout
  constrained until the media and live adapter review requirements are met.
- Deduplicated connection IDs before ownership lookup so multiple distinct
  targets can share one platform connection without failing the count check.
- Validation: API and web builds pass; 76 focused API tests and 13 web
  publishing tests pass. Focused web lint reports no errors and the existing
  image-preview warning. Tests cover disabled creation/claims/status bypass,
  rollback terminal reporting, mismatched accounts, incompatible media, and
  mixed Instagram/TikTok scheduling. No live TikTok action was performed.

Files added: `apps/api/src/posts/tiktok-publishing-policy.ts`,
`apps/web/src/lib/tiktok-publishing.ts`, and
`apps/web/src/components/tiktok-destination-menu.tsx`.
Files extended: API target normalization, post service, jobs controller and
their tests; web create-post form and publishing harness.

### Upload adapter and submission checkpoint follow-up

- Registered a TikTok adapter through its public `index.ts`. It verifies a
  fresh account snapshot, navigates only to HTTPS www.tiktok.com upload paths,
  validates one live job-scoped video grant, and binds background messages to
  the concrete tab, job, account, and top-level upload document.
- Added isolated selectors and a classic content-script composer. It fetches
  a File directly through the media runtime, attaches it to the scoped video
  input, waits for explicit preparation completion, replaces/verifies the
  caption, preserves privacy/options, and checks cancellation/account identity.
  Unexpected/ambiguous controls fail before Post. No coordinates are used.
- Added an atomic `POST /api/jobs/:id/submission-intent` checkpoint. It requires
  an enabled platform, verified owner, RUNNING status, and a live matching
  lease. It persists submittedAt/UNKNOWN before issuing one Post permission.
  Concurrent/repeated permissions are denied. A final worker check occurs
  after permission and before clicking Post.
- New claims exclude checkpointed TikTok jobs, even after lease expiry or
  worker restart. RUNNING/PENDING updates cannot reset a checkpointed job.
  Lost acknowledgements, tab channels, and post-click timeouts are UNKNOWN;
  they never trigger a second click. Uncertainty before an actual click may
  deliberately require manual reconciliation.
- Explicit processing evidence yields PROCESSING, not PUBLISHED. The existing
  submission-status enum carries this additive value (a generic enum rename
  remains deferred). The dashboard and schedule contracts understand it.
  Processing results remain stored for manual confirmation; automatic later
  status reconciliation is not implemented in this slice.
- Publication requires a new success-scoped HTTPS TikTok /@owner/video/id
  permalink matching the expected account. Prior links and other authors are
  ignored. API permalink normalization and duplicate lookup now handle TikTok.
- Validation: API and extension builds pass. Web TypeScript and lint pass; the
  production build compiles but the managed Windows runner hits `spawn EPERM`
  during its worker startup. All 34 TikTok extension
  fixtures pass through `npm run test:tiktok`; focused API checkpoint/queue/
  payload/schema tests pass (73 tests). Local TikTok gates are enabled for the
  controlled test build; no live TikTok action occurred.
- Size-rule exception: the composer execute coordinator exceeds 40 lines to
  keep the ordered checkpoint/confirmation/click boundary explicit. All new
  modules remain below 300 lines. Follow-up: split preparation and submission
  coordination after the first recorded live markup validation.

New files: extension TikTok `adapter.ts`, `bridge.ts`, `composer.ts`,
`selectors.ts`, `result.ts`, `index.ts`; adapter/composer/bridge fixtures;
API `tiktok-submission.spec.ts`.
Extended: manifest, background registration, registry, shared result contract,
orchestrator result reporting, API checkpoint/status/claim handling and schema,
dashboard processing display and schedule typing.

Remaining validation: current English/Arabic upload markup, challenges and
account switching, real processing results/navigation, 25MiB browser memory
and stability, and interruption/restart behavior with a dedicated test account.
Synthetic selectors intentionally require explicit supported structure;
unrecognized live markup stops safely and needs captured fixtures before rollout.

### TikTok upload readiness diagnostics follow-up

- Captured TikTok Studio markup showed the video input inside an
  `aria-live="polite"` upload region rather than a `<form>` or upload-form
  `data-e2e` wrapper. The selector now recognizes that stable region, while
  still rejecting an unscoped file input.
- Added readiness diagnostics (`inputCount`, `videoInputCount`, and `scoped`) and
  structured logs in the service worker and TikTok content script for tab
  navigation, content-script probes, composer execution, and terminal results.
  Logs omit captions, media bytes, and bearer tokens.
- Added two sanitized selector fixtures covering the captured no-form upload
  structure and the safe unscoped-input failure. The extension build and all
  37 TikTok fixtures pass directly.

### Manual TikTok reconciliation follow-up

- Added `POST /api/jobs/:id/tiktok-reconciliation` plus the authenticated web
  proxy. Operators can confirm an account-owned TikTok permalink, record that
  TikTok is still processing, or preserve UNKNOWN with a reason. The endpoint
  never requeues or republishes a job.
- Confirmation validates ownership, terminal job state, TikTok host/path,
  expected connected username, and duplicate permalink ownership. Existing
  published jobs cannot be downgraded or have their permalink replaced.
- Added dashboard controls beside PROCESSING/UNKNOWN TikTok jobs with a
  permalink field and explicit confirmation/uncertainty actions. The UI text
  states that reconciliation never republishes.
- API reconciliation tests pass (7 cases); API build and web TypeScript pass.
  The web production-build runner remains blocked by `spawn EPERM`; lint has
  no errors and only the existing image-preview `<img>` warning.

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

### Instagram image-carousel support (2026-10-09)

- Implemented one Instagram Feed job for one image or a 2–4 image carousel;
  one video remains an Instagram Reel. Mixed image/video selections and multiple
  videos are rejected before job creation. No mixed-media Instagram flow is
  assumed until a dedicated browser validation proves the current composer
  accepts it.
- Updated the dashboard resolver/menu, API `validateInstagramMedia`, and the
  Instagram adapter validation. The existing target type remains
  `INSTAGRAM_FEED`, so scheduling, ownership, analytics, and permalink handling
  continue to treat the carousel as one post with one caption.
- Updated the Instagram composer to place the ordered image files into the
  native `multiple` file input in one browser transaction. It still uses the
  existing caption, account, Share confirmation, and permalink logic.
- Tests/checks: web Instagram publishing tests pass (10), extension composer
  fixtures pass (29), API PostsService tests pass (11), extension development
  build passes, and web production build passes. No live Instagram post was
  created in this change.
- Live validation still required: reload the extension, select 2–4 images on a
  dedicated account, confirm the Instagram preview contains all items in order,
  confirm one caption and one permalink, then test the blocked mixed/multiple-
  video cases. If the live web composer rejects the native multi-file input,
  keep carousel creation disabled and capture its DOM variant before changing
  the flow.

### Instagram Arabic engagement follow-up (2026-10-09)

- Updated `apps/extension/src/platforms/instagram/engagement.ts` with reusable
  localized action lookup and numeric normalization. Arabic Like/Unlike/Comment
  labels, Arabic-Indic/Persian digits, Arabic decimal/thousands separators, and
  bidi markers are supported. Counter lookup now also handles the supplied photo
  sibling-counter shape without crossing another icon. Plural `/reels/` paths
  use the same video-bound scope fallback.
- Updated `apps/extension/tests/instagram-engagement.test.cjs`: all 22 tests
  pass directly, covering independent Arabic Reel counts, photo sibling counts,
  English regression, explicit empty Arabic comments, and neighboring isolation.
- Ran the extractor locally against both supplied full HTML attachments; both
  return SUCCESS with reactionCount 0 and commentCount 1. These are offline DOM
  checks, not live browser validation. Development extension build passes.
- No publishing, session, queue, scheduler, API, or Facebook behavior changed.
  Existing saved numbers require a fresh analytics sync. Next validation: reload
  the extension, refresh Instagram, and sync analytics on Arabic photo/Reel posts.

### Unified Chrome Profile connections (2026-10-09)

- Implemented the approved neutral-root slice: ExtensionInstallation owns the
  shared profile label; a new owner-scoped browser-connections endpoint groups
  Facebook/Instagram/TikTok strictly by installation ID. All three slots appear
  even before accounts are detected. Existing labels fall back to Facebook;
  legacy recovery labels are synchronized on rename. No data migration required.
- Added browser-connections grouping/test modules, dashboard component and web
  proxies. Replaced the separate Instagram/TikTok panels in the main page with
  one profile card. Account identities and health remain separate. Existing
  legacy/archived management is retained behind an on-demand Advanced section;
  its component and polling only mount when opened. Old panel files retain the
  user's earlier edits but are no longer mounted.
- Root Rename/Pause/Resume/Disconnect also work without Facebook. Dashboard
  changes are owner-scoped, lifecycle changes use a guarded atomic transition,
  and graceful disconnect uses the existing publishing/maintenance lease drain.
  Ordinary heartbeat labels cannot overwrite a dashboard rename. Explicit popup
  naming now works for profiles without Facebook. Credentials are not returned
  in the grouped response. No job/account rebinding or live publishing occurred.
- New modules remain below 300 lines. The existing ExtensionsService/controller
  receive small integration methods using their existing identity, audit and
  revocation helpers; their pre-existing large-file split is deferred to avoid
  broad lifecycle refactoring during this compatibility slice.
- Validation: 88 focused API tests pass; 23 web tests pass when invoked directly
  (the Node test runner's child-process mode hit sandbox EPERM); 21 extension
  lifecycle/recovery tests pass. API, production web, and development extension
  builds pass. Full API suite: 303 passed, 1 unrelated failing phone-contact
  index expectation in phone-contact.schema.spec.ts; that schema/test were not
  changed here. Git diff whitespace check passes.
- Live dashboard/Chrome Profile validation is still pending. Next check: confirm
  each browser gets its own card, rename it, wait for a heartbeat, and verify
  independent platform health plus profile-wide pause/resume on test accounts.
- Limits: neutral multi-platform reinstall/archive recovery remains future work;
  Advanced retains existing Facebook recovery. This grouping does not change
  Instagram session verification or enable TikTok publishing. The popup's local
  name field can remain cached after a dashboard rename until refreshed/renamed;
  it cannot revert the backend profile name via heartbeat.

Continue Phase 6 with controlled TikTok test publishing; keep broad rollout gated:

- Validate session detection against a dedicated TikTok account and record the
  current English/Arabic DOM variant without performing a publish.
- Exercise the job-scoped media path with a maximum supported 25 MiB video and
  record extension memory/stability behavior.
- Keep the implemented TikTok Video creation path and selector disabled until
  the media and adapter review gates pass.
- Validate the implemented adapter/composer against current upload markup and
  add a recorded manual/later reconciliation path for processing/unknown jobs.

## 2026-10-09 — clarification: the extension itself is the Connection

- Implemented the final agreed model: ExtensionInstallation IS the product
  Connection. Its existing ID is the card/control ID; Facebook and generic
  platform accounts retain explicit activeExtensionInstallationId bindings.
  Shared displayName/displayNameKey live on the installation. Platform usernames
  remain independent; no account IDs, scheduled jobs, or history were migrated.
- Removed the uncommitted extra Connection schema/registry draft, root binding
  fields and guards, initialize endpoint, and automatic initialization POST on
  dashboard load. Those draft files were implementation scaffolding only; no
  database collection was created or modified by a migration in this work.
- Connections UI now has one extension card containing Facebook, Instagram,
  and TikTok slots, a shared rename, and installation-wide pause/resume/graceful
  disconnect. No separate global browser/platform connection sections. Masked
  extension identity and independent account health remain visible.
- Existing Facebook recovery stays inside its relevant card, clearly labeled
  as Facebook recovery. Disconnected installations are accessible through a
  toggle, including archived Facebook compatibility records. Rebound accounts
  cannot appear under a former installation. Disconnected/disconnecting cards
  cannot rename their previous Facebook account.
- Registration/heartbeat return installation identity plus the shared name.
  A small shared extension helper validates and stores only this metadata,
  keeping the local name synchronized without confusing a Facebook account ID
  with the installation ID. An unnamed UI fallback is never persisted by this
  synchronization. This supersedes the earlier cached-popup-name limitation.
- Files: API browser-connections helper/tests, ExtensionsService/controller
  and tests, installation schema; web connections page/unified card/recovery
  scoping and authenticated proxies; extension shared/connections helper,
  background integration, and identity tests; feature and progress documents.
- Validation: 134 focused API tests, 23 web tests, and 23 extension
  identity/lifecycle/recovery tests pass. API, production web, and development
  extension builds pass; API TypeScript and git diff whitespace checks pass.
  Full API suite: 307 passed, one pre-existing failure in
  phone-contact.schema.spec.ts (board-index expectation); untouched here.
- Live UI/Chrome validation remains pending. Restart the API/web processes and
  reload the built extension, then verify one card per installation, shared
  rename surviving a heartbeat, independent platform health, and whole-connection
  pause/resume. No live publishing, flag changes, or database writes were run.
- Deferred: generic multi-platform reinstall/archive recovery and replacement
  of the legacy Facebook recovery implementation. TikTok publishing remains
  gated; its presence on a connection card does not enable publishing.

## 2026-10-09 — restore original Connections UI, platform diagnostics in details

- Followed the user's screenshot correction: restored the original Connections
  dashboard layout, Active/Archived tabs, four summary metrics, searchable and
  filterable expandable rows, action menus and confirmation dialogs. Removed
  the replacement browser-connections-dashboard component and recovery wrapper.
- Added read-only Facebook/Instagram/TikTok diagnostics inside expanded row
  details: account username/masked ID, account status, session evidence and worker
  status. Unknown/missing platform slots remain visible; no login/publishing
  actions are triggered by displaying these details.
- Added a reusable connection-platforms adapter rather than another dashboard:
  joins only by explicit installation/account IDs, avoids duplicate archived
  Facebook rows, preserves legacy recovery IDs, and includes extensions without
  Facebook. Shared rename/pause/resume/disconnect use installation endpoints;
  existing Facebook archive/restore/force-disconnect remain on legacy endpoints.
- Summary health now recognizes work and readiness on any connected platform;
  Facebook diagnostics are labeled explicitly instead of presenting them as
  the status of the whole multi-platform connection. Search includes platform
  usernames/status and the masked extension instance ID.
- No API/schema/session/scheduler changes, account rebinding, data migration,
  publishing, or flag changes. This section supersedes the replacement-card UI
  described in the earlier entry. Generic multi-platform archive/recovery remains
  deferred, as before.
- Validation: production web build passes, 32 focused web tests pass (13
  lifecycle/view, 6 binding/platform-details rendering, 13 publishing-form),
  and git diff whitespace check passes. Live browser visual
  verification is still pending; reload /connections and expand an existing row
  to check the original layout with the new Platforms detail section.

## 2026-10-09 — Active tab contains current connections only

- Filter initial and refreshed Active rows and their summary totals to current
  non-archived installations (ACTIVE, PAUSED, REVOKE_PENDING). Revoked historical
  installations and unbound legacy records no longer appear in Active.
- Offline/paused current connections remain manageable so users can resume them;
  gracefully disconnecting connections remain visible until revocation completes.
  Archived fetching/restoration is unchanged. No records were deleted or archived
  by this presentation filter; no API, scheduler or session changes.
- Validation: 21 connection/lifecycle tests and production web build pass.
  Visual confirmation remains pending on reloading the Connections page.

## 2026-10-09 — functioning Force disconnect and Remove/Archive on the extension

- Restored Force disconnect and Remove from Connections in the original action
  menu for installation-backed connections, including those without Facebook.
  Both now target the installation API instead of assuming a Facebook account ID.
- Added owner-scoped, guarded atomic revocation: status becomes REVOKED,
  credentialRevokedAt is set and credentialVersion increments once. Force works
  during publishing or graceful disconnect. All platform worker APIs are blocked
  by the existing installation identity guard; active work can lose permission
  to report, as the existing typed-confirmation warning explains.
- Remove additionally records installation archivedAt/archivedByClerkUserId/
  archiveReason and an archive audit event. Repeated removal is idempotent;
  competing lifecycle changes fail safely. No accounts/jobs/history are deleted
  or rebound, and an account now bound to another installation is not modified.
- Grouped DTOs expose archive metadata (not credentials). The Archived tab merges
  archived installation rows with legacy Facebook records without duplicates;
  Active and its totals exclude them. Existing Facebook reconnect approval still
  works. Standalone multi-platform archives show a truthful reconnect limitation,
  not a non-working Restore button: verified generic reinstall recovery remains
  deferred; archived credentials are never silently reactivated.
- Files: installation schema; ExtensionsService and tests; grouped DTO helper
  and tests; web action proxy, connection adapter, dashboard and regression tests;
  feature/progress. No extension automation/scheduler changes or live mutations.
- Validation: 141 focused API tests and 36 web tests pass. API and production web
  builds pass; TypeScript checks pass. Live force/archive testing is pending on
  dedicated test installations (these actions intentionally revoke access).
- Next safe check: restart API/web, refresh Connections, verify both options,
  and test Force/Remove on an idle dedicated installation. Confirm the removed
  connection appears only in Archived and its jobs/account IDs are unchanged.

### 2026-10-09 — Instagram session parity with installation-bound connections

- Added an active Instagram session refresh before every Instagram publish.
  The extension queries the current Instagram tabs, asks the top-level document
  for fresh identity evidence, and only authorizes the expected username. This
  is the Instagram equivalent of Facebook's pre-publish cookie refresh while
  keeping the same `activeExtensionInstallationId` binding.
- Added the same refresh at successful extension registration and heartbeat
  when an Instagram tab is already open, with explicit session-evidence logs.
- A successfully persisted `STALE` cache state is now quiet until a new
  document report arrives, so the one-minute freshness alarm cannot spam the
  API or compete with publishing/analytics work. Failed stale writes retain
  the previous verified snapshot and retry safely.
- Refresh reuses only a document ID previously observed through the
  top-level content-script handshake (or the persisted snapshot). This keeps
  an old rendered Instagram tab from restoring a session after another tab
  explicitly logged out; a newly created hidden tab is used only after its
  own document handshake arrives.
- Expiry persistence is failure-safe: the local cache is marked non-fresh only
  after the API accepts the stale transition; a network/API failure leaves the
  verified snapshot intact for the next alarm retry.
- Local UI/maintenance state also keeps `STALE` visible as a connected account;
  only explicit login or account-mismatch evidence clears detection. The
  publisher still requires fresh evidence, so this stability does not weaken
  the pre-Share identity gate.
- Fixed the startup log failure seen when Instagram reports `CHECKING` or
  `LOGIN_REQUIRED` before a platform connection exists. The API's `null` result
  in that unbound state is now treated as a normal not-yet-bound observation;
  transport/HTTP failures still surface and retry. Refresh and pre-Share checks
  require a real persisted platform response, so this does not authorize a job
  without an installation-bound account.
- Extended the local verified-evidence cache window to five minutes, while
  retaining explicit document checks immediately before Share. A `CHECKING` or
  `STALE` observation no longer changes a connected Instagram platform record
  to `PENDING`/`LOGIN_REQUIRED`; it records the evidence state and waits for a
  fresh document check. Explicit `LOGIN_REQUIRED` and account mismatch still
  revoke authorization and stop publishing.
- Kept stale local evidence non-authorizing: publishing requires a successful
  refresh, a fresh snapshot, and a normalized username match. The same
  installation-bound platform record remains the source for jobs, analytics,
  and connection diagnostics.
- Added regression coverage for active refresh success/mismatch, the five-minute
  expiry boundary, and API preservation of connected state during transient
  evidence loss. No cookie values are read or shared between Facebook and
  Instagram; Instagram identity remains DOM evidence from the current tab.
- Validation: extension TypeScript/build passes; Instagram identity/session,
  composer, and engagement suites pass directly (8 + 18 + 29 + 22 tests).
  API TypeScript check and `extensions.service.spec.ts` pass (81 tests).
  The Node test runner's child-process mode still hits the sandbox `spawn EPERM`,
  so the focused extension suites were invoked directly. No live account,
  publishing job, scheduler, or database mutation was run.
- Remaining limitation: generic archived/reinstall recovery is still the
  explicit Facebook-only flow; adding a fresh Instagram account to a different
  installation remains a deliberate recovery action rather than auto-rebinding.
  Next safe check is a dedicated test account: reload the extension, open
  Instagram in the same Chrome profile, confirm the connection stays Connected
  while navigation/analytics is loading, then publish one image and one Reel.

### 2026-10-09 — safe content-script reload handling

- Fixed `Uncaught Error: Extension context invalidated` from the Instagram
  content script's 15-second identity reporter. After an extension reload,
  the old page script now catches the runtime error, stops its interval, and
  exits quietly instead of logging an uncaught exception.
- Added a regression test for invalidated and normal runtime messaging.
  Development build and focused content/session tests pass (2 + 18 tests).
  Reload the extension and Instagram tab once to replace the old content
  script context before live validation.
### 2026-10-09 — Instagram ID-backed session binding

- Added stable Instagram account identity from the authenticated `ds_user_id` + `sessionid` cookies; new session reports no longer require a username.
- Added installation-bound ID verification for refresh and pre-share checks, with cookie-change refresh on login/account switch.
- Added API support for ID-only Instagram platform connections and ID-based job validation/payloads. New ID-backed connections use a generic display label and do not persist a username; legacy username records remain readable during migration.
- Updated Instagram dashboard/popup readiness states to show account identity linked/detected without exposing a handle.
- Verification: extension build passes; Instagram session (19), content (2), identity (8), composer (29) tests pass; API build and focused API suites (117 tests) pass; web TypeScript check passes.

### 2026-10-09 — Instagram opens a background tab for cookie verification

- Instagram session refresh now ensures an inactive top-level Instagram tab is
  available before checking session cookies. It reuses an existing Instagram
  tab and opens at most one background tab when none is present, so startup,
  heartbeat, cookie-change, and pre-publish refreshes do not require manual
  navigation or steal focus.
- The stable identity check requires both `ds_user_id` and a live `sessionid`.
  If cookies are missing, the extension remains waiting for login; it does not
  bind or persist a username. Legacy username-only records remain readable as
  a compatibility path only.
- Added explicit diagnostics for tab creation and cookie absence. The cookie
  path persists an ID-backed installation session even if the new tab's content
  script handshake is still delayed; Share still requires fresh top-level
  document verification.
- Validation: extension development build passes; Instagram session suite
  passes all 20 tests; content, identity, and composer suites pass (2 + 8 + 29).

### 2026-10-09 — Deduplicated repeated Instagram session evidence

- The Instagram page still checks identity every 15 seconds, but unchanged
  evidence is now reported to the worker at most once per minute. Identity,
  source, state, and pathname changes are sent immediately so login/account
  switches remain responsive.
- The background session manager also short-circuits identical reports for one
  minute, reducing duplicate API writes. Explicit refresh and pre-Share checks
  bypass this cache and always re-read the current top-level document.
- Refresh calls are serialized so startup, heartbeat, cookie-change, and
  publishing checks cannot create duplicate tabs or race session writes.
- Repeated worker diagnostics are coalesced per tab/document, and the log now
  says `Session evidence processed` to distinguish handling evidence from a
  successful platform-connection bind (`platformConnectionBound: true`).
- Added regression coverage for the duplicate-report cache. Validation:
  extension build passes; Instagram session suite passes all 20 tests and the
  content suite passes both tests.

### 2026-10-09 — Popup platform status parity

- Replaced the popup's `Not synced` Groups status card with a Facebook
  platform status card matching Instagram and TikTok (`Session detected`,
  `Not detected`, or the relevant attention state).
- The Facebook card shows the masked detected account and connection status;
  group discovery/sync totals remain in the Group status section below.
- Validation: extension development build passes and `git diff --check` reports
  no whitespace errors.

### 2026-10-09 — Connection name fallback

- Connections now use the explicit display name as the row title whenever it is
  non-empty. If no name exists, the grouped API and dashboard fall back to the
  masked extension instance ID, keeping unnamed Chrome profiles identifiable.
- Existing Facebook account and platform details remain unchanged; this only
  changes the visible connection title fallback.
- Validation: browser-connections API suite passes (8 tests) and web TypeScript
  check passes.

### 2026-10-09 — Instagram publishing starts from the account profile

- Added an Instagram profile URL handshake to the content script. For legacy
  username jobs it uses the target username; for ID-backed jobs it discovers
  the authenticated account's own profile link ephemerally from the current
  document without persisting the username.
- The adapter navigates the selected Instagram tab to that profile and waits
  for the profile document to finish loading before arming the permalink
  baseline or sending the composer command. If the own profile cannot be
  resolved, the job fails safely before opening the composer.
- Permalink recovery now runs against the same profile tab/page, preventing an
  open Reel or old post detail tab from supplying a stale post URL after the
  refresh step.
- Validation: extension development build passes; Instagram identity (10),
  content (2), and composer (29) suites pass.

### 2026-10-09 - Arabic profile-link discovery for Instagram publishing

- Updated Instagram identity discovery to inspect nested `aria-label`, `alt`,
  and SVG-title values, including the current Arabic sidebar labels such as
  `ملف شخصي` and `صورة ملف ... الشخصي`.
- Added a regression fixture for the current Arabic profile DOM. This keeps
  ID-backed publishing on the authenticated account profile instead of
  failing before the composer when Instagram is localized to Arabic.
- Validation: extension development build passes; identity suite passes all 10
  focused cases.

### 2026-10-09 - Recovering Instagram sessions after extension reload

- Startup and pre-publish refresh now detect an existing Instagram tab whose
  old content-script context was invalidated by an extension reload.
- The manager attempts to reattach the Instagram content bundle, waits for a
  fresh top-level document handshake, and safely falls back to the current
  cookie-bound account ID when the page listener is still unavailable.
- Added a regression test for the cached-document/listener invalidation path.
  Validation: extension development build passes; Instagram session suite
  passes all 21 tests.

### 2026-10-09 - Platform dropdowns use the shared Chrome Profile name

- Platform connection responses now include the name and masked instance ID
  of their active extension installation.
- Instagram and TikTok destination dropdowns display that shared extension
  name instead of an Instagram/TikTok username or platform-generated label.
- Removed the Instagram Beta badge and the ready-state `Reel selected
  automatically · caption optional` helper; TikTok no longer appends the
  account username to the destination row.
- The API now falls back to the shared Facebook connection label when an
  installation has no copied display name, so existing profiles are named
  correctly without exposing platform usernames.
- Create Post now requests Instagram and TikTok connections separately;
  Instagram no longer receives the combined platform response.
- Removed the remaining media/caption helper copy from both platform sections;
  the destination row is focused on the shared extension name and state.
- Instagram and TikTok now use the same collapsible account dropdown pattern
  as Facebook profile feeds, with selection and connection status inside the
  menu.

### 2026-10-09 - TikTok installation-bound session discovery

- TikTok now follows Instagram's automatic connection path: on extension
  startup it reuses an existing TikTok tab or opens an inactive TikTok tab,
  asks the content script for verified profile evidence, and reports the
  signed-in account through `/api/extensions/platform-session`.
- The session check reattaches the TikTok content bundle after an extension
  reload and persists the verified session state for the publishing worker.
- Validation: extension development build and the focused TikTok identity,
  worker, adapter, composer, and bridge tests pass.
- Expanded TikTok identity discovery for profile/avatar navigation controls and
  forced bundle reattachment when an old content script only returns CHECKING.
- Added a non-persistent TikTok cookie-presence check and an account-owned
  `/profile` probe. Cookies are used only as an authenticated-session signal;
  no session cookie value is stored or sent to the API.
- Added safe context-invalidation handling to the TikTok content script so an
  extension reload stops old timers/listeners cleanly instead of throwing
  `Extension context invalidated` in the page.
- Prevented duplicate TikTok bundle injection when an existing content script
  already responds with `CHECKING`, avoiding top-level declaration collisions.
- Validation: API build, web TypeScript checks, and web production build pass.

### 2026-10-09 - Hardened TikTok automatic session binding

- The API now logs the platform and installation when automatic session
  binding fails, instead of leaving the extension with an opaque 500.
- Automatic binding checks historical connections as well as active ones, so
  archived account records cannot trigger a duplicate-key failure.
- Concurrent startup probes are now race-safe: if another probe creates the
  same installation/platform connection first, the second probe recovers that
  connection rather than treating the valid session as logged out.
- Duplicate account ownership still remains an explicit reconnect flow; the
  worker never steals a TikTok account from another Chrome Profile.
- The TikTok worker now distinguishes "signed in but API binding rejected"
  from "no signed-in account", including the HTTP status/message in the
  diagnostic log without exposing cookies.
- Validation: API build and the 81-test `extensions.service.spec.ts` suite
  pass (82 tests after the race regression case); extension build and focused
  TikTok tests pass.

### 2026-10-09 - TikTok upload readiness and ownership diagnostics

- TikTok Studio readiness now accepts the current upload surface even when
  TikTok renders an `aria-live="polite"` container instead of a form or the
  older `data-e2e` upload wrapper. The probe reports scoped video-input counts
  so a loaded-but-incomplete page is visible in the service-worker log.
- Added stage logs through the TikTok composer (media fetch, file attach,
  preparation, caption verification, submission arm, and Post click) without
  logging captions, media bytes, or credentials.
- Registration now waits for installation-bound TikTok session refresh before
  claiming pending work. Verification logs include the expected/detected
  account, freshness age, connection status, and masked installation ID.
- API job claim and ownership rejection logs include masked installation and
  platform-connection IDs, making stale jobs from another Chrome Profile
  distinguishable from TikTok login failures.
- Account-verification failures now close the job lease before changing the
  platform connection to `ACCOUNT_MISMATCH`, preventing a misleading secondary
  ownership 401 while recording the real failure.
- The same ordering applies to CAPTCHA/block/checkpoint terminal failures, so
  their final `FAILED` result is persisted before the connection status changes.
- Validation: extension development build, API build, focused TikTok suites
  (41 fixtures), and `jobs.controller.spec.ts` (42 tests) pass.

### 2026-10-09 - TikTok post-upload editor transition

- Captured TikTok Studio's post-upload DOM, where the original upload card is
  replaced by a `data-e2e="upload_status_container"` / caption editor tree.
- The selector layer now recognizes the uploaded status, caption container,
  and verified Post control in that live editor. The composer reacquires the
  editor scope after TikTok detaches the upload scope instead of returning
  `COMPOSER_CHANGED`.
- Added transition/reacquisition diagnostics (`editor-scope-transition` and
  `editor-scope-reacquired`) with sanitized readiness fields, plus a selector
  regression fixture for the captured markup.
- Validation: focused TikTok suites (41 fixtures) and extension development
  build pass.

### 2026-10-10 - TikTok local-draft cleanup before scheduled upload

- Captured TikTok Studio's unsaved-draft banner with its scoped `Discard` and
  `Continue` controls. A queued PostFlow video now verifies the account and job,
  selects only the unique visible `Discard` button inside
  `data-e2e="local_draft_container"`, and waits for the banner to disappear
  before fetching or attaching scheduled media.
- Added `local-draft-discarding` and `local-draft-discarded` composer stages.
  Missing, ambiguous, disabled, or non-clearing controls still stop safely and
  pause TikTok work; PostFlow never selects `Continue` or an unscoped button.
- TikTok's second-step `Discard this post?` modal is now recognized separately.
  PostFlow selects its unique `Discard` confirmation, never `Not now`, and
  requires both the modal and draft banner to disappear before media fetch.
- After the submission checkpoint and initial Post click, the exact
  `Continue to post?` incomplete-copyright-check modal is recognized. PostFlow
  clicks its unique `Post now` control once and resumes terminal result
  observation; changed or ambiguous confirmation markup remains `UNKNOWN` and
  is never retried automatically.
- TikTok Studio's redirect to `/tiktokstudio/content` is now part of result
  observation. The matching row is correlated by connected account, exact
  caption, and the creation time encoded by its TikTok video ID. A `Reviewing`
  row is polled for up to 150 seconds; a fresh canonical row becomes
  `PUBLISHED` with its permalink, while a row still under review becomes
  `PROCESSING` instead of `UNKNOWN`. Older content rows are rejected.
- Validation: focused TikTok suites (54 fixtures) and extension development
  build pass.

### 2026-10-10 - TikTok multi-image photo posts

- Added `TIKTOK_PHOTO` across the create-post UI, API target validation/job
  payloads, extension target normalization, queue claiming, and reconciliation.
- A TikTok destination now resolves one video to `TIKTOK_VIDEO`, or 1 to 4
  images to one `TIKTOK_PHOTO` job. Mixed media remains blocked. TikTok Studio
  advertises up to 35 photos, but PostFlow deliberately keeps its existing
  four-attachment and 2MB-per-image limits for this first rollout.
- The TikTok composer selects the exact `Photos` tab, waits for the active
  `panel-photo` image input, fetches all lease-scoped images, and attaches them
  in one `DataTransfer` change event. It recognizes the captured photo editor's
  uploaded-photo count, shared caption editor, and Post control.
- Photo posts reuse the existing account guard, single-use submission
  checkpoint, local-draft cleanup, and Content-page Reviewing-to-Published
  correlation. TikTok photo permalinks use the same `/@account/video/{id}`
  canonical path observed in the captured Studio row.
- Validation: API build; 66 focused API tests; web production build and 14
  publishing tests; extension development build and 57 focused TikTok fixtures
  pass.
- Live photo-post testing showed TikTok can render the uploaded-photo count
  before its final Post control is enabled. The composer now reacquires the
  full editor scope and waits up to 30 seconds for the unique enabled Post
  control after writing the caption, logging `post-control-waiting` and
  `post-control-ready` instead of failing immediately with
  `POST_CONTROL_UNAVAILABLE`. Validation now includes 58 focused TikTok
  fixtures and the extension development build.
- A second live multi-photo run exposed an inner TikTok `data-tt` wrapper that
  could narrow editor scope to the caption subtree and exclude the footer.
  Editor reacquisition now targets only the full Studio page container or
  `.main-body`; readiness/failure diagnostics also report total and enabled
  Post-control counts in the background console. The captured nested-wrapper
  regression is covered within the 58 passing focused TikTok fixtures.

### 2026-10-10 - Owner-initiated retry for failed publishing

- Added an owner-authenticated `POST /api/jobs/:id/retry` action and a
  `Retry publish` control on failed jobs in the post detail view.
- Retry is limited to jobs that are still `FAILED` and have no submission,
  permalink, external publish ID, or terminal submission marker. TikTok and
  other platform connections must remain connected and identity-verified.
- The API records a single-use `manualRetryRequestedAt` marker. The extension
  claims only that marked job, atomically consumes the marker, and clears an
  in-memory platform pause before execution. Legacy Facebook claiming applies
  the same marker filter for compatibility.
- `UNKNOWN`, `PROCESSING`, `PUBLISHED`, and any job with submission evidence
  remain reconciliation-only and cannot be manually retried.
- Validation: focused API retry/controller tests (45 tests), API build,
  extension development build, and web production build pass.

### 2026-10-10 - TikTok upload-channel recovery and photo readiness

- A TikTok content-script response can be lost while Studio replaces the
  upload/editor document. The worker now pings and, when needed, reattaches
  the TikTok composer scripts, returns a completed result if the original
  execution finished, or resumes the existing editor without attaching the
  media a second time.
- Photo preparation now requires two consecutive ready samples. If TikTok
  retains the file input, the visible `N photos uploaded` count must catch up
  with the selected-file count before captioning or Post-control handling.
- After the single-use submission checkpoint, TikTok may replace the Post
  button while the API confirmation is in flight. The composer now reacquires
  the unique enabled Post control for up to 10 seconds and logs the replacement
  before clicking; ambiguous or missing controls remain `UNKNOWN`.
- Added recovery/resume and post-control-replacement coverage to the TikTok
  adapter and composer tests.
- Composer stages are now relayed to the extension background console as well
  as the TikTok tab console, so media fetch, ingestion, editor reacquisition,
  and Post-control waits remain observable during a long-running upload.
- The outer TikTok execution watchdog now allows up to five minutes, covering
  the media-delivery and bounded Studio ingestion windows without changing the
  no-automatic-retry rule for an uncertain result.
- Validation: extension build, 7 adapter tests, 27 composer tests, and 10
  selector tests pass.

### 2026-10-10 - TikTok published-post engagement sync

- Added TikTok video and photo permalink eligibility to the existing
  authenticated engagement queue, with an independent automatic-sync flag.
  Manual refresh remains available when automatic TikTok analytics is disabled.
- The extension opens the exact published post, verifies its route, and reads
  likes, comments, favorites, and numeric shares from TikTok's action bar. A
  visible `Share` label without a number remains unknown; partial results keep
  prior counters intact.
- Added persisted favorite/share counters and TikTok-specific labels to the
  post details view. The production flag is enabled and the development flag
  remains disabled.
- Validation: focused API tests (72 tests), API build, TikTok extension tests
  (66 fixtures), extension development and production builds, 37 web regression
  tests, and web production build pass. The production extension includes
  `TIKTOK_AUTOMATIC_ANALYTICS_ENABLED=true`. Live TikTok account validation
  remains pending.
