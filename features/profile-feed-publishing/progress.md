# Profile Feed Publishing - Progress

## Goal

Add `PROFILE_FEED` as a publishing target while preserving the existing
Facebook Group flow.

Status: `In Progress`

## Source Documents

- `features/profile-feed-publishing/feature.md`
- `features/multi-account-facebook-publishing/FEATURE.md`
- `features/multi-account-facebook-publishing/IN_PROGRESS.md`

---

# Phase 0 - Existing Implementation Review

## Checklist

- [x] Inspect the current Post, PublishingJob, Group, and FacebookConnection
      schemas.
- [x] Inspect create-post validation and job creation.
- [x] Inspect worker connection verification and job claiming.
- [x] Inspect extension background navigation and execution routing.
- [x] Inspect Facebook content-script composer and result tracking.
- [x] Inspect create-post UI and post detail group assumptions.
- [x] Confirm profile feed support is not already implemented.
- [x] Define the minimum target abstraction.

## Review Notes

```text
Status: COMPLETE

Current architecture:
- CreatePostDto requires targetGroupIds.
- PostsService creates one PublishingJob per selected Group.
- PublishingJob.groupId is required.
- PublishingJob already carries facebookConnectionId and worker lease fields.
- JobsController claims jobs by verified FacebookConnection and extension
  instance, then populates groupId.
- The extension background always derives a Facebook Group URL from job.groupId.
- The Facebook content script has group-specific page validation and permalink
  tracking mixed with reusable composer/media/submission behavior.
- The web create form selects Groups, filtered by FacebookConnection.
- Post detail and analytics readers assume every job has a populated Group.
- Manifest permissions and content-script matches already cover facebook.com.

Decision:
- Add PublishingJob.targetType with GROUP and PROFILE_FEED values.
- Do not model profile feeds as Group records.
- PROFILE_FEED jobs use facebookConnectionId as their destination ownership.
- Add a typed target API while retaining targetGroupIds temporarily.
- Reuse the existing per-connection claim and worker isolation model.

Files changed:
- features/profile-feed-publishing/feature.md
- features/profile-feed-publishing/progress.md
```

---

# Phase 1 - Target Model and Migration Compatibility

## Checklist

- [x] Add `PublishingTargetType` with `GROUP` and `PROFILE_FEED`.
- [x] Add `targetType` to PublishingJob with a migration-safe `GROUP` default.
- [x] Make `groupId` optional for `PROFILE_FEED` jobs.
- [x] Enforce target invariants in application validation.
- [x] Treat legacy jobs without `targetType` as `GROUP`.
- [x] Add useful queue indexes for connection, target type, status, and schedule.
- [x] Update TypeScript job types that require `groupId`.
- [x] Add schema/validation tests for both target types.
- [x] Confirm existing Group jobs remain readable.

## Review Gate

Review the schema and compatibility strategy before enabling profile job
creation.

## Review Notes

```text
Status: COMPLETE

Files changed:
- apps/api/src/schemas/publishing-target.ts
- apps/api/src/schemas/publishing-job.schema.ts
- apps/api/src/schemas/publishing-job.schema.spec.ts
- apps/api/src/posts/jobs.controller.ts
- features/profile-feed-publishing/progress.md

Implementation:
- Added GROUP and PROFILE_FEED target types.
- PublishingJob.targetType defaults to GROUP, so legacy records with no stored
  target type retain their existing behavior when hydrated.
- PublishingJob.groupId is optional at the type/schema level.
- Schema validation requires a group for GROUP jobs, requires a connection for
  PROFILE_FEED jobs, and rejects group references on PROFILE_FEED jobs.
- Added a compound queue index over connection, target type, status, schedule,
  flow order, and creation time.
- Pending approval serialization now skips malformed/group-less records safely.
- No profile jobs are created or delivered in this phase.

Tests/checks:
- API build passes.
- Focused target validation tests pass: 5 tests.
- New schema and validation files pass focused ESLint.

Known limitations:
- The existing jobs controller still reports its pre-existing unsafe enum
  comparison lint errors when linted directly.
- Mongoose-decorated schema tests remain coupled to the repository's existing
  Jest/Nest ESM issue, so target invariants are tested through the pure
  validation contract that the schema middleware calls.
```

---

# Phase 2 - Create-Post API and Job Creation

## Checklist

- [x] Add the discriminated `targets` request contract.
- [x] Keep `targetGroupIds` compatibility during migration.
- [x] Validate at least one destination.
- [x] Validate Group ownership.
- [x] Validate FacebookConnection ownership and verified identity.
- [x] Reject duplicate and malformed targets.
- [x] Create one job per destination.
- [x] Create PROFILE_FEED jobs without `groupId`.
- [x] Assign every profile job to its selected FacebookConnection.
- [x] Preserve destination order in `flowOrder`.
- [x] Apply scheduling/spacing across mixed destinations.
- [x] Return a target-aware schedule response.
- [x] Add focused service/controller tests.

