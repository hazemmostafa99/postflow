# Multi-Platform Extension Publishing

## Goal

Turn the existing Facebook-focused Chrome extension into a platform-aware
publishing worker that can publish PostFlow jobs to:

```text
Facebook Groups
Facebook Profile Feeds
Instagram Feed
Instagram Reels
TikTok Video Posts
TikTok Photo Posts
```

Publishing to Instagram and TikTok must be performed by the browser extension
through the authenticated website sessions already open in the same Chrome
Profile. This feature does not depend on the official Instagram or TikTok
publishing APIs.

The implementation order is mandatory:

```text
1. Refactor jobs and connections for multiple platforms
2. Preserve and verify existing Facebook publishing
3. Deliver an Instagram MVP
4. Stabilize Instagram in real browser testing
5. Deliver a TikTok video and photo MVP using the same platform adapter contract
```

---

## Existing-System Rule

Do not rewrite the current Facebook implementation and do not build a second
unrelated queue.

The existing Post, PublishingJob, scheduling, leasing, cancellation, status
aggregation, extension installation identity, and worker credential behavior
remain the foundation.

The target architecture is:

```text
PostFlow web app
    -> API creates one PublishingJob per destination
        -> job is assigned to a platform connection
            -> the owning extension installation claims the job
                -> background worker selects a platform adapter
                    -> platform content script publishes
                        -> extension reports the result to the API
```

Existing Facebook Group and Profile Feed publishing must continue working
throughout every phase.

---

## Product Decision

Instagram and TikTok publishing will use extension-driven browser automation.

The PostFlow backend API is still required for:

- authenticated web and extension communication
- connections and ownership
- post creation and media delivery
- job scheduling and leasing
- status updates and cancellation
- diagnostics and history

"No platform API" means PostFlow does not require the official Instagram or
TikTok publishing APIs. It does not mean removing the existing PostFlow API.

---

## Core Design Principles

1. Facebook behavior must not be weakened to accommodate another platform.
2. Each platform owns its selectors, navigation, composer behavior, result
   detection, and interruption detection.
3. Shared orchestration belongs in the background worker, not in a giant
   cross-platform content script.
4. A job is always bound to an explicit connection and expected account.
5. The extension must verify the active platform account before the final
   publish action.
6. Uncertain submission results must not be blindly retried.
7. CAPTCHA, checkpoint, verification, or suspicious-activity screens require
   manual intervention. The extension must not attempt to bypass them.
8. Platform failures and pauses must be isolated. An Instagram interruption
   must not pause healthy Facebook or TikTok connections.
9. DOM selectors must prefer semantic roles, accessible labels, stable URLs,
   and visible structure. Localized text may be a fallback, not the only
   selector strategy.
10. Every new platform is released behind its own feature flag.

---

## Scope

### Architecture refactor

- add a platform discriminator to publishing jobs and payloads
- introduce a generic platform-connection contract
- allow one extension installation to own one connection per supported
  platform account
- make job claiming installation-aware and platform-aware
- route jobs to isolated platform adapters
- make lifecycle, health, queue pauses, and diagnostics platform-scoped
- keep legacy Facebook records and jobs readable during migration

### Instagram MVP

- detect and connect the currently authenticated Instagram account
- publish a text caption with one image or a 2–4 image Feed carousel
- publish one supported video as an Instagram Reel
- provide one Instagram account selector in the dashboard; infer Photo,
  Carousel, or Reel from the attached media and show the inferred type
- preserve account selection when media changes; accept one image, 2–4 images,
  or one video, and reject mixed media or multiple videos before job creation
- keep explicit INSTAGRAM_FEED/INSTAGRAM_REEL jobs and backend validation;
  share the existing stage-aware composer rather than duplicate flows
- support immediate and scheduled jobs
- verify the expected Instagram account before submission
- report success, uncertain success, logout, account mismatch, platform
  interruption, and failure
- save a stable post or Reel URL when it can be detected reliably

### TikTok MVP

- detect and connect the currently authenticated TikTok account
- publish one supported video or a photo post with 1 to 4 images and a caption
- support immediate and scheduled jobs
- verify the expected TikTok account before submission
- preserve the current TikTok publishing options unless PostFlow explicitly
  controls and verifies an option
- report upload, processing, success, uncertain success, logout, account
  mismatch, platform interruption, and failure
- save a stable post URL when it can be detected reliably

### Published-post engagement sync

Extend the existing published-post engagement maintenance flow to support
TikTok Video and Photo posts when a stable permalink is available. The Chrome
extension must use the authenticated TikTok session in the same Chrome Profile
to open the specific post and read its visible action bar. It must not click or
toggle any engagement control.

Collect these visible counters when TikTok exposes them:

```text
like-count      -> engagement.reactionCount (displayed as likes for TikTok)
comment-count   -> engagement.commentCount
favorite-count  -> engagement.favoriteCount
share-count     -> engagement.shareCount
```

Prefer TikTok's stable `data-e2e` attributes and semantic labels over generated
CSS class names. Normalize supported compact counts such as `1.2K`; a button
whose label is only `Share` has no confirmed share count and must remain
unknown. Missing or unreadable values must not be stored as zero, and partial
updates must preserve the last known value for every undetected counter.

Use the existing engagement queue, scheduling, retry/backoff, single-flight
locking, and manual refresh path. Process posts sequentially and isolate a
failed TikTok post from the rest of the batch. Only successfully published
posts with a valid TikTok permalink are eligible. Automatic TikTok analytics
must have a platform-specific rollout control independent of TikTok publishing;
manual refresh must use the same extractor and persistence path.

This extends the current engagement record with optional favorite and share
counts. The post details UI must label TikTok's `reactionCount` as likes and
show favorites and shares when known; Facebook and Instagram labels retain
their existing meaning.

---

## Non-Goals

- Instagram or TikTok official publishing API integration
- Instagram Stories in the first release
- TikTok Stories in the first release
- editing published posts
- deleting posts from a platform
- automatically adding music, filters, stickers, tags, locations, products,
  collaborators, or branded-content declarations
