# Extension Lifecycle and Reconnection Management — Feature Specification

## Feature Name

Extension Lifecycle, Revocation, Removal, Health, and Reinstallation Recovery

## Goal

Give a PostFlow user safe, understandable control over every Chrome extension
installation and Facebook connection owned by that user.

The user must be able to:

- Know whether an extension is online, offline, publishing, paused, or needs
  Facebook attention.
- Rename an extension without allowing duplicate names for the same PostFlow
  user.
- Pause and resume work without losing the connection.
- Disconnect an extension so it cannot continue using worker APIs.
- Remove a connection from the normal dashboard without deleting ownership or
  audit history.
- Reinstall the Chrome extension as a new installation and explicitly reconnect
  it to an existing logical Facebook connection when appropriate.

The system must never silently reactivate a paused, revoked, replaced, or
removed extension through an ordinary register or heartbeat request.

---

## Mandatory Product Decisions

The following decisions are part of this feature:

1. An extension reinstall receives a new `extensionInstanceId`.
2. An old instance ID is never automatically reused.
3. A `FacebookConnection` is the durable logical identity. Groups, jobs,
   history, and display name remain attached to it across a permitted
   reinstallation.
4. An `ExtensionInstallation` represents one concrete installation inside one
   Chrome Profile.
5. Reconnecting a new installation to an existing connection requires an
   explicit user decision. Matching user or Facebook identity alone is not
   sufficient to rebind automatically.
6. Removing a connection is a soft archive plus worker revocation. It is not a
   destructive database delete.
7. Administrative lifecycle, live connectivity, Facebook health, and worker
   activity are separate state dimensions. They must not be collapsed into one
   ambiguous `status` field or UI label.
8. `BLOCKED` means Facebook blocked or interrupted the worker. It must not be
   used to represent a user-initiated pause or revocation.
9. Only one active extension installation may control one Facebook connection
   at a time.
10. Archived connection names remain reserved. Reconnecting the archived
    connection preserves its name; creating a separate connection requires a
    different name.

---

## Identity Model

The target identity chain is:

```text
PostFlow User
    |
    +-- FacebookConnection (durable logical identity)
            |
            +-- ExtensionInstallation A (old/offline/revoked)
            +-- ExtensionInstallation B (current active installation)
            |
            +-- Groups
            +-- Publishing Jobs
            +-- Publishing and analytics history
```

### Facebook Connection

`FacebookConnection` remains stable across an approved reinstall. It owns:

- The expected Facebook account identity.
- The user-visible unique name.
- Synced groups.
- Publishing targets and jobs through `facebookConnectionId`.
- Connection-level audit and operational history.
- The binding to the currently active installation.

### Extension Installation

`ExtensionInstallation` represents one installed copy of the extension. It
owns:

- `extensionInstanceId`.
- Device/installation credential metadata.
- Administrative lifecycle state.
- Last heartbeat and last successful API activity.
- Revocation, replacement, and removal metadata.
- The Facebook connection to which it is currently bound.

`chrome.runtime.id` must not be used as the installation identity. It identifies
the extension package and may be shared by many installations or profiles.

The extension instance ID remains stored in `chrome.storage.local`. Removing
the extension can remove that storage; therefore a later installation creates
a new instance ID by design.

---

## State Model

### 1. Administrative Installation Lifecycle

```ts
type ExtensionLifecycleStatus =
  | "ACTIVE"
  | "PAUSED"
  | "REVOKE_PENDING"
  | "REVOKED";
```

- `ACTIVE`: May claim new work when all other safety checks pass.
- `PAUSED`: Remains connected and reports heartbeats, but cannot claim new
  publishing or maintenance work.
- `REVOKE_PENDING`: New claims are blocked. An already-running publishing job
  may finish and report its result before final revocation.
- `REVOKED`: Worker credentials and all worker operations are rejected.

Revocation metadata should include:

```ts
type RevocationMetadata = {
  revokedAt?: Date;
  revokedByClerkUserId?: string;
  revocationReason?: "USER_DISCONNECTED" | "REMOVED" | "REPLACED" | "SECURITY";
  replacedByInstallationId?: string;
};
```

### 2. Connection Visibility Lifecycle

The logical Facebook connection has an optional `archivedAt` timestamp.

- Not archived: visible in the normal Connections page.
- Archived: hidden from the normal list and visible in an Archived section.
- Restore: clears `archivedAt` only after the user explicitly reconnects or
  restores the connection.

There is no hard-delete action in the initial release.

### 3. Connectivity

Connectivity is derived, not manually stored as an authoritative lifecycle
state:

```text
ONLINE  = last heartbeat is within the configured online window
OFFLINE = heartbeat is missing or older than the online window
```

The initial online window is two minutes because the current heartbeat runs
once per minute. The API should return `isOnline` and the calculated reason so
web and extension clients use the same rule.

An uninstall cannot be detected reliably at the moment it occurs. The old
installation naturally becomes offline when its heartbeat expires.

### 4. Worker Activity and Facebook Health

Existing worker and Facebook states remain operational signals, including:

- `IDLE`
- `PUBLISHING`
- `BLOCKED`
- `LOGIN_REQUIRED`
- `ACCOUNT_MISMATCH`
- `CHECKPOINT_OR_VERIFICATION`
- `CAPTCHA_OR_CHALLENGE`
- `MANUAL_INTERVENTION_REQUIRED`

These states do not override administrative revocation. A revoked extension is
revoked even if its last worker status was `IDLE` or `PUBLISHING`.

---

## User Actions

### Rename

- Names are unique per PostFlow user after Unicode normalization, trimming,
  whitespace collapsing, and case folding.
- The backend is the source of truth.
- The extension stores a new local name only after the backend accepts it.
- Archived connections keep their names reserved.

### Pause

- Immediately block new publishing and maintenance claims in the backend.
- Keep heartbeat and status reporting enabled.
- Allow an already-running job with a valid lease to finish and save its final
  result.
- Show `Paused` in both dashboard and popup.

### Resume

- Allowed only for a non-revoked installation still bound to the connection.
- Return lifecycle status to `ACTIVE`.
- Revalidate Facebook identity before claiming new work.

### Disconnect

The default disconnect is graceful:

1. Set lifecycle to `REVOKE_PENDING`.
2. Block all new claims immediately.
3. Allow the active leased job to finish or its lease to expire.
4. Revoke the installation credential.
5. Set lifecycle to `REVOKED`.
6. Keep the logical connection visible with a `Disconnected` state.

An explicit emergency `Force disconnect` may revoke immediately after a strong
confirmation. The UI must warn that Facebook may already have accepted an
in-flight post and its final result may be unavailable.

### Remove from Connections

Remove performs:

```text
revoke active installation
        +
archive logical Facebook connection
        +
retain connection, group, job, and audit records
```

The removed extension must not reappear when it sends register or heartbeat.
The archived connection is available from an Archived Connections view.

### Restore or Reconnect

Restore never happens through a normal heartbeat. It requires an authenticated
dashboard action and a one-time reconnect approval.

---

## Registration and Heartbeat Rules

The current behavior that reactivates an existing installation on every
register or heartbeat must be removed.

Registration must return an explicit outcome:

```ts
type RegistrationOutcome =
  | { status: "ACTIVE"; connectionId: string }
  | { status: "PAUSED"; connectionId: string }
  | { status: "RECOVERY_AVAILABLE"; candidates: RecoveryCandidate[] }
  | { status: "REVOKED"; reason: string }
  | { status: "NEW_INSTALLATION" };
```

Rules:

- Known `ACTIVE` instance: refresh heartbeat and continue.
- Known `PAUSED` instance: refresh heartbeat but do not reactivate.
- Known `REVOKE_PENDING` instance: report desired shutdown behavior.
- Known `REVOKED` instance: return `403` for worker operations and never
  reactivate it.
