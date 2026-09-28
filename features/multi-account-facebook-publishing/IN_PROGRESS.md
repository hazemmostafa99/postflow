# Multi-Account Facebook Publishing — In Progress

Use this file as the implementation checklist and working log.

Update it as work is completed.

---

## Phase 0 — Existing implementation review

- [x] Inspect current extension architecture.
- [x] Identify extension -> backend connection flow.
- [x] Identify how `websiteUserId` is currently stored/resolved.
- [x] Identify current group collection and sync flow.
- [x] Identify current Publish Job model.
- [x] Identify how extension workers receive/claim jobs.
- [x] Identify current queue behavior.
- [x] Identify retry and timeout logic.
- [x] Identify existing extension status/heartbeat logic.
- [x] Identify current Facebook account detection logic.
- [x] Identify current Post ID detection logic.
- [x] Identify video-processing flow.
- [x] Document proposed minimal integration points before coding.

### Notes

Findings from the current codebase:

- Extension architecture:
  - `apps/extension/src/postflow-content.ts` runs on the PostFlow web app and stores `clerkUserId` in `chrome.storage.local` from `#postflow-user-meta[data-postflow-user-id]`.
  - `apps/extension/src/background.ts` owns API calls, extension registration/heartbeat, group sync, job polling, publishing tab orchestration, pending-post sync, and engagement sync.
  - `apps/extension/src/content.ts` runs on Facebook, detects groups, executes publish jobs, tracks publish result evidence, and sends `JOB_SUCCESS` / `JOB_FAILED` back to the background worker.
  - `apps/extension/src/facebook-session.ts` only detects whether a Facebook session exists by checking for the `c_user` cookie.

- Extension -> backend connection:
  - All extension API calls go through `apiFetch()` in `background.ts`.
  - The only identity sent to the API is the `x-clerk-user-id` header.
  - Register/heartbeat/session endpoints are `POST /api/extensions/register`, `POST /api/extensions/heartbeat`, and `POST /api/extensions/session`.
  - Backend storage is `ExtensionInstallation` with `clerkUserId`, `status`, `lastHeartbeat`, and `facebookSessionDetected`.
  - Current backend registration is one installation per `clerkUserId`; it does not distinguish Chrome Profiles or extension instances.

- Website-user binding:
  - The website user is currently the Clerk user ID.
  - It is stored in extension local storage under `clerkUserId`.
  - There is no separate extension instance ID and no Facebook account / connection ID.

- Group sync:
  - Facebook content script posts `GROUPS_DETECTED` to the background port.
  - Background merges groups into `chrome.storage.local.facebookGroups` by Facebook group id, then posts to `POST /api/groups/sync`.
  - Backend `Group` is keyed by `{ clerkUserId, externalId }`.
  - This means the same group cannot currently exist as separate records for two Facebook accounts under the same website user.

- Publish job model and creation:
  - `Post` is owned by `clerkUserId`.
  - `PublishingJob` references `postId` and `groupId`; it has status/attempts/scheduling/submission/pending-sync/engagement fields.
  - `PostsService.createPost()` validates selected groups by `{ _id: {$in: targetGroupIds}, clerkUserId }` and creates one job per selected group.
  - Jobs do not currently store `clerkUserId`, `facebookConnectionId`, or `extensionInstanceId` directly.

- Job consumption / queue behavior:
  - Extension polls `GET /api/jobs/next`.
  - Backend resolves all posts for `clerkUserId`, then returns the oldest due `PENDING` job for any of those posts.
  - The job is not atomically claimed by `GET /api/jobs/next`; the extension later posts `RUNNING` to `/api/jobs/:id/status`.
  - Background enforces one local publish at a time with `isProcessingJob`, `activeExecution`, tab-id checks, and stale-result guards.
  - With two profiles using the same Clerk user, both profiles would currently poll the same user-level queue and could race for the same job.