- changing account privacy or platform-wide settings
- automating CAPTCHA, identity verification, checkpoints, or security
  challenges
- hiding automation, defeating platform detection, or bypassing platform
  limits
- parallel publishing inside one extension installation in the first release
- a separate analytics subsystem, historical engagement charts, comment
  bodies/authors/replies, reaction-type breakdowns, or sentiment analysis;
  platform counters use the existing engagement maintenance flow
- replacing the existing Facebook pending-approval or engagement flows

---

## Terminology

### Platform

```ts
enum PublishingPlatform {
  FACEBOOK = "FACEBOOK",
  INSTAGRAM = "INSTAGRAM",
  TIKTOK = "TIKTOK",
}
```

### Target type

The specific publishing surface within a platform:

```ts
enum PublishingTargetType {
  GROUP = "GROUP",
  PROFILE_FEED = "PROFILE_FEED",
  INSTAGRAM_FEED = "INSTAGRAM_FEED",
  INSTAGRAM_REEL = "INSTAGRAM_REEL",
  TIKTOK_VIDEO = "TIKTOK_VIDEO",
  TIKTOK_PHOTO = "TIKTOK_PHOTO",
}
```

Existing `GROUP` and `PROFILE_FEED` values remain unchanged for backward
compatibility.

### Platform connection

A durable PostFlow record that binds:

- one PostFlow user
- one platform
- one expected external account identity
- one active extension installation
- connection lifecycle and platform health

### Platform adapter

An extension module implementing the navigation and publishing behavior for
one platform without exposing its DOM details to other adapters.

---

## Target Architecture

```text
Extension background worker
|
+-- shared worker orchestration
|   +-- claim one job
|   +-- verify lease and cancellation
|   +-- select adapter
|   +-- open or reuse an allowlisted platform tab
|   +-- wait for the correct document
|   +-- dispatch execution
|   +-- collect result
|   +-- update backend status
|
+-- platforms/facebook
|   +-- existing group adapter
|   +-- existing profile adapter
|   +-- existing Facebook tracking and maintenance
|
+-- platforms/instagram
|   +-- session and identity detection
|   +-- feed composer
|   +-- reel composer
|   +-- interruption detection
|   +-- result and permalink detection
|
+-- platforms/tiktok
    +-- session and identity detection
    +-- video upload composer
    +-- processing detection
    +-- interruption detection
    +-- result and permalink detection
```

No Instagram or TikTok selector may be added to the Facebook content script.

## Extension Code Organization Contract

The extension must stay small, navigable, and reusable. A platform feature is
not allowed to grow by appending more branches to `background.ts`,
`content.ts`, or a shared catch-all utility file.

### Target folder structure

This is the required structure for new Instagram and TikTok code. The current
Facebook implementation is a legacy zone for this feature: do not perform a
large move or rewrite while the Facebook regression gate is still open. A
later cleanup may migrate those files incrementally behind compatibility
re-exports.

```text
apps/extension/src/
├── background/
│   ├── index.ts                  # one service-worker entrypoint
│   ├── orchestrator.ts           # claim -> execute -> report
│   ├── message-router.ts         # runtime message dispatch only
│   ├── tab-manager.ts            # allowlisted tab lifecycle
│   └── execution-context.ts      # one active job + stale-message guards
├── shared/
│   ├── api/api-client.ts         # authenticated API calls
│   ├── jobs/job-types.ts         # normalized job/result types
│   ├── jobs/job-state.ts         # cancellation/lease helpers
│   ├── platform/adapter.ts       # adapter contract and shared steps
│   ├── platform/registry.ts      # adapter registration and lookup
│   ├── chrome/runtime.ts         # small Chrome Promise wrappers
│   ├── chrome/storage.ts         # typed storage helpers
│   ├── media/media-types.ts      # media contracts, no DOM selectors
│   ├── diagnostics/logger.ts     # redacted structured diagnostics
│   └── config/feature-flags.ts   # platform flags and safe defaults
├── platforms/
│   ├── facebook/
│   │   ├── adapter.ts            # Facebook adapter facade
│   │   ├── content.ts             # Facebook content-script entrypoint
│   │   ├── identity.ts            # session/account detection
│   │   ├── selectors.ts           # Facebook selectors only
│   │   ├── composers/             # group/profile composer flows
│   │   ├── tracking/              # pending/engagement tracking
│   │   └── index.ts               # public Facebook module API
│   ├── instagram/
│   │   ├── adapter.ts
│   │   ├── content.ts
│   │   ├── identity.ts
│   │   ├── selectors.ts
│   │   ├── composer.ts             # split Feed/Reel only when needed
│   │   ├── result.ts
│   │   └── index.ts
│   └── tiktok/
│       ├── adapter.ts
│       ├── content.ts
│       ├── identity.ts
│       ├── selectors.ts
│       ├── composer.ts
│       ├── result.ts
│       ├── engagement.ts          # published-post counter extraction
│       └── index.ts
├── maintenance/                  # non-publishing maintenance workers
├── phone-collector/               # isolated existing feature
└── popup/                         # popup UI only
```

Do not create empty placeholder files. A folder gets a new module only when
that responsibility has real behavior or tests. Small related functions stay
together; the rule is one cohesive responsibility per module, not one file
per function.

### Dependency direction (strict)

```text
entrypoints (background/content/popup)
        -> orchestration and feature services
        -> shared contracts and wrappers
        -> platform modules
```

The following rules are mandatory:

- `shared/` is platform-neutral and cannot import from `platforms/`.
- A platform module cannot import another platform module.
- Content scripts cannot import the background entrypoint or call API helpers
  directly; they communicate through typed runtime messages.
- Platform selectors, URLs, identity rules, composers, and result detection
  stay inside that platform folder.
- The background worker owns queue orchestration, leases, cancellation,
  active-job state, tab lifecycle, and API status reporting only.