## Review Gate

Verify persisted jobs for group-only, profile-only, and mixed requests before
changing the web form.

## Review Notes

```text
Status: COMPLETE

Files changed:
- apps/api/src/posts/create-post-targets.ts
- apps/api/src/posts/create-post-targets.spec.ts
- apps/api/src/posts/posts.service.ts
- apps/api/src/posts/posts.service.spec.ts
- apps/api/src/posts/jobs.controller.ts
- features/profile-feed-publishing/progress.md

Implementation:
- Added a runtime-validated discriminated target request with GROUP and
  PROFILE_FEED variants.
- Preserved targetGroupIds by normalizing legacy IDs into GROUP targets.
- Canonicalized MongoDB IDs and rejected malformed, duplicate, mixed-field, and
  unsupported targets before database access.
- Resolved Group and FacebookConnection ownership before creating the Post.
- Required profile connections to be connected, session-detected, and matched
  to the bound Facebook account identity.
- Created one target-typed job per destination; profile jobs omit groupId and
  carry the selected facebookConnectionId.
- Preserved mixed destination order in flowOrder and applied existing scheduling
  and spacing across the full ordered target list.
- Returned targetType and targetId in schedule entries while retaining groupId
  for legacy Group consumers.
- Kept pending-approval filtering Group-only while allowing `/api/jobs/next`
  and published engagement sync to handle both GROUP and PROFILE_FEED jobs.

Tests/checks:
- API build passes.
- Focused PostsService creation tests pass for profile-only, mixed scheduled,
  legacy Group, wrong-owner connection, and unverified connection scenarios.
- Target normalization, target invariant, and scheduling test suites pass.
- 33 focused tests pass across four suites.
- New target helpers and tests pass focused ESLint.

Known limitations:
- PROFILE_FEED jobs intentionally remain pending behind the temporary queue
  target gate until target-aware delivery and extension routing are complete.
- The existing posts service still reports its pre-existing unsafe enum
  comparison lint errors when the whole file is linted directly.
- The full API Jest run executes 7 suites with 38 passing tests, but 5 existing
  controller/service suites fail during module loading because the repository's
  Jest CommonJS setup cannot load the ESM @nestjs/mongoose package.
```

---

# Phase 3 - Target-Aware Queue Payload

## Checklist

- [x] Introduce a normalized publish-job response DTO.
- [x] Map Group jobs to a `GROUP` target payload.
- [x] Map profile jobs to a `PROFILE_FEED` target payload.
- [x] Derive profile identity and URL from the persisted connection.
- [x] Keep atomic claims scoped to FacebookConnection and extension instance.
- [x] Prevent another connection from claiming a profile job.
- [x] Preserve scheduled-job eligibility and lease recovery.
- [x] Update job status/cancel ownership checks for optional `groupId`.
- [x] Add queue routing and claim-isolation tests.

## Review Gate

Inspect real API payloads for both target types before extension execution is
enabled.

## Review Notes

```text
Status: COMPLETE

Files changed:
- apps/api/src/posts/publish-job-payload.ts
- apps/api/src/posts/publish-job-payload.spec.ts
- apps/api/src/posts/jobs.controller.ts
- apps/api/src/posts/jobs.controller.spec.ts
- features/profile-feed-publishing/progress.md

Implementation:
- Added a normalized publish-job payload mapper with `post` and `target`
  fields.
- Group queue payloads now include `target: { type: GROUP, ... }` while
  retaining legacy `_id`, `postId`, and `groupId` fields for the current
  extension.
- Profile queue payload mapping is defined from the populated
  FacebookConnection and derives the profile URL from persisted
  `facebookUserId`.
- `/api/jobs/next` now populates FacebookConnection identity fields needed by
  profile payloads.
- `/api/jobs/next` accepts explicit GROUP, PROFILE_FEED, and legacy jobs; the
  verified FacebookConnection still scopes which worker can claim each job.
- Atomic job claims remain scoped to the verified extension instance's
  FacebookConnection.
- Pending-approval and engagement queue filters now explicitly exclude
  PROFILE_FEED jobs for this release.
- Duplicate permalink detection is target-aware: Group jobs compare within a
  Group/legacy target, and profile jobs compare within the assigned
  FacebookConnection.

Tests/checks:
- API build passes.
- Focused queue payload, controller claim, create-post target, schema target,
  and scheduling tests pass: 40 tests across 6 suites.
- Focused ESLint passes for new Phase 3 files and target helper files.
- Prettier check passes for Phase 3 files and touched target helper files.
- `git diff --check` passes, with only existing CRLF warnings reported.

Known limitations:
- Pending-approval synchronization remains intentionally Group-only; profile
  posts do not have an approval state.
- Full API Jest still has the previously documented repository-level
  @nestjs/mongoose ESM loading issue in existing controller/service suites.
```