- Unknown/new instance: register as a new unbound installation, then complete
  new-connection or recovery flow.
- A revoked instance tombstone must be retained so deleting a document cannot
  cause automatic recreation through upsert.

Heartbeat should return the backend's desired lifecycle state. Backend claim
filters enforce pause/revoke immediately even before the next heartbeat reaches
the browser.

---

## Worker Credential and Revocation

The target implementation must not rely only on caller-supplied
`x-clerk-user-id` and `x-extension-instance-id` headers.

After an installation is approved, the backend issues a random installation
credential. The extension stores it locally and sends it with worker requests.
The backend stores only a hash and token version.

Conceptually:

```text
x-extension-instance-id: pfi_...
authorization: Bearer <installation credential>
```

Revocation increments the credential version or removes the credential hash.
Requests with an old credential fail closed.

The exact credential transport may use a dedicated header if required, but it
must not be logged or exposed to the webpage DOM.

Dashboard management endpoints continue to use authenticated Clerk server
sessions and must verify that the target connection belongs to the current
PostFlow user.

---

## Job and Maintenance Behavior

Every new claim must require:

```text
installation lifecycle == ACTIVE
connection is not archived
installation is the active binding for the connection
Facebook identity is verified
job.facebookConnectionId == connection._id
```

This applies to:

- Publishing claims.
- Pending-approval maintenance claims.
- Engagement analytics claims.
- Manual maintenance requests executed by the extension.

Paused or `REVOKE_PENDING` installations may submit the result only for work
they claimed before the state transition and only with the valid lease or
execution token.

Revoked or replaced installations cannot claim, read, navigate to, or update
new work. Final-result grace behavior ends when the existing lease expires.

Queued jobs are not silently canceled when an extension is paused, offline, or
revoked. They should be reported as waiting for an active connection and may be
reassigned only through an explicit product workflow.

---

## Reinstallation and Recovery Flow

### Default Behavior

Removing and loading the extension again creates a new
`extensionInstanceId`. The old installation becomes offline and remains in
history.

The new installation must not automatically inherit the old connection.

### Recovery Candidate

After PostFlow user identity and Facebook identity are verified, the backend
may identify recoverable connections owned by the same PostFlow user.

A candidate may be offered when:

- Its active installation is offline, revoked, or missing.
- The expected Facebook user ID matches the newly detected Facebook user ID.
- The connection is not currently publishing through another active instance.

Identity matching only creates a suggestion. It does not authorize the rebind.

### User Experience

The user sees:

> We found a previous connection named “Office PC” for this Facebook account.

Actions:

- `Reconnect Office PC`
- `Create a new connection`
- `Cancel`

If the previous installation is still online, the reconnect action must show a
replacement warning and require stronger confirmation.

Archived or explicitly revoked connections are not suggested automatically in
the normal new-install flow. They can be restored from Archived Connections.

### Atomic Rebind

An approved reconnect must atomically:

1. Verify dashboard ownership and one-time approval.
2. Verify the new installation and detected Facebook identity.
3. Block both old and new workers from claiming during the swap.
4. Revoke the old installation with reason `REPLACED`.
5. Bind the new installation to the existing `FacebookConnection`.
6. Preserve the connection ID, name, groups, jobs, and history.
7. Make the new installation the only active worker.
8. Clear `archivedAt` only when the action is an explicit archived restore.

The operation must be idempotent and safe if the browser retries it.

---

## Dashboard UX

Each normal connection row should show:

- Unique display name.
- Facebook identity summary.
- Administrative lifecycle: Active, Paused, Disconnecting, Disconnected.
- Connectivity: Online or Offline.
- Worker/Facebook health.
- Last heartbeat and last activity.
- Current extension instance, masked.

Action menu:

- Rename.
- Pause or Resume.
- Disconnect.
- Force disconnect, behind a separate warning.
- Remove from Connections.