- `platforms/*/adapter.ts` is the only platform surface imported by the shared
  orchestrator. DOM implementation details are private to the platform.
- There must be no circular imports. In particular, the background entrypoint
  must not be imported by the orchestrator or an adapter.
- Every cross-folder import must use the folder's `index.ts` public API; do
  not import another module's private selector or helper file.

### Reuse and size rules

- Reusable Chrome, API, storage, timeout, URL, media, and redacted-logging
  helpers belong in `shared/`; do not duplicate wrappers in each platform.
- A helper is shared only when it is genuinely platform-neutral. Do not move
  Facebook behavior into `shared/` just to shorten a file.
- No module may exceed 300 lines without a progress-note justification and a
  follow-up split task. Entrypoints and public facades should stay below 150
  lines.
- No function should exceed 40 lines or have more than four levels of nested
  control flow without an explicit exception in the progress file.
- A platform adapter must be a thin coordinator. Composer steps, selectors,
  identity detection, interruption detection, and result parsing are separate
  private modules once they become independently testable.
- Do not add platform-specific conditionals to shared modules. Use an adapter
  or a platform strategy instead of `if (platform === ...)` branches.
- New reusable code requires a focused unit test or a sanitized DOM fixture;
  dead generic helpers and catch-all `utils.ts` files are prohibited.

### New-code and legacy-code rule

Instagram and TikTok must start in their platform folders and use the shared
contracts without adding branches to the legacy Facebook files. The existing
Facebook files remain operational until the regression gate is approved. Do
not create a second worker or a second Facebook implementation.

When the later Facebook cleanup begins, move one responsibility at a time
behind the existing entrypoint, preserve the old import as a temporary
re-export when needed, and delete it only after the new path has build/test
coverage. Each migration step must record:

1. source file moved or split,
2. public API kept stable,
3. tests/build checks run, and
4. remaining legacy files and their deletion condition.

The Facebook splits (`background.ts`, `platform-adapter.ts`,
`publishing-target.ts`, and Facebook tracking/composer files) are deferred
cleanup work, not a prerequisite for the Instagram MVP. New platform code
must still avoid importing Facebook private implementation files.

---

## Data Model

### PlatformConnection

Introduce a generic connection model conceptually shaped as:

```ts
class PlatformConnection {
  clerkUserId: string;
  platform: PublishingPlatform;
  extensionInstallationId: Types.ObjectId;

  displayName?: string;
  externalAccountId?: string;
  externalUsername?: string;
  detectedExternalAccountId?: string;
  detectedExternalUsername?: string;

  status: PlatformConnectionStatus;
  workerStatus: PlatformWorkerStatus;
  sessionDetected: boolean;
  lastSeenAt: Date;

  archivedAt?: Date;
}
```

The implementation may introduce a new collection or evolve the current
connection model, but it must meet these invariants:

- platform is explicit and immutable after the connection is established
- connection ownership is verified by the backend
- an active job references exactly one connection
- expected and detected account identities are stored separately
- one installation may have separate Facebook, Instagram, and TikTok
  connections
- one connection has only one active installation binding
- a connection interruption does not mutate another platform connection

If a stable numeric account ID cannot be detected reliably from the website,
the canonical username may be used as the first-release identity. The UI must
explain that changing the username requires reconnecting or re-verification.

### PublishingJob

Conceptual target schema:

```ts
class PublishingJob {
  postId: Post;
  platform: PublishingPlatform;
  targetType: PublishingTargetType;
  platformConnectionId?: Types.ObjectId;

  // Facebook compatibility during migration
  groupId?: Group;
  facebookConnectionId?: Types.ObjectId;

  status: PublishingJobStatus;
  submissionStatus?: SubmissionStatus;
  externalPublishId?: string;
  externalPostId?: string;
  postUrl?: string;
  submissionReason?: string;

  claimedByExtensionInstanceId?: string;
  claimExpiresAt?: Date;
  attempts: number;
  flowOrder: number;
  scheduledFor?: Date;
}
```

Required compatibility behavior:

- a legacy job without `platform` is treated as `FACEBOOK`
- existing Facebook target types keep their current meanings
- existing `facebookConnectionId` ownership remains valid during migration
- new Instagram and TikTok jobs require `platformConnectionId`
- new code must not require `groupId` for non-group jobs
- Facebook-only submission and maintenance fields must not be applied to
  Instagram or TikTok jobs

### Submission status

Move toward platform-neutral statuses:

```ts
type SubmissionStatus =
  | "UPLOADING"
  | "PROCESSING"
  | "PUBLISHED"
  | "PENDING_APPROVAL"
  | "UNKNOWN"
  | "FAILED";
```

`PENDING_APPROVAL` remains valid only where the existing Facebook Group flow
supports it.

---

## Connection and Session Flow

1. The extension installation authenticates to PostFlow using the existing
   installation identity and credential.
2. The popup shows separate cards for Facebook, Instagram, and TikTok.
3. The user opens or signs in to the desired platform in the same Chrome
   Profile.
4. The corresponding content script detects the active account using the
   strongest reliable identity available.
5. The extension reports the detected platform identity to the backend.
6. For a first-time Instagram/TikTok session, the backend creates a new
   connection from the verified detected identity automatically. If that
   identity already belongs to another installation, the backend returns a
   recovery-required state instead of moving the binding silently.
7. An explicit dashboard/reconnect action is used only for recovery, account
   replacement, or a deliberate new connection choice.
8. Before every final publish action, the content script detects the account
   again and compares it with the job's expected connection identity.

The extension must never publish merely because some account is logged in.

### Phase 3 Instagram session detection contract

The first Instagram implementation must be isolated under
`apps/extension/src/platforms/instagram/` and must not add Instagram DOM
selectors to the legacy Facebook content script. Its initial modules are:

```text
platforms/instagram/
├── identity.ts   # pure, sanitized DOM identity detector
├── content.ts    # tiny content-script entrypoint and runtime message
└── worker.ts     # validated background-to-API session bridge
```