---

# Phase 4 - Extension Target Routing

## Checklist

- [x] Add target-aware extension job types.
- [x] Branch background navigation by target type.
- [x] Preserve the existing Group URL validation path.
- [x] Add safe own-profile URL validation.
- [x] Verify Facebook identity before profile navigation.
- [x] Re-check identity before final submission.
- [x] Send a target-aware `EXECUTE_JOB` message.
- [x] Keep cancellation and stale-execution guards.
- [x] Keep one active publish per extension instance.
- [x] Report target type in diagnostics without logging content.

## Review Gate

Confirm the matching Chrome profile receives the profile job and a second
profile cannot claim or execute it.

## Review Notes

```text
Status: COMPLETE

Files changed:
- apps/extension/src/publishing-target.ts
- apps/extension/src/background.ts
- apps/extension/src/content.ts
- apps/extension/tests/publishing-target.test.cjs
- apps/extension/package.json
- features/profile-feed-publishing/progress.md

Implementation:
- Added typed, normalized extension queue targets with legacy Group payload
  compatibility.
- Background navigation branches by target: existing Group URL validation is
  preserved, while profile navigation accepts only the API-derived,
  Facebook-owned `profile.php?id=<verified id>` URL.
- Profile jobs refresh and compare the active Facebook identity with the
  connection-owned target before navigation and immediately before the
  target-aware `EXECUTE_JOB` message is sent.
- Added the `VERIFY_EXECUTION_IDENTITY` request protocol for the Phase 5
  content-script final-submit check.
- Account mismatches fail the claimed job with `ACCOUNT_MISMATCH`, report that
  worker status, and pause only this extension connection's queue.
- Content-script routing now validates the target discriminator. It continues
  to execute Group jobs through the existing composer path and intentionally
  declines profile composer execution until Phase 5 adds its separate DOM
  implementation.
- Target type is included in worker diagnostics; post content is not logged by
  the new routing diagnostics.

Tests/checks:
- Extension TypeScript build passes.
- Added focused queue-target normalization and safe profile URL tests.
- `git diff --check` passes, with only existing CRLF warnings reported.

Known limitations:
- Profile jobs remain held by the API delivery gate until the dedicated profile
  composer path is implemented in Phase 5.
- The final-submit identity protocol is ready for Phase 5 to invoke; no profile
  composer action exists in this phase.
```

---

# Phase 5 - Profile Composer Execution

## Checklist

- [x] Separate reusable composer/media/submit primitives from Group page logic.
- [x] Keep existing Group selectors and behavior stable.
- [x] Add profile-page readiness detection.
- [x] Add profile composer trigger detection.
- [x] Exclude Story, Reel, audience, and unrelated dialog controls.
- [x] Support text-only profile posts.
- [x] Support image profile posts.
- [x] Support video profile posts.
- [x] Wait for the selected media preview before submit.
- [x] Check cancellation immediately before clicking Post.
- [x] Handle Facebook interruption states.
- [x] Fail safely when the profile composer cannot be identified.

## Review Gate

Manually verify text-only publishing before testing media and before enabling
the target in the web app.

## Review Notes

```text
Status: COMPLETE

Files changed:
- apps/extension/src/profile-composer.ts
- apps/extension/src/content.ts
- apps/extension/src/background.ts
- apps/extension/manifest.json
- apps/extension/tests/profile-composer.test.cjs
- apps/extension/package.json
- features/profile-feed-publishing/progress.md

Facebook/DOM logic:
- Added separate profile-feed page proof and semantic composer-trigger lookup.
  It accepts only the canonical, expected `profile.php?id=<facebookUserId>`
  destination and excludes Story, Reel, audience, article, and dialog controls.
- The existing editor, media attachment, media-preview wait, and enabled Post
  button behavior remains shared. Group-specific trigger discovery and inline
  composer fallback continue only for Group jobs.
- Profile jobs check cancellation, request a fresh background identity check,
  and re-check the expected profile URL immediately before clicking Post.
- Identity mismatch reports `ACCOUNT_MISMATCH` and pauses only the affected
  extension connection queue.
- Profile submission waits for explicit Facebook success or interruption
  evidence. It never returns `PENDING_APPROVAL`; ambiguous acceptance is
  recorded as `UNKNOWN` pending Phase 6 permalink tracking.

Tests/checks:
- Extension TypeScript build passes.
- Extension test suite passes: 35 tests, including profile profile-page and
  composer-trigger safeguards plus existing Group publishing tests.
- `git diff --check` passes, with only existing CRLF warnings reported.

Known limitations:
- Profile permalink and feed-post matching are intentionally deferred to
  Phase 6. A profile submission with no explicit success evidence becomes
  `UNKNOWN` and is not retried automatically.
- The API delivery gate still holds profile jobs until the profile submission
  tracking path is implemented and reviewed.
```

