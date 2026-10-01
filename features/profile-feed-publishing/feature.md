# Profile Feed Publishing

## Goal

Allow a PostFlow user to create a post in the web app and publish it to the
authenticated Facebook profile feed connected to a specific PostFlow
`FacebookConnection`.

This feature adds one publishing target:

```text
PROFILE_FEED
```

Facebook Pages are not part of this feature.

---

## Existing-System Rule

Extend the current group publishing architecture. Do not build a second queue
or a separate profile-only publishing system.

The existing flow remains the foundation:

```text
PostFlow web app
    -> API creates Post and PublishingJob records
        -> job is assigned to a FacebookConnection
            -> the matching extension instance claims the job
                -> Facebook content script publishes and reports the result
```

Preserve the current behavior for Facebook Group jobs throughout the work.

---

## Scope

The first release must support:

- text-only profile posts
- image profile posts within the existing media limits
- video profile posts within the existing media limits
- immediate and scheduled profile publishing
- selecting a profile feed together with one or more existing group targets
- multiple Facebook connections, where each profile job is routed to the
  extension instance that owns that connection
- the existing pause, cancel, retry, lease, and account-mismatch protections
- storing a Facebook post URL when one can be detected reliably

The extension performs the final Facebook `Post` action, consistent with the
existing automated group publishing flow.

---

## Non-Goals

- Facebook Pages
- posting to another person's timeline
- posting to a friend's profile
- Facebook Graph API integration
- changing the post audience or privacy setting
- tagging people, locations, feelings, or activities
- stories, reels, live video, marketplace, or cross-posting
- group pending-approval synchronization for profile jobs
- replacing the existing group publishing implementation

PostFlow must not change the Facebook audience selector in this release.
Facebook's current composer audience remains in effect.

---

## Terminology

### Publishing target

A destination represented by one `PublishingJob`.

Supported target types after this feature:

```ts
enum PublishingTargetType {
  GROUP = "GROUP",
  PROFILE_FEED = "PROFILE_FEED",
}
```

### Profile feed target

The feed belonging to the Facebook account bound to a `FacebookConnection`.
It is not a standalone database entity and must not be represented as a fake
`Group` record.

### Facebook connection

The existing PostFlow record that binds a website user, extension instance,
Chrome profile, and verified Facebook account identity.

---

## User Flow

1. The user opens the existing create-post form.
2. The user writes text and/or attaches media.
3. The user selects one or more destinations:
   - Facebook Groups
   - My Profile Feed for a connected Facebook account
4. The user optionally chooses a start time and spacing.
5. The API creates one `PublishingJob` per selected destination.
6. Each job is assigned to the destination's `FacebookConnection`.
7. The matching extension instance claims its next job.
8. For `PROFILE_FEED`, the extension opens the connected account's own profile
   feed composer, inserts content/media, and submits the post.
9. The extension reports `PUBLISHED`, `UNKNOWN`, an interruption, or a failure.
10. The web app displays the target as a profile feed rather than a group.

---

## Target Contract

Use an explicit target discriminator on `PublishingJob`.

Conceptual schema:

```ts
class PublishingJob {
  targetType: PublishingTargetType;
  groupId?: Group;
  facebookConnectionId?: Types.ObjectId;
}
```

Data invariants:

| Target type    | `groupId`      | `facebookConnectionId`                                      |
| -------------- | -------------- | ----------------------------------------------------------- |
| `GROUP`        | Required       | Required for connection-aware jobs; legacy jobs may omit it |
| `PROFILE_FEED` | Must be absent | Required                                                    |

`PROFILE_FEED` jobs resolve their destination from the assigned
`FacebookConnection`. They must never infer the destination from the currently
open Facebook tab alone.

### Migration compatibility

- Add `targetType` with a default of `GROUP`.
- Existing jobs without `targetType` must be treated as `GROUP`.
- Make `groupId` optional only after all readers are target-aware.
- Do not create placeholder Group records for profile feeds.
- Existing group API response shapes should remain compatible where practical.