Session state and background coordination live in reusable `session-state.ts`
and `session-manager.ts` modules; `worker.ts` remains a thin runtime bridge.
The detector must identify the signed-in viewer, not a public profile or post
owner. English/Arabic own-profile navigation is supported; canonical/Open
Graph/pathname fallback requires a self-profile Edit profile control. A username
is normalized and never treated as a numeric account ID.

The content script emits an observation trigger and answers
`INSTAGRAM_GET_SESSION_EVIDENCE` with sanitized current-document evidence.
It must not receive PostFlow credentials or call the API directly. The background
re-queries the sending top-level document by Chrome document ID, validates its
current URL/navigation generation, and serializes all backend session writes.
Closed, replaced, or navigated documents cannot authorize publishing.

State distinguishes VERIFIED, CHECKING, LOGIN_REQUIRED, ACCOUNT_MISMATCH, and
STALE. CHECKING is not negative authentication evidence and cannot erase a fresh
verified session. Only an explicit login route establishes LOGIN_REQUIRED.
Previously observed documents are revoked after logout/mismatch and must reload
before restoring verification. Cached proof lasts at most 60 seconds; a single
minute alarm expires persisted proof after worker restarts or when tabs close.
Content observations refresh every 15 seconds. Backend evidence metadata is
stored separately from existing connection/worker enums; STALE blocks claims
using PENDING, not LOGIN_REQUIRED. Legacy Instagram false reports are treated as
CHECKING, while Facebook/TikTok boolean behavior remains unchanged.

Before Share, the publishing document itself must provide current matching
evidence both before and after the asynchronous job-status check. A fresh cache
from an unrelated analytics tab is never sufficient authorization. Failure to
read/persist proof fails closed; uncertain authentication is not auto-login.

The worker validates that the message originated from an Instagram tab, then
reports it to `POST /api/extensions/platform-session`. The backend verifies
the installation credential and updates the matching Instagram
`PlatformConnection`. When the installation has no Instagram connection and
the session includes a normalized username, the backend creates the first
connection automatically (`CONNECTED`/`IDLE`) using `Instagram @username` as
the default display name. It stores detected identity separately from expected
identity, marks a mismatch as `ACCOUNT_MISMATCH`, and never moves an existing
connection from another installation automatically. Existing-account recovery
and deliberate replacement remain explicit dashboard actions.

The first explicit connection API is intentionally narrow:

```text
GET  /api/extensions/installations
POST /api/extensions/platform-connections
     { platform, installationId, displayName, externalUsername }
```

Only an authenticated PostFlow user may use these routes. The API currently
accepts `INSTAGRAM` only, rejects duplicate active installation/account
bindings, and keeps the explicit create route as a recovery/manual fallback.
Normal first-time setup does not require this route: opening Instagram in the
same profile lets the worker create the connection automatically. The web app
and popup show the resulting state, while the Instagram publishing selector
remains disabled until live verification is complete.

The manifest may add only `https://instagram.com/*` and
`https://www.instagram.com/*` for this phase. The
Instagram feature flag remains disabled for publishing until connection
creation, popup/dashboard state, and sanitized identity fixtures are complete.

### Account mismatch

If the detected account does not match the connection:

- stop before opening or submitting the composer when possible
- never click the final publish button
- report `ACCOUNT_MISMATCH`
- pause only that platform connection
- keep other platform connections eligible for work

---

## Job Creation Contract

The web app sends explicit destinations:

```ts
type CreatePostTarget =
  | { type: "GROUP"; groupId: string }
  | { type: "PROFILE_FEED"; connectionId: string }
  | { type: "INSTAGRAM_FEED"; connectionId: string }
  | { type: "INSTAGRAM_REEL"; connectionId: string }
  | { type: "TIKTOK_VIDEO"; connectionId: string }
  | { type: "TIKTOK_PHOTO"; connectionId: string };
```

The backend derives `platform` from the validated target type and persisted
connection. It must not trust a client-supplied external account identity.

Validation requirements:

- at least one destination is required
- duplicate destinations are rejected
- every connection belongs to the authenticated PostFlow user
- target type and connection platform must agree
- the selected connection must be active and identity-bound
- media must satisfy every selected destination
- unsupported mixed-media combinations fail before jobs are created
- the API creates one job per destination
- scheduling and `flowOrder` apply across the complete destination list

---

## Job Claim and Delivery

Refactor worker authorization into two separate checks:

```text
1. Is this a valid, active extension installation?
2. Does this installation own a healthy connection for this job's platform?
```

The current Facebook-session check must not remain the universal gate for all
jobs.

First-release concurrency rule:

- one extension installation processes at most one publishing job at a time
- jobs from all platforms share the existing ordered schedule
- different Chrome Profiles/installations may continue working in parallel

Conceptual payload:

```ts
type PublishJobPayload = {
  id: string;
  platform: PublishingPlatform;
  post: {
    content: string;
    media: PublishMedia[];
  };
  target:
    | FacebookGroupTarget
    | FacebookProfileTarget
    | InstagramFeedTarget
    | InstagramReelTarget
    | TikTokVideoTarget;
};
```

The target payload includes only backend-derived, allowlisted navigation data
and the expected account identity.

---

## Extension Adapter Contract

Each platform adapter should satisfy a contract equivalent to:

```ts
interface PlatformPublisherAdapter {
  platform: PublishingPlatform;

  validateJob(job: PublishJob): ValidationResult;
  getTargetUrl(job: PublishJob): string | null;
  verifyActiveAccount(job: PublishJob): Promise<AccountVerificationResult>;
  waitForReady(tabId: number, job: PublishJob): Promise<boolean>;
  execute(tabId: number, job: PublishJob): Promise<PublishResult>;
  normalizePostUrl(value: string): string | null;
}
```

The shared background orchestrator owns:

- claim and lease management
- cancellation checks
- tab creation/reuse
- timeout cleanup
- stale-message protection
- result reporting
- queue continuation