---

# Phase 6 - Profile Submission Tracking

## Checklist

- [x] Add profile-aware publish tracking context.
- [x] Detect newly created posts for the expected profile only.
- [x] Normalize supported Facebook profile permalink shapes.
- [x] Accept explicit, job-scoped success evidence.
- [x] Save a reliable profile post URL when available.
- [x] Return `UNKNOWN` when acceptance is likely but evidence is incomplete.
- [x] Prevent `PENDING_APPROVAL` for profile jobs.
- [x] Avoid matching an old or unrelated feed post.
- [x] Avoid blind retry after an uncertain submit.
- [x] Add focused URL normalization and result-classification tests.

## Review Gate

Review captured evidence and stored URLs from text, image, and video profile
posts.

## Review Notes

```text
Status: COMPLETE

Files changed:
- apps/extension/src/profile-tracking.ts
- apps/extension/src/content.ts
- apps/extension/manifest.json
- apps/extension/package.json
- apps/extension/tests/profile-tracking.test.cjs
- features/profile-feed-publishing/progress.md

Tracking behavior:
- Added a profile-only tracking session with the expected persisted Facebook
  user ID, pre-submit post snapshot, post-submit network cutoff, and candidate
  deduplication.
- Supported and normalized owner-verified permalink shapes are
  `profile.php?id=<user>&story_fbid=<post>`,
  `permalink.php?id=<user>&story_fbid=<post>`, and numeric
  `/<user>/posts/<post>` paths. Vanity paths without verifiable ownership are
  rejected.
- DOM matches require a new article/feed unit, matching submitted content or
  media, and a normalized permalink owned by the expected profile. Existing
  and wrong-profile posts are ignored.
- Network URLs and story IDs are accepted only after the Post click and only
  after owner-aware normalization. Stored URLs are passed back in the normal
  `submissionResult`.
- Explicit success cues are compared against the pre-submit confirmation
  surfaces, keeping stale banners from satisfying a later job.
- Profile tracking never checks pending approval and never returns
  `PENDING_APPROVAL`. Missing reliable evidence remains `UNKNOWN`, so the
  existing duplicate-prevention behavior does not blindly retry it.

Tests/checks:
- Extension TypeScript build passes.
- Extension test suite passes: 37 tests, including profile permalink
  normalization and old/unrelated post rejection.
- `git diff --check` passes, with only existing CRLF warnings reported.

Known limitations:
- Facebook permalink shapes that do not expose the expected numeric owner in
  the URL are intentionally rejected until a stronger job-scoped ownership
  signal is available.
- Live Facebook text/image/video verification remains part of Phase 10 manual
  QA.
```

---

# Phase 7 - Web Target Selection

## Checklist

- [x] Add Groups and Profile feeds destination categories.
- [x] List one profile destination per FacebookConnection.
- [x] Show connection name and readiness state.
- [x] Disable unverified or unavailable profile destinations.
- [x] Allow group-only, profile-only, and mixed selections.
- [x] Submit the typed target request.
- [x] Include all destinations in selected count and validation.
- [x] Include profile destinations in schedule preview.
- [x] Explain that Facebook's current audience is used.
- [x] Preserve existing media limits and loading/error states.
- [x] Add focused UI tests where practical.

## Review Gate

Review the create flow at desktop and mobile widths before rollout.

## Review Notes