---

## Create-Post API

Move toward a typed target request while accepting the existing
`targetGroupIds` field during the compatibility period.

Recommended request shape:

```ts
type CreatePostTarget =
  | {
      type: "GROUP";
      groupId: string;
    }
  | {
      type: "PROFILE_FEED";
      facebookConnectionId: string;
    };

interface CreatePostDto {
  content: string;
  mediaUrls?: string[];
  targets?: CreatePostTarget[];
  targetGroupIds?: string[]; // temporary backward compatibility
  startTime?: string;
  spacePostsApart?: boolean;
  spacingMinutes?: number | null;
}
```

Validation requirements:

- Require content or at least one valid media item.
- Require at least one valid target across `targets` and legacy
  `targetGroupIds`.
- Reject duplicate targets.
- Validate every group against the authenticated PostFlow user.
- Validate every profile connection against the authenticated PostFlow user.
- Require a profile connection to be bound to a verified Facebook account.
- Reject malformed target combinations, including a profile target with a
  `groupId`.
- Never trust a Facebook user ID supplied by the web client.
- Derive job ownership from the persisted Group or FacebookConnection.

The response schedule should identify destinations without assuming every job
has a group:

```ts
type CreatedJobSchedule = {
  targetType: "GROUP" | "PROFILE_FEED";
  targetId: string;
  scheduledFor?: string;
};
```

For a group, `targetId` is the Group ID. For a profile feed, it is the
FacebookConnection ID.

---

## Scheduling and Ordering

The existing Post Flow ordering and spacing rules apply across the final
ordered destination list.

Example:

```text
0  Profile A feed       10:00
1  Group X              10:03
2  Group Y              10:06
```

The backend remains the source of truth for `flowOrder` and `scheduledFor`.
Profile jobs must not bypass scheduling because they do not have a `groupId`.

---

## Job Delivery Contract

`GET /api/jobs/next` should return a target-aware payload instead of requiring
the extension to inspect populated Mongoose fields.

Conceptual response:

```ts
type PublishJobTarget =
  | {
      type: "GROUP";
      groupId: string;
      externalId?: string;
      name: string;
      url: string;
    }
  | {
      type: "PROFILE_FEED";
      facebookConnectionId: string;
      facebookUserId: string;
      name: string;
      url: string;
    };

interface PublishJobPayload {
  id: string;
  post: {
    content: string;
    mediaUrls: string[];
  };
  target: PublishJobTarget;
}
```

The API constructs the profile URL from the persisted, verified connection.
The client must not choose which Facebook account receives the post.

Job claiming remains scoped by `facebookConnectionId` and
`extensionInstanceId`. A profile job must not be claimable by another
connection owned by the same PostFlow user.

---

## Extension Behavior

### Routing

The background worker branches on `job.target.type`:

```text
GROUP        -> existing group navigation and publishing
PROFILE_FEED -> profile feed navigation and publishing
```

The branch should be small. Shared composer behavior should be reused for:

- opening the composer
- injecting text
- attaching media
- waiting for media previews
- finding an enabled Post button
- checking interruption states
- submitting the post
- reporting the result

Target-specific logic should own:

- destination URL validation
- page readiness checks
- composer trigger discovery
- target identity checks
- permalink detection
- pending-approval handling

### Navigation

For a profile job, navigate to the verified account's own profile feed using a
Facebook-owned HTTPS URL derived from the connection identity.

Before opening or submitting the composer, verify:

- a Facebook session exists
- the detected Facebook user ID equals the connection's bound user ID
- the page belongs to the expected profile when that can be determined
- the job is still active and not cancel-requested

If identity verification fails, stop before entering or submitting content,
report `ACCOUNT_MISMATCH`, and pause only that connection's queue.

### Composer