Each adapter owns:

- platform URL allowlisting
- identity detection
- page readiness
- composer discovery
- caption insertion
- media attachment
- publish-button validation
- interruption detection
- success and permalink detection

---

## Media Transport

The current post model stores Base64 data URLs and sends them inside the job
payload. Keep this readable for Facebook compatibility, but do not require a
large Instagram or TikTok video to travel through repeated Chrome messages.

Before TikTok rollout, introduce a media-delivery contract that allows the
extension to fetch job media as a Blob using an authenticated, short-lived,
job-scoped request.

Requirements:

- media access is authorized against the claimed job and installation
- a URL or token expires and cannot be reused for another job
- platform pages never receive PostFlow credentials
- the content script converts the fetched Blob into a `File` for the target
  file input
- large payloads are not copied repeatedly between background and content
  script
- logs never include Base64 content, signed media URLs, or file bytes
- cancellation before final submit releases temporary media references where
  applicable

The Instagram MVP may initially use current media limits if verified stable,
but the TikTok MVP must use the safer media-delivery path.

---

## Manifest and Content Scripts

Add narrowly scoped host permissions and content scripts for:

```text
https://www.instagram.com/*
https://www.tiktok.com/*
```

Do not use unrestricted `<all_urls>` access.

Each platform must have an independent content-script bundle. Shared pure
utilities may be reused, but platform state and selectors must not leak across
bundles.

The extension popup must explain why each platform permission is required and
show whether a session and matching account were detected.

---

## Instagram MVP Behavior

### Supported targets

```text
INSTAGRAM_FEED
INSTAGRAM_REEL
```

### Feed post

The first release supports:

- one image or a 2–4 image carousel (images only)
- an optional caption
- the existing schedule and cancellation flow

The adapter must:

1. navigate only to an allowlisted Instagram URL
2. verify the active account
3. open the create flow
4. choose the correct Feed/Post surface
5. attach the image set and wait for every visible preview
6. advance only through the expected composer steps
7. insert and verify the caption
8. re-check cancellation and account identity
9. click Share once
10. wait for reliable success, interruption, or timeout evidence

### Reel

The first release supports:

- one video within PostFlow's validated limits
- an optional caption
- no music, effects, collaborators, location, or cover editing

The adapter must not accidentally select Story creation or a different
publishing surface.

### Instagram success

Reliable success evidence may include:

- a platform success message tied to the active submission
- composer closure combined with a new, attributable post result
- navigation to a supported new post or Reel permalink
- a newly rendered account-owned post matching the active submission

If Instagram appears to accept the submission but no reliable identity or URL
can be established, report `UNKNOWN` and do not automatically publish again.

---

## TikTok MVP Behavior

### Supported target

```text
TIKTOK_VIDEO
TIKTOK_PHOTO
```

The first release supports:

- one video
- or 1 to 4 images in one photo post (the current PostFlow attachment limit)
- mixed video/image selections are rejected
- an optional caption
- the platform's currently available default publishing options
- immediate and scheduled PostFlow jobs

The adapter must:

1. navigate only to an allowlisted TikTok upload surface
2. verify the active account
3. attach the video using the media-delivery contract
4. wait until TikTok finishes the required upload preparation
5. insert and verify the caption
6. leave privacy and advanced controls unchanged unless PostFlow can read and
   verify the selected state
7. re-check cancellation, identity, and interruption state
8. click Post once
9. distinguish upload/processing from final success
10. capture a stable post URL when available

### TikTok processing

Uploading is not equivalent to publishing.

The extension may report intermediate states:

```text
UPLOADING -> PROCESSING -> PUBLISHED
                       -> FAILED
                       -> UNKNOWN
```

If TikTok accepts the video but continues processing beyond the active-tab
timeout, the job must not return to a blindly retryable state. Store the
accepted/processing result and allow a later platform-specific status check or
manual confirmation.

---

## Composer and Web App UX

The create-post form should group destinations by platform:

```text
Facebook
  - Profile feed
  - Groups

Instagram
  - Feed
  - Reel

TikTok
  - Video post
```

Requirements:

- show the connection display name and detected username
- disable destinations whose connection is offline, mismatched, or paused
- show target-specific media requirements before submission
- show validation errors per platform instead of a generic failure
- allow one Post to target several platforms when its media is compatible
- include every destination in the schedule preview and selected count
- make it clear that platform UI defaults may control privacy and advanced
  options in the extension-driven MVP

When one media asset is not valid for every selected target, the first release
should block submission with a clear explanation. Platform-specific media
variants are a later feature.

---

## Connection and Popup UX

The extension popup should show separate platform states:

```text
Facebook   Connected as ... / Login required / Wrong account
Instagram  Connected as ... / Login required / Wrong account
TikTok     Connected as ... / Login required / Wrong account
```

The overview shows extension registration separately from account health.
Dashboard tab, Facebook, Instagram, and TikTok appear together in a compact
two-column grid with icon Open and Retry controls. Facebook is optional for
installations that use only Instagram or TikTok. A platform's Retry reruns only
that platform's session check and reports the binding error in its card. The
Dashboard tab Retry requests fresh dashboard identity. Facebook group tools
remain available in an optional section below the grid.

Actions may include:

- Open platform
- Check session again
- Connect detected account
- Reconnect expected account
- Open PostFlow dashboard

A platform card must not say `Ready` unless:

- the installation is active
- the platform session exists
- the expected and detected identities match
- the connection is not paused or archived

---

## Failure and Safety Behavior