```text
Status: COMPLETE

Files changed:
- apps/web/src/components/create-post-form.tsx
- features/profile-feed-publishing/progress.md

Implementation:
- Added separate Groups and Profile feeds destination sections with mixed
  selection ordering and removable destination chips.
- Profile destinations are listed once per FacebookConnection and are selectable
  only when the connection is CONNECTED, has a persisted Facebook user ID, and
  the extension has verified the same Facebook user ID.
- Added display name, readiness state, and account suffix to profile rows,
  including disabled states for unavailable or unverified connections.
- The create request now sends typed GROUP and PROFILE_FEED targets. Counts,
  validation, schedule previews, and the selected-destination summary include
  both target types.
- Added the Facebook audience notice while preserving existing media limits,
  loading behavior, group search, and error handling.

Tests/checks:
- Web strict TypeScript check passes: `npx tsc --noEmit`.
- Web lint passes with three existing warnings: two `no-img-element` warnings
  and one unused `props` warning in the existing Select component.
- `npm run build` reached the production build but could not fetch Inter from
  `fonts.googleapis.com` in the current network environment.
- No web test harness is configured, so focused UI tests were not available in
  this phase.
- `git diff --check` passes, with only existing CRLF warnings reported.

Known limitations:
- Desktop and mobile visual review remains a manual Review Gate before rollout.
- Profile rows depend on the extension's persisted identity verification state;
  an account may remain disabled until the extension is opened on Facebook.
```

---

# Phase 8 - Post Views and Related Readers

## Checklist

- [x] Make post detail rendering target-aware.
- [x] Show connection label for profile jobs.
- [x] Show profile post links when available.
- [x] Remove unconditional `job.groupId` access.
- [x] Preserve Group job presentation.
- [x] Update post status aggregation for mixed targets if required.
- [x] Filter pending-approval sync to Group jobs.
- [x] Extend engagement sync to confirmed published profile jobs.
- [x] Audit analytics queries/populates for optional `groupId`.
- [x] Give profile jobs a clear label or exclude them from group dimensions.
- [x] Audit delete/control operations for optional `groupId`.
- [x] Add regression tests for target-aware readers.

## Review Gate

Open historical group-only posts, new profile-only posts, and mixed posts in the
web app and confirm all render correctly.

## Review Notes

```text
Status: COMPLETE

Files changed:
- apps/api/src/analytics/analytics.module.ts
- apps/api/src/analytics/analytics.service.ts
- apps/api/src/posts/jobs.controller.ts
- apps/api/src/posts/posts.service.spec.ts
- apps/api/src/posts/posts.service.ts
- apps/web/src/app/(dashboard)/posts/page.tsx
- apps/web/src/app/(dashboard)/posts/[id]/page.tsx
- apps/web/src/components/post-schedule-editor.tsx
- features/profile-feed-publishing/progress.md

Implementation:
- Populated Facebook connections alongside optional groups in the post detail
  response, so profile jobs have a stable display label and account suffix.
- Made mobile and desktop job readers branch by target type. Group links and
  approval/engagement controls remain available for Group jobs, while profile
  jobs show their profile-feed label and captured Facebook post permalink.
- Updated list and schedule views to use target labels and mixed target counts.
  - Kept pending-approval synchronization Group-only, while extending
    engagement synchronization to confirmed published profile jobs with saved
    URLs. Queue and endpoint ownership checks remain target-aware.
- Extended analytics target serialization with target type and profile
  connection labels; optional group relations remain guarded.
- Kept mixed-post status aggregation job-based, so Group and Profile Feed jobs
  contribute to the same overall execution status without dereferencing groups.

Tests/checks:
- Web strict TypeScript check passes: `npx tsc --noEmit`.
- Web lint passes with three existing warnings: two `no-img-element` warnings
  and one unused `props` warning in the existing Select component.
- API build passes: `npm run build`.
- Focused reader/control regressions pass: `posts.service.spec.ts` and
  `jobs.controller.spec.ts`, 9 tests.
- Full API Jest run has 45 passing tests and 5 pre-existing ESM setup failures
  involving `@nestjs/mongoose` under the current Jest/Node environment.
- `git diff --check` passes, with only existing CRLF warnings reported.

Known limitations:
- Desktop/mobile historical group, profile-only, and mixed-post review remains
  a manual Review Gate.
```

---

# Phase 9 - Automated Verification

## Backend Tests

- [x] Legacy Group job defaults to `GROUP`.
- [x] Profile job is valid without `groupId`.
- [x] Profile job without `facebookConnectionId` is rejected.
- [x] Connection belonging to another user is rejected.
- [x] Unverified connection is rejected.
- [x] Duplicate profile destination is rejected.
- [x] Mixed target scheduling preserves order and spacing.
- [x] Wrong extension instance cannot claim the profile job.
- [x] Profile job is excluded from pending-approval sync.
- [x] Published profile job can refresh engagement counters.

## Extension Tests

- [x] Target URL validation accepts only supported Facebook URLs.
- [x] Profile job routes to the profile executor.
- [x] Group job still routes to the Group executor.
- [x] Account mismatch stops before composer interaction.
- [x] Profile permalink normalization covers supported shapes.
- [x] Old/unrelated feed posts are not accepted as success.
- [x] Uncertain submission is not automatically retried.

## Build and Static Checks