Archived view actions:

- View history.
- Restore/Reconnect.
- Keep archived.

The UI must not label a paused extension as offline when heartbeats are still
arriving. It must not label a revoked extension as merely offline.

Confirmation dialogs must explain the effect on active and queued jobs.

---

## Extension Popup UX

The popup should show one primary lifecycle message:

- `Connected and ready`
- `Paused from PostFlow dashboard`
- `Disconnecting after current task`
- `Disconnected from PostFlow`
- `Reconnect approval required`
- `Open PostFlow dashboard to connect`

Facebook health appears separately:

- `Facebook ready`
- `Login required`
- `Wrong Facebook account`
- `Facebook blocked or verification required`

When paused, the popup can link to the dashboard but cannot resume itself
unless the current product permissions explicitly allow it. A revoked extension
must not silently create a new connection using the same stored instance ID.

---

## Backend API Surface

Exact route naming may follow current Nest conventions, but the feature needs
equivalents of:

```text
GET    /api/extensions/connections
PATCH  /api/extensions/connections/:id/name
POST   /api/extensions/connections/:id/pause
POST   /api/extensions/connections/:id/resume
POST   /api/extensions/connections/:id/disconnect
DELETE /api/extensions/connections/:id        # soft archive, not hard delete
GET    /api/extensions/connections/archived
POST   /api/extensions/connections/:id/reconnect-approval

POST   /api/extensions/register
POST   /api/extensions/heartbeat
POST   /api/extensions/reconnect
```

All dashboard routes require the authenticated owner. Worker routes require the
installation identity and credential.

Lifecycle mutations should use idempotency guards so repeated clicks or
network retries do not create contradictory transitions.

---

## Data Constraints and Indexes

Required constraints include:

- Unique `extensionInstanceId` for non-legacy installations.
- Unique active installation binding per Facebook connection.
- Unique normalized display name per PostFlow user.
- Indexes for lifecycle status, heartbeat age, archive state, and recovery
  candidate lookup.

Historical installations may share the same `facebookConnectionId`, but only
one may be active or paused as the current binding.

Migration must preserve current connection IDs because Groups and Publishing
Jobs already use `facebookConnectionId` as durable ownership.

---

## Audit and Diagnostics

Record lifecycle events without credentials or sensitive Facebook data:

```text
INSTALLATION_REGISTERED
INSTALLATION_PAUSED
INSTALLATION_RESUMED
DISCONNECT_REQUESTED
INSTALLATION_REVOKED
CONNECTION_ARCHIVED
RECOVERY_OFFERED
RECOVERY_ACCEPTED
INSTALLATION_REPLACED
RECOVERY_REJECTED
```

Each event should contain:

- PostFlow user ID or internal user ID.
- Facebook connection ID.
- Masked extension instance ID.
- Actor and timestamp.
- Previous and next lifecycle states.
- Non-sensitive reason code.

Do not log installation credentials, cookies, complete Facebook DOM, or post
content.

---

## Migration

The migration must be idempotent and support report-only mode.

It should:

1. Add lifecycle fields to existing installations.
2. Mark currently known valid installations `ACTIVE` without changing their
   connection ownership.
3. Backfill the current installation binding for each Facebook connection.
4. Report connections with zero or multiple candidate active installations.
5. Preserve legacy records that cannot be resolved and exclude them from new
   worker claims until reviewed.
6. Add partial unique indexes only after conflicts are resolved.
7. Preserve existing normalized unique extension names.

No migration may hard-delete connections, groups, jobs, or publishing history.

---

## Required Automated Tests

### Lifecycle

- Pause blocks new claims but allows heartbeat.
- Resume restores claims only after Facebook identity verification.
- Revoked register and heartbeat cannot reactivate the installation.
- Remove archives the connection and revokes its active installation.
- Repeated pause, resume, disconnect, and remove requests are idempotent.

### Connectivity