| Condition | Expected behavior |
| --- | --- |
| Platform logged out | Pause only that connection and report `LOGIN_REQUIRED` |
| Wrong account active | Stop before submit and report `ACCOUNT_MISMATCH` |
| CAPTCHA or verification | Stop and report `MANUAL_INTERVENTION_REQUIRED` |
| Unexpected dialog/page | Fail safely without clicking unrelated controls |
| Media preview never appears | Fail before final publish |
| Publish button disabled | Report a validation failure; do not force-click |
| Job canceled before submit | Close/abandon composer where safe and report canceled |
| Result uncertain after submit | Record `UNKNOWN`; do not blindly retry |
| Browser/service worker restarts | Recover lease state without duplicate submission |
| Instagram DOM changes | Disable Instagram jobs without affecting Facebook/TikTok |
| TikTok DOM changes | Disable TikTok jobs without affecting Facebook/Instagram |

The final publish button must never be clicked through generic screen
coordinates or an unverified "first matching button" selector.

---

## Cancellation and Duplicate Prevention

Every adapter must check job state:

- before navigation
- before opening the composer
- before attaching media when practical
- immediately before the final publish action

After the final publish action:

- a cancellation request must not cause an automatic second attempt
- accepted, processing, unknown, and published states are non-retryable without
  an explicit recovery decision
- retryable failures must prove that the final action was not accepted
- an owner may manually requeue a failed, never-submitted job after the
  platform account is freshly verified; the retry is claimed once by the
  owning extension and does not override uncertain-submission safeguards
- execution messages must include job and tab identity so a replacement
  document cannot execute a stale job

---

## Platform-Scoped Health

Use platform-neutral operational states:

```ts
type PlatformWorkerStatus =
  | "ONLINE"
  | "OFFLINE"
  | "IDLE"
  | "PUBLISHING"
  | "LOGIN_REQUIRED"
  | "ACCOUNT_MISMATCH"
  | "BLOCKED"
  | "CAPTCHA_OR_CHALLENGE"
  | "CHECKPOINT_OR_VERIFICATION"
  | "MANUAL_INTERVENTION_REQUIRED";
```

Do not store one global platform health value for the whole extension.

Example:

```text
Facebook:  IDLE
Instagram: LOGIN_REQUIRED
TikTok:    IDLE
```

In this state, Facebook and TikTok jobs remain claimable.

---

## Observability

Every publishing log entry should include:

- timestamp
- job ID
- platform
- target type
- platform connection ID
- masked extension instance ID
- tab ID when available
- current step
- result or reason code
- whether expected/detected account identities matched

Do not log:

- post text
- media data or media access tokens
- cookies
- page storage
- full account identifiers when a masked value is sufficient
- screenshots containing user data by default

Use shared step names where possible:

```text
job.claimed
navigation.started
document.ready
identity.verified
composer.opened
media.attached
caption.inserted
submit.started
submit.accepted
result.published
result.unknown
result.failed
```

Platform-specific diagnostics may add fields without changing these shared
milestones.

---

## Automated Tests

### Backend

- legacy jobs without platform resolve to Facebook
- target type resolves to the correct platform
- target and connection platform mismatch is rejected
- one job is created per mixed-platform destination
- ordering and scheduling work across platforms
- an installation can claim only jobs belonging to its connections
- Facebook health is not required to claim a healthy Instagram/TikTok job
- paused or mismatched platform connections receive no jobs
- platform interruption does not pause another platform connection
- uncertain/processing submissions cannot be blindly reclaimed
- existing Facebook pending sync remains Facebook-scoped
- engagement eligibility and extraction are platform-aware; a TikTok analytics
  flag does not enable or disable TikTok publishing

### Extension orchestration

- the correct adapter is selected for each target
- unsupported targets fail before navigation
- only allowlisted platform URLs can be opened
- one installation executes one job at a time
- stale content-script messages cannot execute a replacement document
- cancellation is checked before final submit
- platform-scoped pause does not stop other adapters

### Instagram fixtures

- detects a valid authenticated identity
- rejects an account mismatch
- finds supported Feed and Reel composer variants
- attaches media only to the expected file input
- inserts caption without duplication
- does not select Story accidentally
- requires an enabled, expected Share control
- detects success, interruption, and uncertain results
- normalizes supported Instagram post URLs

### TikTok fixtures

- detects a valid authenticated identity
- rejects an account mismatch
- finds the supported upload surface
- attaches one video and detects upload progress
- selects the Photos tab and attaches 1 to 4 images in one photo job
- inserts caption without duplication
- preserves controls that PostFlow does not manage
- requires an enabled, expected Post control
- distinguishes processing from published
- detects success, interruption, and uncertain results
- normalizes supported TikTok post URLs

### TikTok engagement fixtures

- matches the exact published TikTok post before reading counters
- extracts likes, comments, favorites, and shares from the action bar's
  `data-e2e` attributes and accessible labels
- parses zero and compact counts such as `1.2K` without treating parse failure
  as zero
- returns partial results when a counter is absent, including Share controls
  that expose no numeric count
- preserves previously stored values for counters omitted from a partial result
- verifies manual and automatic sync use the same extraction and persistence
  path

All DOM tests should use sanitized fixtures. Tests must not depend on live user
cookies or credentials.

---

## Manual Validation

Manual validation must use dedicated test accounts and record the platform UI
variant, locale, browser version, extension version, and result.

### Regression baseline

1. Publish text, image, and video to a Facebook Profile Feed.
2. Publish to a Facebook Group.
3. Validate scheduling, cancellation, account mismatch, and restart behavior.

### Instagram MVP

1. Connect an Instagram account in the same Chrome Profile.
2. Publish one image to Feed.
3. Publish a 2-image Feed carousel with one caption.
4. Confirm mixed image/video and multiple-video selections are blocked.
5. Publish one supported video as a Reel.
6. Validate Arabic and English UI where supported.
7. Switch to another Instagram account and confirm safe mismatch handling.
8. Test logout, interruption, cancellation, timeout, and extension restart.
9. Confirm an uncertain result never creates a duplicate post.

### TikTok MVP

1. Connect a TikTok account in the same Chrome Profile.
2. Publish one supported video with a caption.
3. Validate upload and processing transitions.
4. Switch to another TikTok account and confirm safe mismatch handling.
5. Test logout, interruption, cancellation, timeout, and extension restart.
6. Confirm privacy and advanced controls are not changed unexpectedly.
7. Confirm an accepted or uncertain upload is never blindly repeated.