- [x] API build passes.
- [x] Web build passes.
- [x] Extension build passes.
- [x] Focused tests pass.
- [x] Lint/typecheck passes or existing unrelated failures are documented.

## Review Notes

```text
Status: COMPLETE

- `apps/api/src/posts/create-post-targets.spec.ts`
- `apps/api/src/posts/jobs.controller.spec.ts`
- `apps/extension/tests/publishing-target.test.cjs`
- `apps/extension/tests/profile-composer.test.cjs`
- `apps/extension/tests/profile-tracking.test.cjs`
- `features/profile-feed-publishing/progress.md`

- Focused API Jest: 5 suites passed, 36 tests passed, including the profile
  queue-claim regression.
- Full API Jest: 9 suites passed, 50 tests passed; 5 unrelated suites remain blocked by the existing Jest/CommonJS versus `@nestjs/mongoose` ESM setup error.
- Extension tests: 5 files, 37 tests passed.
- API build passed.
- Web production build passed.
- Extension build passed.
- Web typecheck passed.
- Web lint passed with three existing warnings: two `next/no-img-element` warnings and one unused `props` warning in the existing Select component.
- `git diff --check` passed; only existing CRLF warnings were reported.
- Follow-up manual QA found that `/api/jobs/next` still used the old
  Group-only delivery filter. The filter now accepts GROUP, PROFILE_FEED, and
  legacy jobs, while Group-only sync filters remain unchanged.

Known limitations:
- The extension test harness validates the target-specific helpers, composer selection, identity gating, and permalink tracking in isolation. It does not launch a Chrome service worker against a live Facebook document, so browser-level routing and final profile-video completion remain part of Manual Facebook QA.
```

---

# Phase 10 - Manual Facebook QA

## Basic Publishing

- [ ] Text-only profile post publishes once.
- [ ] Single-image profile post publishes once.
- [ ] Multi-image profile post respects existing limits.
- [ ] Video profile post publishes or reports a safe uncertain state.
- [ ] Detected permalink opens the expected post.
- [ ] Facebook audience is not changed by PostFlow.

## Queue and Scheduling

- [ ] Scheduled profile job is not claimed early.
- [ ] Profile and Group jobs execute in `flowOrder` for one connection.
- [ ] Two Chrome profiles process only their assigned jobs.
- [ ] One blocked profile does not stop another connection.
- [ ] Extension restart respects the lease and does not duplicate a post.

## Safety and Interruptions

- [ ] Logout reports `LOGIN_REQUIRED`.
- [ ] Wrong account reports `ACCOUNT_MISMATCH` before content entry.
- [ ] CAPTCHA/checkpoint pauses only the affected connection.
- [ ] Cancel before submit prevents the Facebook Post click.
- [ ] Missing composer fails without clicking unrelated controls.
- [ ] Network uncertainty does not cause an automatic duplicate.

## Regression

- [ ] Existing immediate Group publishing still works.
- [ ] Existing scheduled Group publishing still works.
- [ ] Group pending-approval sync still works.
- [ ] Group engagement sync still works.
- [ ] Historical Group post details still render.

## Review Notes

```text
Status: BLOCKED - PARTIAL QA ONLY

- Local web dev server: `http://localhost:3000` responded with HTTP 200 and redirected `/posts` to the sign-in page.
- API service: `http://localhost:8000` was not running in this environment.
- Facebook account/session: not available for authenticated publishing.
- In-app browser bridge: unavailable because the browser connection was missing required sandbox metadata.

- No Facebook-specific checklist item is marked complete without an authenticated Facebook session.
- Automated verification from Phase 9 remains green for the target model, routing helpers, composer selection, identity checks, permalink tracking, and retry guards.
- Local web route smoke check passed; it confirms the app is reachable but does not verify post creation or publishing.
- The first manual profile-feed attempt exposed a real queue issue: `/api/jobs/next`
  was still filtering out PROFILE_FEED jobs. That delivery filter has now been
  fixed and covered by a profile queue-claim regression test.
- A later authenticated profile-feed attempt reached the Facebook profile tab and
  passed account identity checks, then failed because profile page/composer
  readiness was too strict. The profile content script now waits longer for the
  real profile shell, waits separately for the composer trigger, and accepts
  composer triggers inside Facebook's `ProfileComposer` pagelet even when it is
  rendered as an article-like card.
- Follow-up verification after the readiness fix: extension build passed and
  extension Node tests passed, including the new `ProfileComposer` article-card
  regression.
- A later group-sync attempt returned HTTP 500 from `/api/groups/sync` after
  connection ownership was added to groups. The API now claims legacy unowned
  group rows for the verified connection during sync and returns an actionable
  conflict if Mongo still has a stale unique group index.
