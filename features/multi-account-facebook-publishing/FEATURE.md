# Feature: Multi-Account Facebook Publishing

## Goal

Extend the existing Facebook publishing browser extension so one website user can connect and operate multiple Facebook accounts independently.

Each Facebook account should run inside its own Chrome Profile with its own isolated Facebook session.

All accounts should be able to process publishing jobs in parallel without waiting for each other.

Inside one Facebook account/session, publishing should remain sequential at first.

---

## Existing-system rule

Do **not** rewrite the current implementation from scratch.

Before implementation, inspect the existing codebase and understand:

- how the extension connects to the backend
- how the website user is identified
- how Facebook groups are collected and synced
- how publish jobs are created and delivered
- how publishing is executed
- how post success is detected
- how Post IDs are detected
- how video processing is handled
- how retries and failures currently work
- how content scripts, injected scripts, background/service worker, storage, and messaging are organized

The implementation should extend the current architecture using the smallest reasonable set of changes.

---

## Target architecture

Conceptually:

```text
Website User
    |
    +-- Facebook Connection A
    |       |
    |       +-- Extension Instance A
    |       +-- Chrome Profile A
    |       +-- Facebook Account A
    |       +-- Groups available to Account A
    |
    +-- Facebook Connection B
    |       |
    |       +-- Extension Instance B
    |       +-- Chrome Profile B
    |       +-- Facebook Account B
    |       +-- Groups available to Account B
    |
    +-- Facebook Connection C
            |
            +-- Extension Instance C
            +-- Chrome Profile C
            +-- Facebook Account C
            +-- Groups available to Account C
```

The extension codebase remains the same.

Each Chrome Profile gets an independent extension instance identity.

---

## 1. Extension Instance identity

Each extension installation/runtime inside a Chrome Profile must have a stable unique instance identifier.

The identifier should:

- persist across browser restarts
- be unique per Chrome Profile / extension instance
- be sent to the backend when the extension connects
- allow the backend to identify which worker is online

Do not use the Chrome Profile display name as the primary identity.

Do not create separate extension codebases for each Facebook account.

---

## 2. Facebook Connection

Introduce or formalize a Facebook Connection / Facebook Account entity.

Conceptual relationship:

```text
Website User
    -> Facebook Connection
        -> Extension Instance
```

A website user can own multiple Facebook Connections.

Each active Extension Instance should be associated with one Facebook Connection at a time.

---

## 3. Group ownership

Groups must be associated with the Facebook Connection that discovered them.

Do not treat a Facebook Group as belonging only to the website user.

The same group may be accessible from multiple Facebook accounts.

Conceptually, uniqueness should consider:

```text
Facebook Connection + Facebook Group
```

not only:

```text
Website User + Facebook Group
```

Group sync should therefore become:

```text
Extension Instance
    -> Facebook Connection
        -> collect groups
            -> sync groups under that Facebook Connection
```

---

## 4. Publish Job ownership

Each Publish Job must be clearly associated with the Facebook account responsible for executing it.

A job should be resolvable to at least:

- website user
- Facebook Connection
- Extension Instance / worker
- target group
- post content
- job status

An Extension Instance must never consume jobs belonging to another Facebook Connection.

---

## 5. Parallel workers

Each Extension Instance behaves as an independent worker.

Example:

```text
Extension A: A1 -> A2 -> A3 -> A4
Extension B: B1 -> B2 -> B3
Extension C: C1 -> C2 -> C3 -> C4 -> C5
```

A, B, and C may operate at the same time.

They must not wait for one another.

The system must not use one global sequential queue across all Facebook accounts.

---

## 6. Sequential publishing inside one account

For the first implementation, keep publishing sequential inside each individual Extension Instance / Facebook session.

Example:

```text
Account A:
A1 -> A2 -> A3
```

Do not initially implement:

```text
A1 + A2 + A3 simultaneously
```

Multiple accounts can operate in parallel, but each account should initially publish one job at a time.

---

## 7. Instance health and status

The backend should know the current state of each Extension Instance.

Useful states include:

- ONLINE
- OFFLINE
- IDLE
- PUBLISHING
- BLOCKED
- LOGIN_REQUIRED
- CHECKPOINT_OR_VERIFICATION
- CAPTCHA_OR_CHALLENGE
- MANUAL_INTERVENTION_REQUIRED
- ACCOUNT_MISMATCH