### TikTok engagement sync

1. Sync a published video with zero likes and comments; store confirmed zeros.
2. Sync a post with compact counters such as `1.2K` likes.
3. Confirm favorites and shares are stored when numeric counts are present.
4. Confirm a Share label without a count stays unknown and retains any previous
   value.
5. Refresh one TikTok post manually and confirm it uses the same result path as
   scheduled sync.
6. Confirm an unavailable or mismatched post records a sync error without
   changing its published status or stopping later posts in the batch.

Live platform publishing cannot be marked passed solely from automated tests.

---

## Rollout Plan

### Phase 1: Platform-aware foundation

- add platform and generic connection contracts
- add compatibility reads for current Facebook records
- refactor worker authorization and job payloads
- introduce adapter routing around the existing Facebook implementation
- keep Instagram and TikTok feature flags disabled
- run the full Facebook regression suite and manual baseline

### Phase 2: Instagram connection

- add Instagram host permission and content script
- implement session and identity detection
- add connection and popup UX
- keep Instagram job creation disabled

### Phase 3: Instagram publishing MVP

- implement Feed image publishing
- implement Reel video publishing
- add result tracking and safe interruption handling
- enable only for internal test connections
- stabilize against live Arabic and English UI variants

### Phase 4: Shared media delivery

- add authenticated job-scoped Blob delivery
- remove large video data from repeated extension messages
- validate cancellation, expiration, and memory cleanup

### Phase 5: TikTok connection and publishing MVP

- add TikTok host permission and content script
- implement session and identity detection
- implement video and photo upload, caption, processing, and result tracking
- enable only for internal test connections

### Phase 6: TikTok engagement sync

- add TikTok published-permalink eligibility to the existing engagement queue
- extract like, comment, favorite, and numeric share counts from the exact post
- persist optional counters with partial-update semantics
- add TikTok labels and counters to the existing post details UI
- reuse existing scheduling, retry/backoff, locking, and manual refresh
- enable analytics independently for internal test connections

### Phase 7: Controlled rollout

- enable each platform independently
- monitor failure and unknown-result rates
- disable only the affected adapter when a platform UI changes
- retain the ability to process already-claimed jobs safely during rollback

---

## Rollback

Each platform must have separate server-side creation and execution flags:

```text
FACEBOOK_EXTENSION_PUBLISHING_ENABLED
INSTAGRAM_EXTENSION_PUBLISHING_ENABLED
TIKTOK_EXTENSION_PUBLISHING_ENABLED
```

Disabling a platform must:

- stop creation of new jobs for that platform
- stop new claims for queued jobs on that platform
- allow an already-submitted job to report its terminal result
- preserve connections, jobs, schedules, and history
- leave other platforms operational

Engagement sync has independent platform controls. Disabling TikTok engagement
must stop TikTok analytics claims while leaving TikTok publishing and other
platform engagement syncs available.

Rollback must never delete jobs or convert an uncertain submission back to a
retryable pending job.

---

## Acceptance Criteria

### Foundation

- every publishing job resolves to an explicit platform
- legacy Facebook jobs continue to work without a destructive migration
- one extension installation can hold independent connections for Facebook,
  Instagram, and TikTok
- jobs are delivered only to the installation owning the target connection
- background routing selects an isolated platform adapter
- a platform pause or failure does not pause another platform
- Facebook Group, Profile Feed, pending sync, and engagement behavior regress
  neither functionally nor in account isolation

### Instagram MVP

- a user can connect and verify the active Instagram account
- a user selects Instagram accounts once in the create-post form; one image
  resolves to Feed and one video resolves to Reel automatically
- the inferred type is visible before submission and account selection survives
  media replacement/removal; invalid Instagram media cannot be submitted
- the API creates a correctly owned and scheduled Instagram job
- the extension publishes one image to Feed
- the extension publishes one video as a Reel
- account identity is rechecked before the final Share action
- Instagram publishing controls, caption selection, and completed-share notices
  support English and Arabic for both Feed images and Reels. A localized
  success notice confirms publishing without requiring a URL in the dialog;
  permalink recovery remains separate. Progress text and Done alone must not
  count as success.
- logout, mismatch, challenge, changed DOM, and cancellation fail safely
- reliable post URLs are saved when available
- uncertain submissions are not automatically retried

### TikTok MVP

- a user can connect and verify the active TikTok account
- a user can select TikTok Video in the create-post form
- a user can select a TikTok Photo post by attaching 1 to 4 images
- the API creates a correctly owned and scheduled TikTok job
- the extension fetches and attaches one video without repeatedly messaging a
  large Base64 payload
- the extension switches to TikTok Studio's Photos tab and attaches all images
  in one file-input change
- the extension inserts the caption and preserves unmanaged settings
- account identity is rechecked before the final Post action
- upload, processing, published, failed, and unknown states are distinguished
- logout, mismatch, challenge, changed DOM, and cancellation fail safely
- accepted or uncertain uploads are not automatically retried

### Published-post engagement sync

- only successfully published posts with a supported platform permalink enter
  the engagement queue
- TikTok likes, comments, favorites, and numeric shares are extracted from the
  exact post's visible action bar without triggering an interaction
- unrecognized values remain unknown; confirmed zero remains distinct from a
  missing counter
- partial updates preserve all previously known counters that were not read
- manual refresh and scheduled sync share the same TikTok extraction and update
  path
- the post details UI labels TikTok reactions as likes and shows known favorite
  and share counts
- TikTok engagement scheduling can be disabled independently of publishing

---

## Definition of Done

This feature is complete when:

- the shared jobs and connections architecture is platform-aware
- Facebook remains fully operational through the adapter-based architecture
- Instagram Feed image and Reel video publishing pass automated and recorded
  live validation