- Follow-up live log showed Mongo code 40 because `facebookConnectionId` was in
  both `$set` and `$setOnInsert` during the upsert. The sync update now keeps it
  only in `$set`, which still applies to inserts and updates without path
  conflict.
- After the API returned the intentional HTTP 409 legacy-index guard, ran
  `npm run repair-indexes` successfully on 2026-10-01. It dropped
  `clerkUserId_1_externalId_1` and ensured
  `clerkUserId_1_facebookConnectionId_1_externalId_1`.
- Live profile-video QA published the video but returned `UNKNOWN`, and a
  following Group publish could capture an older post permalink. Publication
  network evidence is now limited to `story_create` responses whose requests
  started inside the active job's final-submit window, preventing delayed
  profile/group responses from crossing job boundaries.
- Media-only DOM matching now requires a fresh Facebook timestamp before using
  a permalink. An undated video card can no longer donate an old URL. When a
  profile video closes the composer successfully but Facebook never exposes a
  reliable permalink, the result is `PUBLISHED` without inventing a post URL.
- Follow-up verification: the development extension build passed and all 42
  extension tests passed, including request-boundary and stale media-card
  regressions.
- A following profile-video run completed as `PUBLISHED` but logged zero
  network URL candidates. Facebook supplied the video identity in the encoded
  `ComposerStoryCreateMutation` request rather than as `feed_fbids` in the
  response. The network spy now carries that `video_id` through only after the
  matching mutation succeeds, and profile tracking stores the owner-scoped
  `/{facebookUserId}/videos/{videoId}/` permalink. GraphQL error responses do
  not expose request metadata as publication evidence.
- A subsequent account-specific run still exposed no network candidate. The
  profile DOM fallback had found the new video card but rejected its permalink
  because Facebook had not hydrated a timestamp. After the profile video
  composer closes, tracking may now accept an undated owner-matching video URL
  only when its element and normalized permalink were both absent before final
  submit. Group media-only matching remains timestamp-strict.
- The next fresh run still returned `PUBLISHED` without a URL. Profile video
  tracking now recognizes Facebook's reel, watch, share-video, vanity-profile
  post, and vanity-profile video permalink shapes after confirmed submission.
  Those same shapes are included in the pre-submit snapshot, and a processing
  card may use its new permalink as media evidence before a `<video>` element
  appears. A `profile_post_url_not_found` diagnostic step now reports article
  and anchor counts plus sanitized candidate path shapes when no URL is found.
- The captured live Facebook `TimelineFeedUnit_0` markup confirmed that profile
  videos use a timestamp permalink shaped as `/reel/{videoId}/` and expose the
  same identity through `data-video-id`. Running that exact pasted DOM through
  `findPublishedProfilePost` now returns
  `https://www.facebook.com/reel/1636327731333442/`.
- A new 18:30 profile-video run still completed before a permalink was captured.
  The live markup also exposes `data-video-id="1636327731333442"` inside the
  article. Profile tracking now derives the same `/reel/{videoId}/` URL from a
  new post card's `data-video-id` before Facebook hydrates its timestamp link;
  pre-submit cards are snapshotted through this path as well. The profile-video
  permalink window is now 180 seconds and returns earlier as soon as the reel
  identity appears; Group video timing is unchanged.
- The captured Facebook processed-video notification exposes the canonical reel
  identity in an anchor with
  `notif_t=fb_shorts_video_processed`. Profile-video jobs now snapshot existing
  processed notification IDs and reel URLs before navigating to the composer.
  After Facebook accepts the video, the job is first persisted as `PUBLISHED`
  without a URL, then a separate inactive notifications tab waits for a link
  absent from that snapshot. Notification query parameters are removed and the
  same successful job is updated with `https://www.facebook.com/reel/{id}/`.
  The queue remains serialized during reconciliation, Group publishing is not
  routed through this flow, and a failed baseline causes URL recovery to be
  skipped rather than risking an old reel.
- Follow-up automated verification: the development extension build passed and
  all 54 extension tests passed, including processed notification parsing,
  canonicalization, deduplication, and rejection of ordinary reel links.
  Running the supplied live notification markup through the parser returned
  `https://www.facebook.com/reel/1096008889716174/` with notification ID
  `1790880757718638`.
- A later live notification-panel capture contained the newest processed reel
  as `https://www.facebook.com/reel/1490054189671164/` with notification ID
  `1790881842144242`, followed by older processed-video notifications. The
  active profile tab now scans for this semantic link while video processing is
  still in progress and accepts it only when both its notification identity and
  canonical reel URL were absent from the pre-publish snapshot. The inactive
  notifications-page scan remains the fallback if the transient on-page notice
  is missed.