Profile and group composers share behavior but do not have identical DOM
structure. Profile support must have its own readiness and trigger detection
instead of weakening group selectors globally.

The implementation should prefer semantic attributes and visible composer
structure. Localized text may be a fallback, not the only strategy.

The extension must not interact with:

- the audience selector
- Story or Reel creation
- another person's profile composer
- unrelated open dialogs

---

## Submission Results

Profile posts do not have a group approval state.

Allowed profile submission results:

```text
PUBLISHED
UNKNOWN
TEMPORARY_BLOCK
CAPTCHA_OR_CHALLENGE
CHECKPOINT_OR_VERIFICATION
LOGIN_REQUIRED
UNEXPECTED_INTERRUPTION
```

`PENDING_APPROVAL` is invalid for `PROFILE_FEED`.

Success may be established by reliable evidence such as:

- an explicit Facebook success cue
- a newly observed post owned by the expected profile
- a network result that can be tied to the active job and expected profile
- a stable permalink that matches a supported profile-post URL shape
- for an accepted profile video, a new processed-reel notification that was
  absent from a pre-publish notification snapshot

Do not treat a generic feed article or an old matching-text post as proof of
success.

Supported permalink detection should account for Facebook profile post forms
such as profile post paths and permalink URLs. URL normalization must preserve
enough identity to avoid confusing another account's post with the active job.

If Facebook closes the profile composer after accepting a video but no reliable
permalink is available, store `submissionStatus: PUBLISHED` without a URL and
do not blindly retry. Persist that accepted state immediately rather than
leaving the job reclaimable as `RUNNING`. Keep that job correlated while waiting for a new
`fb_shorts_video_processed` notification. Canonicalize its `/reel/{id}` link by
removing notification query parameters, then enrich the same successful job
with the URL. Existing processed-video notification identities and reel URLs
must be snapshotted before publishing so an old notification can never supply
the new job's permalink. If the snapshot fails or no new notification appears,
leave the job published without a URL.

The active profile document should detect a newly rendered processed-video
notification immediately. A separate notifications-page check is the fallback
when the transient on-page notification is missed. Once a content script has
acknowledged an execution job, a replacement Facebook document must not receive
the same execution again.

For non-video submissions where Facebook appears to accept the submission but
no reliable evidence is available, store `submissionStatus: UNKNOWN` and do not
blindly retry. This follows the existing duplicate-prevention principle.

---

## Pending Sync and Engagement

Existing group pending-approval logic must filter to `targetType: GROUP`.
Profile jobs must never be returned by `/api/jobs/pending`.

Engagement sync is available for confirmed `PUBLISHED` jobs from both
`GROUP` and `PROFILE_FEED` targets when a stable `postUrl` is stored. The
extension opens the saved Facebook URL in an isolated background tab, matches
the target article by its scoped identity, and extracts the reaction and
comment counters only after the action controls have rendered.

Profile URLs may be `/reel/{id}`, profile video URLs, profile post URLs, or
Facebook permalink forms. Pending-approval synchronization remains Group-only;
profile posts do not have an approval state.

---

## Web App Requirements

### Create post

The destination area should expose two clear target categories:

- Groups
- Profile feeds

Each connected Facebook account appears as one profile-feed destination. Use
the existing connection display name, status, and account suffix. A profile
destination is selectable only when its connection is ready and identity is
verified.

The user may select:

- only profile feeds
- only groups
- both profile feeds and groups

The selected-destination count, validation, and schedule preview must include
both target types.

Display a concise notice that the Facebook composer's current audience will be
used. Do not imply that PostFlow controls profile privacy in this release.

### Post details

All post and job views must stop assuming `job.groupId` always exists.

For a profile job, show:

- target label: `Profile feed`
- Facebook connection display name
- publish status and submission status
- schedule and completion timestamps
- detected Facebook post link when available
- failure or interruption reason when present

Group job presentation must remain unchanged.

---

## Post Status Aggregation

Parent Post status continues to aggregate all child jobs, regardless of target
type.