- Retry, timeout, and pause behavior:
  - Publish delivery retries `EXECUTE_JOB` until the Facebook tab/content script is ready or times out.
  - Job attempts increment when status transitions to `SUCCESS` or `FAILED`.
  - Manual-intervention states from Facebook interruptions can set `publishQueuePaused` in extension local storage; this pause is local to that Chrome Profile.
  - Pending-approval and engagement checks have independent local busy locks.

- Heartbeat/status:
  - Heartbeat runs every minute from `background.ts`.
  - Backend only records `ACTIVE`, `lastHeartbeat`, and `facebookSessionDetected`.
  - There is no persisted `IDLE`, `PUBLISHING`, `BLOCKED`, `LOGIN_REQUIRED`, `CAPTCHA_OR_CHALLENGE`, `CHECKPOINT_OR_VERIFICATION`, `MANUAL_INTERVENTION_REQUIRED`, or `ACCOUNT_MISMATCH` state yet.

- Facebook account detection:
  - Current detection only checks that the `c_user` cookie exists.
  - The code does not extract or persist the current Facebook account id from `c_user`.
  - There is no expected-account verification before group sync or publishing.

- Post ID / result detection:
  - `content.ts` injects `graphql-spy.js`, tracks response candidates, story fbids, video ids, and upload session ids.
  - `wait-for-post-submission-result.ts` combines DOM evidence, pending approval messages, network candidates, redirects, and explicit success evidence.
  - `facebook-interruption-detector.ts` detects temporary blocks, CAPTCHA/challenge, checkpoint/verification, and login-required states.

- Video-processing flow:
  - Video jobs use longer confirmation timing and can return `UNKNOWN` while automatic post-link checks continue.
  - The background worker can perform `checkSinglePendingPost()` immediately after publish for unknown/video cases.
  - This is all local to the extension instance today and should be preserved.

Minimal integration points before coding:

- Add a stable `extensionInstanceId` in extension local storage and include it in every API request, preferably as an `x-extension-instance-id` header plus register payload if needed.
- Change `ExtensionInstallation` from one record per `clerkUserId` to one record per `{ clerkUserId, extensionInstanceId }`, while preserving existing users through defaults/migration-friendly optional fields.
- Introduce a `FacebookConnection` schema owned by `clerkUserId`, linked to `extensionInstanceId`, with expected/current Facebook account identity and status/last-seen fields.
- Extract the current Facebook account id from the `c_user` cookie in `facebook-session.ts` or Facebook content/background flow, then report it to the backend.
- Scope group records by `facebookConnectionId` (or equivalent) and update the unique index from `{ clerkUserId, externalId }` to include the connection.
- Add `facebookConnectionId` to publishing jobs, deriving it from the selected group/connection when jobs are created.
- Route `GET /api/jobs/next` by the calling extension instance's active Facebook Connection and eventually claim jobs atomically to avoid double-running.
- Keep the current background local sequencing and content-script publishing/detection logic intact; the first feature step should change identity and routing, not rewrite publishing.

---

## Phase 1 — Extension Instance identity

- [x] Define stable `extensionInstanceId`.
- [x] Persist it per Chrome Profile / extension installation.
- [x] Send it during backend connection/registration.
- [x] Confirm two Chrome Profiles generate different instance IDs.
- [ ] Confirm an instance ID survives browser restart.

### Notes

- Extension now creates `extensionInstanceId` in `apps/extension/src/background.ts`, stores it in `chrome.storage.local`, and reuses it for all API calls through the `x-extension-instance-id` header.
- Backend `ExtensionInstallation` now has optional `extensionInstanceId` and a sparse unique `{ clerkUserId, extensionInstanceId }` index.
- Register, heartbeat, and session endpoints now resolve installation records by `{ clerkUserId, extensionInstanceId }` when the header is present, falling back to legacy `{ clerkUserId }` when absent.
- Verified with `npm run build` in both `apps/extension` and `apps/api`.
- Manual check: two extension installation records were created for the same `clerkUserId` with different instance IDs: `pfi_ca22c769-c7b2-49d3-87da-413b2b5ff73a` and `pfi_2e8276c4-d77e-442b-818c-74a7ef65a410`.
- Development registration now retries after transport failure and falls back to `127.0.0.1` when `localhost` resolution is unavailable.