- Recent heartbeat is online.
- Expired heartbeat is offline.
- Paused plus recent heartbeat displays paused and online.
- Revoked is never displayed as merely offline.

### Ownership and Jobs

- Paused, archived, replaced, and revoked installations receive no new jobs.
- A pre-pause leased job may persist its valid final result.
- A foreign or replaced instance cannot update a job.
- Queued jobs remain recoverable and are not silently canceled.

### Reinstallation

- Reinstall creates a new instance ID.
- A matching old connection is suggested but not automatically rebound.
- User approval atomically replaces the old installation.
- Old credentials fail immediately after replacement.
- Connection ID, name, groups, and jobs remain unchanged after reconnect.
- Concurrent reconnect attempts produce only one active installation.
- An active connection requires replacement confirmation.
- Archived connections require explicit restore flow.

### Security

- Missing, invalid, expired, or revoked installation credentials fail closed.
- Dashboard user cannot mutate another user's connection.
- Worker credential is never returned in connection list APIs or logs.

### UI

- Every lifecycle state has a distinct label and action set.
- Destructive actions require confirmation.
- Popup follows backend desired state.
- Recovery choice clearly distinguishes reconnect from create new.

---

## Manual Validation

Use two Chrome Profiles owned by the same PostFlow user:

1. Connect both with different Facebook accounts and names.
2. Pause one and verify only the other claims work.
3. Resume it and verify identity before work restarts.
4. Disconnect one and confirm register/heartbeat cannot reactivate it.
5. Remove it and confirm it disappears from the normal list.
6. Remove the Chrome extension and load it again.
7. Confirm the reinstalled extension has a new instance ID.
8. Confirm it offers recovery but does not automatically bind.
9. Reconnect it and verify the old installation is revoked.
10. Confirm Groups, jobs, history, and display name remain on the same
    Facebook connection ID.
11. Attempt simultaneous recovery from two profiles and confirm only one wins.
12. Validate graceful disconnect during an active publishing job without a
    duplicate Facebook post.

Manual browser and Facebook validation must be recorded in `progress.md`. It
must not be marked passed without the user's confirmation.

---

## Rollout and Rollback

Roll out in stages:

1. Add schema fields and read-only lifecycle reporting.
2. Backfill and audit existing bindings.
3. Enforce lifecycle on backend job claims.
4. Enable pause/resume for internal testing.
5. Enable graceful disconnect and archive.
6. Enable popup lifecycle enforcement.
7. Enable explicit reinstall recovery for test users.
8. Enable installation credentials and revoke old header-only access.
9. Complete multi-profile live validation before general release.

Rollback must disable new UI actions without removing lifecycle tombstones.
Revoked installations must not be reactivated as part of rollback. Existing
jobs and connection ownership remain intact.

---

## Out of Scope

- Hard deletion of publishing history.
- Automatic machine fingerprinting.
- Automatically trusting a reinstall because it uses the same filesystem path,
  Chrome extension package ID, PostFlow user, or Facebook user.
- Multiple simultaneously active installations for one Facebook connection.
- Automatic reassignment of queued jobs to a different Facebook account.
- Remote uninstall of the Chrome extension itself.

---

## Definition of Done

The feature is complete when:

- Lifecycle, connectivity, Facebook health, and worker activity are modeled
  and displayed independently.
- Pause/resume works without new claims leaking to paused workers.
- Disconnect prevents ordinary registration or heartbeat from reactivating an
  installation.
- Remove is a safe revoke-plus-archive operation.
- Reinstall creates a new instance ID.
- Explicit recovery can bind the new installation to the durable old
  connection while revoking the previous installation.
- Only one active installation can own a Facebook connection.
- Worker credentials are revocable and worker endpoints fail closed.
- Names, Groups, jobs, and history survive an approved reconnect.
- Automated lifecycle, ownership, race, and security tests pass.
- Manual two-profile reinstall and active-job validation passes.
- Migration, rollout, monitoring, and rollback steps are documented and
  verified.