- TikTok video and photo publishing passes automated and recorded live validation
- TikTok published-post engagement sync stores available counters and passes
  automated and recorded live validation
- all platforms verify account identity before submission
- media transport is safe for the supported TikTok video size
- platform failures are isolated and observable
- no CAPTCHA or security challenge is automated
- no uncertain or processing submission can be blindly duplicated
- rollout and rollback can enable or disable Instagram and TikTok independently

---

## Required Implementation Process

### Instagram engagement localization follow-up

Existing Instagram engagement extraction must recognize English and Arabic
Like/Unlike/Comment labels and normalize Arabic-Indic/Persian digits and Arabic
numeric separators. Photo counters adjacent to the action wrapper and Reel
counters inside or next to their own buttons use the same bounded extractor.
Never cross another action icon or read virtualized neighboring Reel counters.
Retain the existing loaded-control zero policy; an unknown photo comment count
remains unknown rather than being inferred from the Like count. Cover both
languages and supplied DOM structures with regression fixtures. This change
must not alter publishing, session evidence, scheduling, or Facebook maintenance.

### Extension = Connection (clarified and approved 2026-10-09)

The registered ExtensionInstallation IS the product Connection, not a child of
another Connection or Chrome Profile entity. Do not introduce a separate root
collection, registry, or automatic initialization/migration on page load. Store the
shared display name there, with a read fallback to the existing Facebook label;
preserve legacy Facebook names for recovery compatibility. Group platform records
only by explicit installation binding, never by matching names or usernames.
Retain the original Connections UI: Active/Disconnected tabs, summary metrics,
search/filter, expandable rows, diagnostics, and action dialogs. Show Facebook,
Instagram, and TikTok inside each connection's expanded details, including
not-detected slots; do not replace this screen with a separate card dashboard.
Actual account identifiers remain distinct per platform.
Active lists only current non-archived, non-revoked installations; disconnected
historical or unbound legacy records must not inflate its counts. Current paused,
offline, or gracefully disconnecting connections remain visible for management.
Connections without Facebook must support naming, pause/resume, graceful and
forced disconnect, and Remove. Force disconnect immediately revokes the
installation credential across platforms. Remove revokes it and takes the
connection out of both Active and Disconnected immediately. Keep a hidden revoked
instance record so the same installed extension cannot register again, and keep
jobs and audit history. A verified platform session on a new installation may
reattach its removed platform account record. These actions must be owner-scoped,
race-guarded and audited, independent of a Facebook record. Existing historical
archives remain visible in Disconnected; explicit Facebook recovery remains available.
Force-disconnected installations can be restored from Disconnected in their
original Chrome Profile. The dashboard issues a short-lived, single-use approval;
the matching extension redeems it for a new credential, resumes its worker
alarms, and rechecks its platform sessions. Removed installations remain hidden
and cannot be restored by this flow.
Lifecycle controls apply to the whole installation; account health remains
independent. Keep credentials private and dashboard mutations owner-scoped.
Do not retarget jobs, rebind accounts, migrate data destructively, enable TikTok
publishing, or change session verification merely to group the UI. Preserve the
legacy Facebook record IDs and recovery behavior as compatibility data, not a
second visible product connection. Keep Facebook recovery inside the relevant
connection card, with disconnected cards accessible; multi-platform recovery
after reinstall remains deferred. Stale heartbeat
names must not undo a dashboard rename. New platforms must use the explicit
installation binding and the same reusable grouping/identity helpers.

### Installation-bound Instagram session parity

Instagram uses the same ExtensionInstallation ownership boundary as Facebook:
the first verified account observed in that installation is auto-connected under
the installation, and every later publish/analytics request is scoped to that
binding. Before an Instagram publish, the extension must re-read fresh identity
evidence from a top-level Instagram document and verify the expected account
ID from the authenticated cookie session. A
loading page or expired cached evidence is a transient `CHECKING`/`STALE` state,
not proof of logout; it must not downgrade a connected platform record or cause
the worker to oscillate between Connected and Login required. Explicit
`LOGIN_REQUIRED`, account mismatch, challenge, or failed pre-share verification
must still block Share and update the platform health state. Instagram cannot
reuse Facebook's `c_user` cookie; it uses its own `ds_user_id` + `sessionid`
pair for stable account identity and the current top-level document as the
fresh pre-Share proof, persisted against the same installation binding.

Before each phase:

1. Read this feature document.
2. Create or read `progress.md` in this feature directory.
3. Inspect the current code involved in the selected phase.
4. Preserve existing user changes and working Facebook behavior.
5. Implement only the selected phase.
6. Add focused automated tests.
7. Run the relevant API, web, and extension checks.
8. Perform live platform actions only with explicit user approval and dedicated
   test accounts.
9. Update `progress.md` with files changed, decisions, checks, live-validation
   status, limitations, and the next safe phase.

## Instagram identity policy

Instagram connections must use the authenticated account ID exposed by the
browser session (`ds_user_id` with a live `sessionid`) as their durable
identity. A username is display metadata only and must not be required,
persisted, or used for pre-share authorization for new ID-backed connections.
Legacy username-only records remain readable while they are migrated to the
ID-backed path. On startup, heartbeat, cookie changes, and publish refresh, the
extension checks these cookies itself. If no Instagram tab is open, it opens
one inactive top-level Instagram tab so the session can be checked without
requiring the user to navigate there first. A missing cookie keeps the account
unbound/waiting for login; it never creates a connection from a username alone.

### Instagram publishing tab policy

Before opening the composer, Instagram publishing must resolve the authenticated
account's own profile URL and navigate the publishing tab to that profile. It
must not start from an arbitrary open Reel, post detail, or another profile.
For ID-backed connections, the profile URL is discovered ephemerally from the
current authenticated document and is not persisted as account identity. The
profile page must finish loading before the baseline permalink probe and media
upload begin; if it cannot be resolved, the job fails safely without opening
the composer. Permalink recovery must refresh this same profile page so a
previous post URL cannot be mistaken for the new post.