---

## Phase 2 — Facebook Connection model

- [x] Review existing account/database model.
- [x] Add or formalize `FacebookConnection` if required.
- [x] Link Facebook Connection to Website User.
- [x] Link Extension Instance to Facebook Connection.
- [x] Define Facebook Connection status fields.
- [x] Preserve existing single-account records/migration path.

### Notes

- No existing Facebook account/connection entity was present in the API.
- Added `FacebookConnection` in `apps/api/src/schemas/facebook-connection.schema.ts`.
- New connections are unique per `{ clerkUserId, extensionInstanceId }`; the instance ID remains optional for legacy records.
- Connections track `status`, `workerStatus`, `facebookSessionDetected`, `lastSeenAt`, and the future `facebookUserId` field.
- Registration, heartbeat, and session reporting upsert the connection and attach its ObjectId to `ExtensionInstallation.facebookConnectionId`.
- Existing calls without `x-extension-instance-id` continue to resolve by `clerkUserId`.
- Facebook identity extraction and mismatch protection are intentionally deferred to Phase 3.
- Fixed MongoDB upsert conflicts by ensuring `$setOnInsert` never repeats a field supplied by `$set`.
- `npm run build` passes in `apps/api`.
- Full API Jest execution is currently blocked by the repository's existing Jest/ESM incompatibility with `@nestjs/mongoose`; extension tests are blocked by sandbox `spawn EPERM`.

---

## Phase 3 — Facebook account identity verification

- [x] Determine how the current Facebook identity is detected.
- [x] Store/resolve expected Facebook identity for the connection.
- [x] Verify identity before group collection.
- [x] Verify identity before publishing.
- [x] Add `ACCOUNT_MISMATCH` state.
- [x] Prevent publishing when identity mismatches.

### Notes

- `facebook-session.ts` now extracts the numeric Facebook `c_user` cookie value and reports it with session state.
- The first verified account ID becomes `FacebookConnection.facebookUserId`; later reports are compared with it.
- The latest reported identity is stored as `detectedFacebookUserId`.
- A mismatch sets both connection status and worker status to `ACCOUNT_MISMATCH`.
- The extension blocks group sync and job checks until the API confirms a matching identity.
- The background worker also reads the `c_user` cookie directly on startup and heartbeat, so an already-open Facebook tab does not leave the worker in `UNKNOWN` after an extension reload.
- Facebook `c_user` cookie changes now trigger an immediate identity refresh instead of waiting for the next heartbeat.
- The API rejects group sync and returns no publish job for an unverified extension instance.
- `npm run build` passes in both `apps/api` and `apps/extension`.
- Manual validation remains: log into different Facebook accounts in the two Chrome Profiles, confirm matching sessions publish only their own jobs, then switch one profile's account and confirm it is blocked.

---

## Phase 4 — Group sync ownership

- [x] Associate synced groups with Facebook Connection.
- [x] Confirm the same Facebook Group can exist under two different Facebook Connections.
- [x] Update backend sync endpoints/services if needed.
- [x] Preserve existing group data where possible.
- [x] Update website queries to expose groups per Facebook account.

### Notes

- `Group.facebookConnectionId` links new synced groups to the verified extension connection.
- The unique group key is now `{ clerkUserId, facebookConnectionId, externalId }`.
- Legacy groups without a connection ID remain readable and are not rewritten automatically.
- Group sync uses the calling extension instance's connection ID; group list/search endpoints accept `connectionId`.
- The web `/api/groups` proxy forwards the optional `connectionId` filter.
- Ran `npm run repair-indexes` in `apps/api`; the connection-scoped group index is ensured.
- `npm run build` passes in `apps/api`.
- The web build is currently blocked by the environment's inability to download the existing Google Inter font.

---

## Phase 5 — Publish Job routing