Examples:

```text
Profile SUCCESS + Group SUCCESS -> COMPLETED
Profile FAILED + Group SUCCESS  -> PARTIAL_FAILURE
Profile PENDING + Group SUCCESS -> PUBLISHING
All canceled                    -> CANCELED
```

No profile-specific parent status is required.

---

## Security and Safety Requirements

- The API is the source of truth for target ownership.
- A PostFlow user can select only their own FacebookConnection.
- A worker can claim only jobs assigned to its verified connection.
- Re-check Facebook identity immediately before the final Post action.
- Never publish when expected and detected Facebook IDs differ.
- Never derive a profile target from whichever account happens to be open.
- Never use a client-supplied Facebook user ID as authoritative identity.
- Keep interruption pauses isolated to the affected connection.
- Preserve cancellation checks before the final submit action.
- Do not automatically retry an uncertain submission that may already exist.

---

## Failure Behavior

| Condition                         | Expected behavior                                      |
| --------------------------------- | ------------------------------------------------------ |
| Connection offline                | Keep job pending until the assigned worker reconnects  |
| Facebook logged out               | Pause that connection and report `LOGIN_REQUIRED`      |
| Wrong Facebook account            | Stop and report `ACCOUNT_MISMATCH`                     |
| Checkpoint or CAPTCHA             | Pause only that connection                             |
| Profile page/composer changed     | Fail safely without clicking unrelated UI              |
| Media could not attach            | Fail before the final Post action                      |
| Result uncertain after submit     | Record `UNKNOWN`; do not blindly republish             |
| Extension restarts after video acceptance | Keep the job `PUBLISHED`; never reclaim and repost it |

---

## Observability

Logs and diagnostics should include:

- job ID
- `targetType`
- FacebookConnection ID
- extension instance ID
- expected/detected Facebook account match state
- current publishing step
- submission result

Do not log post content, media data URLs, cookies, or authentication secrets.

---

## Rollout Strategy

1. Add the target model and compatibility handling while producing only group
   jobs.
2. Make API, post detail, analytics, and extension readers target-aware.
3. Enable profile job creation behind a feature flag or server-side switch.
4. Test one verified connection with text-only posts.
5. Test images and videos.
6. Test mixed group/profile flows.
7. Test two isolated Chrome profiles and confirm routing isolation.
8. Enable the target for normal users after manual verification.

The switch must disable creation of new profile jobs without breaking existing
profile jobs already in the queue.

---

## Acceptance Criteria

- A connected user can select `Profile feed` in the create-post form.
- Creating a profile-only post produces a `PROFILE_FEED` job without a Group.
- A mixed selection produces one job per group/profile destination.
- Each profile job is assigned to the selected FacebookConnection.
- Only the matching extension instance can claim the profile job.
- The extension verifies Facebook identity before publishing.
- Text, image, and video profile posts use the existing media limits.
- Immediate and scheduled profile jobs respect the normal queue rules.
- The extension can submit a post to the connected account's own feed.
- Reliable post URLs are saved when available, including delayed profile-video
  reel URLs recovered from a newly observed processed-video notification.
- Uncertain submissions are not blindly retried.
- Profile jobs never enter `PENDING_APPROVAL`.
- Group pending-sync jobs exclude profile targets.
- Published profile jobs with a saved permalink can refresh engagement counters.
- Post details render profile jobs without accessing `groupId`.
- Existing Facebook Group publishing continues to work.
- Account mismatch, logout, checkpoint, cancellation, and restart scenarios
  fail safely.

---

## Required Implementation Process

Before each phase:

1. Read this feature document.
2. Read `progress.md`.
3. Inspect the current code involved in that phase.
4. Preserve existing user changes and working group behavior.
5. Implement only the selected phase.
6. Add or update focused tests.
7. Run the relevant builds/checks.
8. Update `progress.md` with files changed, decisions, checks, and limitations.