Reuse the current status model if one already exists.

Add heartbeat/last-seen behavior using the existing communication mechanism where possible.

---

## 8. Account identity protection

Before sensitive operations such as:

- group collection
- group sync
- publish

verify that the currently logged-in Facebook account matches the Facebook Connection assigned to the Extension Instance.

If the expected account and current account do not match:

- stop the operation
- do not publish
- do not collect groups under the wrong account
- report `ACCOUNT_MISMATCH`
- require correction before continuing

This is a critical safety requirement.

---

## 9. Fault isolation

A problem with one Facebook account must not stop other accounts.

Example:

```text
Account A -> ONLINE
Account B -> BLOCKED
Account C -> ONLINE
```

Expected behavior:

- pause Account B jobs
- keep Account A running
- keep Account C running

The same applies to:

- logout
- checkpoint
- CAPTCHA/challenge
- browser/profile offline
- extension disconnect

---

## 10. Existing interruption handling

Integrate with the existing Facebook interruption detection work.

If an instance detects:

- temporary Facebook block
- CAPTCHA/challenge
- checkpoint/verification
- login required
- Facebook error dialog

only that instance/account should pause.

Do not create a global system-wide stop unless the backend itself is unavailable.

---

## 11. Existing video/Post ID detection

Preserve the current and planned Post ID detection logic.

Video posts may temporarily enter a video-processing state.

That state must remain local to the Extension Instance handling the post.

Do not allow one instance waiting for video processing to block another instance.

---

## 12. Queue requirements

The queue architecture should conceptually support:

```text
Account A Queue -> Worker A
Account B Queue -> Worker B
Account C Queue -> Worker C
```

This does not necessarily require separate physical queues in the database.

The existing job system may be extended using routing/claiming rules based on Facebook Connection or Extension Instance.

Prefer adapting the current queue implementation instead of replacing it.

---

## 13. Reconnect behavior

If an Extension Instance disconnects temporarily:

- mark it offline after the appropriate timeout
- do not reassign its Facebook-specific jobs to another unrelated account
- preserve pending jobs
- allow processing to continue when the same instance/account reconnects

Avoid duplicate publishing after reconnect.

---

## 14. Duplicate prevention

A job must not be published twice because of:

- reconnect
- browser restart
- timeout
- temporary network failure
- extension reload
- backend retry

Reuse the existing duplicate-prevention strategy if available.

Before retrying an uncertain publish result, check whether the original post may already have been created.

---

## 15. Initial milestone

Do not start by testing 10 accounts.

Start with two isolated Chrome Profiles.

### Profile A

- Facebook Account A
- Extension Instance A
- 3 publish jobs

### Profile B

- Facebook Account B
- Extension Instance B
- 3 publish jobs

Expected execution:

```text
A1 ----------------> A2 ----------------> A3
B1 --------> B2 --------------------> B3
```

A and B operate independently.

Expected behaviors:

- A1 and B1 can run at the same time
- A2 starts when A1 finishes
- B2 starts when B1 finishes
- A does not wait for B
- B does not wait for A
- if B becomes blocked, A continues
- if A disconnects, B continues
- neither instance can execute the other's jobs

---

## 16. Scale milestone

After the two-instance implementation is stable, test with progressively more instances.

Target scenario:

- 10 Chrome Profiles
- 10 Facebook accounts
- 10 Extension Instances
- independent group collections
- independent publishing queues
- parallel execution across accounts
- sequential execution inside each account

---

## 17. Implementation constraints

Do not:

- rewrite working publishing logic
- replace the entire queue architecture without necessity
- remove existing group collection
- remove existing Post ID detection
- remove video-processing handling
- create a separate codebase per Facebook account
- tightly couple logic to Chrome Profile display names
- globally pause all accounts when one Facebook account has a problem

Prefer small reusable additions around the current implementation.

---

## 18. Required implementation process for Codex

Before writing code:

1. Inspect the current codebase.
2. Document the current extension-to-backend connection flow.
3. Locate the current website-user binding.
4. Locate group sync logic.
5. Locate publish-job creation and consumption.
6. Locate queue/retry/status logic.
7. Locate Facebook identity detection if one exists.
8. Identify the minimum required database/schema changes.
9. Identify the minimum required backend changes.
10. Identify the minimum required extension changes.
11. Present the proposed implementation order.
12. Then implement incrementally.

After each major step, verify that existing single-account behavior still works.