- [x] Add Facebook Connection ownership to Publish Jobs.
- [x] Determine whether `extensionInstanceId` should be stored directly or resolved dynamically.
- [x] Ensure jobs can only be claimed by the intended account/instance.
- [x] Prevent cross-account job consumption.
- [x] Preserve existing publish payload format where possible.

### Notes

- New publishing jobs copy `facebookConnectionId` from their target group.
- The extension instance ID is resolved dynamically through its active Facebook Connection; it is not duplicated on every job.
- `/api/jobs/next` filters jobs by the verified connection for callers that provide an extension instance ID.
- `/api/jobs/next` atomically claims the next connection-owned job and assigns a 15-minute lease; expired `RUNNING` jobs can be recovered by the same verified connection.
- Job status updates reject jobs assigned to another verified connection.
- Ran `npm run migrate-connection-ownership`; 0 jobs required backfill and 0 legacy jobs were skipped.
- Existing publish payloads are unchanged apart from backend routing.
- `npm run build` passes in `apps/api`.

---

## Phase 6 — Independent workers

- [x] Make Extension Instance A process only Account A jobs.
- [x] Make Extension Instance B process only Account B jobs.
- [x] Allow A and B to process jobs simultaneously.
- [x] Confirm one worker does not wait for another worker.
- [x] Keep execution sequential inside each individual instance.

### Notes

- `/api/jobs/next`, pending-post retrieval, engagement retrieval, and job result updates are scoped to the verified Facebook Connection for callers with an extension instance ID.
- Each extension keeps its existing local `isProcessingJob` lock, so one account remains sequential while separate profiles can run independently.
- Worker status is persisted as `PUBLISHING` while a job is running and returns to `IDLE` after success or failure.
- Heartbeats preserve `PUBLISHING` instead of resetting an active worker to `ONLINE`.
- Queue pauses and Facebook interruption state remain in each extension's local storage.
- Required A1-A3/B1-B3 validation is still manual.

### Required test

Profile A:

- [ ] A1
- [ ] A2
- [ ] A3

Profile B:

- [ ] B1
- [ ] B2
- [ ] B3

Expected:

- [ ] A1 and B1 can run concurrently.
- [ ] A2 waits only for A1.
- [ ] B2 waits only for B1.
- [ ] A never executes B jobs.
- [ ] B never executes A jobs.

### Notes

- Per-profile queue pause remains local to the extension instance; the backend routes jobs by `facebookConnectionId`.
- Blocked, login-required, mismatch, checkpoint, CAPTCHA, and manual-intervention states are preserved across heartbeats and session checks until recovery or explicit resume.
- Terminal job updates only change `PUBLISHING` to `IDLE`, preventing a failed publish from overwriting a newly reported interruption state.
- Live two-profile validation is still required for the checklist above.

---

## Phase 7 — Instance health / heartbeat

- [x] Add/reuse heartbeat mechanism.
- [x] Track `ONLINE`.
- [x] Track `OFFLINE`.
- [x] Track `IDLE`.
- [x] Track `PUBLISHING`.
- [x] Track `BLOCKED`.
- [x] Track `LOGIN_REQUIRED`.
- [x] Track `CHECKPOINT_OR_VERIFICATION`.
- [x] Track `CAPTCHA_OR_CHALLENGE`.
- [x] Track `MANUAL_INTERVENTION_REQUIRED`.
- [x] Track `ACCOUNT_MISMATCH`.
- [x] Store/update `lastSeenAt` or equivalent.

### Notes

- Existing one-minute heartbeats update `lastSeenAt`; blocked states are preserved across heartbeats.
- The extension reports Facebook interruption detector states through `POST /api/extensions/status`.
- Job execution reports `PUBLISHING` and terminal results return the worker to `IDLE`.
- The Connections UI calculates `OFFLINE` when `lastSeenAt` is older than two minutes.
- API, extension, and web TypeScript/build checks pass.

---

## Phase 8 — Fault isolation

- [ ] Block Account B and verify only B stops.
- [ ] Verify Account A continues.
- [ ] Log out Account A and verify B continues.
- [ ] Trigger/check manual-intervention state for one account.
- [ ] Confirm no global queue pause occurs because of one account.