- The same run exposed duplicate publishing risk. `EXECUTE_JOB` now has an
  explicit content-script acknowledgement and is never force-delivered again
  after acceptance, even if Facebook replaces the document. As soon as the
  profile composer supplies accepted-video evidence, the API job is persisted
  as `SUCCESS` / `PUBLISHED` without waiting for the reel URL, so a sleeping or
  restarted extension worker cannot later reclaim that job and publish it
  again. The content script keeps the active reconciliation alive while it
  waits to enrich the same job with the notification URL.
- Follow-up automated verification: the development extension build passed and
  all 65 extension tests passed. The added engagement tests cover profile reel
  identity matching, unrelated dialogs, direct viewers without article or
  identity markup, and rejection of ambiguous control pairs. The notification
  tests cover new-vs-baseline selection and rejection of an old reel whose
  notification query parameters changed.
- Profile engagement synchronization is now enabled for published jobs with a
  saved permalink. The API engagement queue accepts both target types, the
  update endpoint persists counters for profile jobs, and the web post detail
  view exposes the same refresh control for profile and Group posts. The shared
  Facebook extractor now matches Group post identities, profile post/video
  identities, and reel URLs; profile reel and `data-video-id` regressions are
  covered by the extension suite.
- The extractor now continues past unrelated visible dialogs and accepts a
  direct reel page only when it has one unique visible engagement-control
  scope. This resolves `targetFound=false` for profile reel pages without
  weakening the existing ambiguity protection.
- Extractor `v8` also recognizes matching reel links and `data-video-id`
  elements inside Facebook reel dialogs or main viewers that omit the usual
  `role="article"` wrapper. When all identity markup is absent, it derives the
  viewer scope from one unique visible Like/Comment control pair.
- Extractor `v9` recognizes Facebook's active Arabic reaction labels such as
  `إزالة أعجبني` and keeps each action's numeric counter isolated. The supplied
  reel-player layout now extracts one reaction and zero comments without
  borrowing the reaction count for the comment count.
- Extractor `v10` classifies a completely empty Facebook target shell after a
  short grace period. The background worker retries that same permalink once
  in a foreground tab, then restores the previously active tab. This preserves
  the existing Group extraction rules while recovering from Facebook's
  inactive-tab rendering suppression.

Known limitations:
- Manual Facebook QA still requires a logged-in Facebook account, a running API service with the required backing services, and a functioning browser bridge or a user-run browser session.
```

---

# Phase 11 - Rollout and Cleanup

## Checklist

- [ ] Add a server-side or environment rollout switch.
- [ ] Confirm disabling creation does not strand queued profile jobs.
- [ ] Remove temporary debug logging.
- [ ] Confirm logs contain no content, media data, cookies, or secrets.
- [ ] Document supported profile post/media behavior.
- [ ] Document that Facebook's current audience is used.
- [ ] Update extension description if appropriate.
- [ ] Update this progress file with final verification.
- [ ] Mark the feature complete only after manual Facebook QA.

## Review Notes

```text
Status: NOT STARTED

Files changed:

Rollout:

Tests/checks:

Known limitations:
```

---

# Progress Summary

| Phase                                       | Status      | Reviewed |
| ------------------------------------------- | ----------- | -------- |
| 0. Existing implementation review           | Complete    | No       |
| 1. Target model and migration compatibility | Complete    | No       |
| 2. Create-post API and job creation         | Complete    | No       |
| 3. Target-aware queue payload               | Complete    | No       |
| 4. Extension target routing                 | Complete    | No       |
| 5. Profile composer execution               | Complete    | No       |
| 6. Profile submission tracking              | Complete    | No       |
| 7. Web target selection                     | Complete    | No       |
| 8. Post views and related readers           | Complete    | No       |
| 9. Automated verification                   | Complete    | No       |
| 10. Manual Facebook QA                      | In Progress | No       |
| 11. Rollout and cleanup                     | Not Started | No       |

---

# Implementation Workflow

For each implementation session:

1. Read `features/profile-feed-publishing/feature.md`.
2. Read this progress file.
3. Select the first incomplete phase unless the user asks for another phase.
4. Inspect all current code touched by that phase.
5. Implement and verify only that phase.
6. Update its checklist and Review Notes.
7. Update the Progress Summary.
8. Provide a short review summary and stop for review.

---

# Review Summary Template

```text
Phase completed:

Files changed:

Implementation:

Facebook/DOM logic:

Backend/API changes:

Tests/checks:

Known limitations:

Progress file updated:
Yes

Ready for review:
Yes
```