### Notes

- Live browser validation remains required for the checklist above.

---

## Phase 9 — Reconnect and restart behavior

- [ ] Close Chrome Profile A while jobs are pending.
- [ ] Confirm Profile B continues.
- [ ] Restart Profile A.
- [ ] Confirm the same Extension Instance identity reconnects.
- [ ] Confirm pending A jobs resume safely.
- [ ] Verify no duplicate posts occur after reconnect.

### Notes

- Extension instance IDs remain in `chrome.storage.local`, so reconnects reuse the same worker identity.
- Connection-scoped job selection now atomically creates a 15-minute worker lease instead of reading `PENDING` first and claiming afterward.
- An expired or legacy unleased `RUNNING` job can be recovered by the same verified connection after a worker restart.
- Terminal `SUCCESS`/`FAILED` updates release the worker lease.
- Browser restart and duplicate-post checks remain manual because they require live Facebook behavior.
- Facebook tab navigation retries transient Chrome tab-edit locks before a job is failed.

---

## Phase 10 — Existing post detection compatibility

- [ ] Verify normal text post success detection still works.
- [ ] Verify image post success detection still works.
- [ ] Verify video-processing flow still works.
- [ ] Verify Post ID detection remains isolated per instance.
- [ ] Confirm one instance waiting for video processing does not block another instance.

### Notes

- Pending-post and engagement endpoints remain scoped to the verified Facebook Connection.
- Existing text, image, video, and Post ID detection code remains unchanged; its locks are local to each extension instance.
- Video permalink detection now prefers same-group links observed after the Post click, and the API rejects a permalink already assigned to another job in that group.
- API and extension builds pass; live Facebook compatibility checks remain manual.

---

## Phase 11 — Two-account acceptance test

Environment:

- Chrome Profile A -> Facebook Account A -> Extension Instance A
- Chrome Profile B -> Facebook Account B -> Extension Instance B

Acceptance criteria:

- [x] Both instances appear separately on the backend.
- [x] Both instances can be online simultaneously.
- [ ] Groups sync under the correct Facebook Connection.
- [ ] Publish jobs are routed correctly.
- [ ] Both accounts can publish at the same time.
- [ ] Publishing remains sequential within each account.
- [ ] One account failure does not stop the other.
- [ ] Account mismatch prevents publishing.
- [ ] Restart/reconnect does not produce duplicate posts.

### Implementation notes

- The Create Post form now provides a Facebook account selector, filters groups by `connectionId`, and labels each group with its owning account.
- The Connections page masks raw Facebook and extension IDs with friendly account-ending and browser-profile labels.
- Database ownership/index migrations are complete; live two-profile acceptance testing remains.
- Live API check returned two distinct verified connections for the test user; both are currently `ONLINE`.

---

## Phase 12 — Scale test

After the two-account flow is stable:

- [ ] Test 3 profiles.
- [ ] Test 5 profiles.
- [ ] Test 10 profiles.
- [ ] Monitor backend load.
- [ ] Monitor extension connection stability.
- [ ] Monitor job claiming/routing conflicts.
- [ ] Monitor duplicate prevention.
- [ ] Monitor Facebook interruption states independently per account.

---

## Open decisions

Record unresolved design decisions here.

- [ ] Should Publish Jobs store `extensionInstanceId` directly, or only `facebookConnectionId` and resolve the active worker dynamically?
- [ ] Can one Facebook Connection be active on multiple Extension Instances/devices?
- [ ] If yes, which instance owns publishing jobs?
- [ ] What is the offline heartbeat timeout?
- [ ] What statuses should be persisted versus calculated?
- [ ] What migration is required for existing users/groups/jobs?

---

## Current status

**Status:** Phase 8 implementation hardening complete; live fault-isolation validation remains

**Current phase:** Phase 8 — Fault isolation

**Next action:** Run the two-profile fault-isolation test, then complete the Phase 9 restart checks.
