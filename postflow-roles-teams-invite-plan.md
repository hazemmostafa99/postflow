# PostFlow Roles, Teams & Invite-Only Access — Implementation Overview

## 1. Goal

PostFlow currently uses Clerk for authentication.

We want to move to an **invite-only internal company model** with the following roles:

- `ADMIN`
- `MANAGER`
- `TEAM_LEADER`
- `SALES`

There is currently **one company only**. We are not designing for multi-tenancy or multiple organizations at this stage.

Clerk should remain responsible for **authentication, sessions, identity, and invitations**.

PostFlow's own backend/database should remain the **source of truth for roles, teams, and permissions**.

---

## 2. Core Access Model

There should be **no public signup flow**.

The application should expose a normal Sign In page, while new users enter PostFlow only after receiving an invitation.

High-level flow:

```text
Admin
  ↓
Invite User
  ↓
Choose Role
  ↓
Choose Team if required
  ↓
Create Pending Invite
  ↓
Send Clerk Invitation
  ↓
User Accepts Invitation
  ↓
Clerk User Created / Authenticated
  ↓
PostFlow links Clerk user to Pending Invite
  ↓
PostFlow User becomes ACTIVE
```

The first Admin account can be created manually during initial setup.

---

## 3. Roles

### ADMIN

Admin is the highest-level application role.

Expected permissions:

- Invite any user.
- Invite another Admin.
- Invite Managers.
- Invite Team Leaders.
- Invite Sales users.
- Create teams.
- Update teams.
- Assign/change users' roles.
- Assign/change users' teams.
- Replace a Team Leader.
- Disable/remove users.
- View all teams and users.
- Access all company-level data.

Admin does not need to belong to a team.

---

### MANAGER

Manager is a company-level role.

Initial expected permissions:

- View all teams.
- View Team Leaders and Sales users.
- Manage operational data according to PostFlow business requirements.
- Optionally invite `TEAM_LEADER` and `SALES` users if this permission is enabled.

Manager does not need to belong to a team.

For the first implementation, Manager should not require a `teamId`.

---

### TEAM_LEADER

A Team Leader belongs to exactly **one team**.

Rules:

- `teamId` is required.
- A Team Leader cannot belong to multiple teams.
- Each team can have only **one active Team Leader**.
- A user cannot be assigned as Team Leader to a team that already has another active Team Leader unless the existing leader is first removed/reassigned/replaced.

Expected permissions:

- View their own team.
- View Sales users in their own team.
- Perform team-level PostFlow actions allowed by business requirements.
- Must not manage other teams unless explicitly allowed later.

---

### SALES

A Sales user belongs to exactly **one team**.

Rules:

- `teamId` is required.
- A Sales user cannot belong to multiple teams.
- Sales users should only access data allowed for their own role/team.

---

## 4. Team Rules

Each Team has:

- One optional/required Team Leader depending on team lifecycle.
- Zero or more Sales users.

Business constraints:

```text
Team
├── Team Leader: max 1
├── Sales: many
├── Sales: many
└── Sales: many
```

A Team Leader belongs to one team only.

A Sales user belongs to one team only.

`ADMIN` and `MANAGER` are not assigned to teams by default.

---

## 5. Role-to-Team Validation

The backend must enforce these rules.

| Role | teamId |
|---|---|
| ADMIN | Not required |
| MANAGER | Not required |
| TEAM_LEADER | Required |
| SALES | Required |

Pseudo-rule:

```text
if role in [TEAM_LEADER, SALES]:
    teamId must exist

if role in [ADMIN, MANAGER]:
    teamId should normally be null
```

Additional Team Leader rule:

```text
if role == TEAM_LEADER:
    selected team must not already have another active Team Leader
```

Do not rely only on frontend validation.

These rules must be validated on the backend.

---

## 6. Clerk Responsibilities

Clerk should handle:

- User authentication.
- Sign In.
- Session management.
- Password/OAuth if enabled.
- Email verification.
- User identity.
- Sending/accepting invitations.
- Creating/identifying the Clerk user account.

PostFlow should NOT depend on Clerk as the main source of truth for business permissions.

Avoid duplicating role/team state inside Clerk unless there is a specific technical reason later.

---

## 7. PostFlow Backend Responsibilities

PostFlow should handle:

- Application users.
- Roles.
- Teams.
- User/team relationships.
- Invite metadata.
- Authorization.
- Team Leader uniqueness.
- User status.
- Permission checks.

Every authenticated request should conceptually resolve:

```text
Clerk Session
   ↓
clerkUserId
   ↓
PostFlow User
   ↓
role + teamId + status
   ↓
Authorization decision
```

---

## 8. Suggested User Model

Conceptual model:

```ts
User {
  id
  clerkUserId
  email

  role
  teamId

  status

  createdAt
  updatedAt
}
```

Suggested role enum:

```ts
enum UserRole {
  ADMIN
  MANAGER
  TEAM_LEADER
  SALES
}
```

Suggested user status:

```ts
enum UserStatus {
  ACTIVE
  DISABLED
}
```

Rules:

- `clerkUserId` should be unique.
- `email` should normally be unique.
- `teamId` is nullable for `ADMIN` and `MANAGER`.
- `teamId` is required by business validation for `TEAM_LEADER` and `SALES`.

---

## 9. Suggested Team Model

Conceptual model:

```ts
Team {
  id
  name

  createdAt
  updatedAt
}
```

Do not necessarily store `teamLeaderId` directly if the leader can be derived from:

```text
User.role = TEAM_LEADER
AND
User.teamId = Team.id
```

However, the implementation must guarantee that only one active Team Leader exists per team.

This can be enforced through:

- Backend transaction/validation.
- And, if supported cleanly by the database design, an additional database-level constraint.

Backend validation is mandatory even if a DB constraint is added.

---

## 10. Suggested Invitation Model

PostFlow should store invitation metadata before sending the Clerk invite.

Conceptual model:

```ts
Invitation {
  id

  email
  role
  teamId

  status

  clerkInvitationId

  invitedByUserId

  expiresAt
  acceptedAt

  createdAt
  updatedAt
}
```

Suggested invitation status:

```ts
enum InvitationStatus {
  PENDING
  ACCEPTED
  REVOKED
  EXPIRED
}
```

Important:

The selected `role` and `teamId` should be stored **before** the Clerk invite is sent.

Example:

```text
email: ali@company.com
role: SALES
teamId: team_123
status: PENDING
```

When the invite is accepted and the Clerk user is known:

```text
clerkUserId: user_xxx
email: ali@company.com
role: SALES
teamId: team_123
status: ACTIVE
```

---

## 11. Invite User Flow

### Admin opens Invite User

Form fields:

```text
Email
Role
Team
```

Role options:

```text
ADMIN
MANAGER
TEAM_LEADER
SALES
```

### Conditional Team field

If role is:

```text
TEAM_LEADER
SALES
```

then Team becomes required.

If role is:

```text
ADMIN
MANAGER
```

Team should be hidden or disabled.

---

## 12. Invite Validation

Before sending the Clerk invite, validate:

### Common validation

- Email is valid.
- Email is not already attached to an active PostFlow user.
- There is no conflicting pending invitation.
- Role is valid.
- Inviting user has permission to create this role.

### Team validation

For `TEAM_LEADER` or `SALES`:

- `teamId` must be supplied.
- Team must exist.
- Team must be active/usable.

### Team Leader validation

For `TEAM_LEADER`:

- The team must not already have another active Team Leader.
- Optionally also prevent two simultaneous pending Team Leader invites for the same team.

This second rule is important.

Without it, two admins could create two pending Team Leader invitations for the same team.

Recommended rule:

```text
A team may have:
- max 1 ACTIVE Team Leader
- max 1 PENDING Team Leader invitation
```

---

## 13. Invite Transaction Flow

Recommended sequence:

```text
1. Admin submits invite.
2. Backend validates role/team rules.
3. Backend creates PENDING invitation.
4. Backend creates Clerk invitation.
5. Save Clerk invitation ID on PostFlow invitation.
6. Clerk sends invitation email.
```

If Clerk invitation creation fails, do not leave a valid orphan pending invite.

Use a transaction/cleanup strategy.

---

## 14. Invitation Acceptance Flow

When the invited user accepts the invitation:

```text
1. Clerk authenticates/creates the user.
2. PostFlow receives or detects the authenticated Clerk user.
3. Identify the matching PENDING invitation.
4. Verify invitation email matches authenticated Clerk user.
5. Revalidate invitation status.
6. Revalidate role/team constraints.
7. Create or activate PostFlow User.
8. Assign role.
9. Assign teamId if required.
10. Mark Invitation as ACCEPTED.
11. Set acceptedAt.
```

The system should never trust a role/team sent from the frontend during invitation acceptance.

Use the role/team stored on the server-side Invitation record.

---

## 15. Authorization Model

Authentication and authorization are separate.

Clerk answers:

```text
Who is this user?
```

PostFlow answers:

```text
What can this user do?
```

Typical backend request flow:

```text
Authenticated Clerk user
        ↓
Find PostFlow User by clerkUserId
        ↓
Check User.status == ACTIVE
        ↓
Read role
        ↓
Read teamId if relevant
        ↓
Apply permission rule
```

---

## 16. Example Permission Matrix

This can evolve later.

| Action | Admin | Manager | Team Leader | Sales |
|---|---:|---:|---:|---:|
| View all users | Yes | Yes | No | No |
| Create teams | Yes | Optional | No | No |
| Invite Admin | Yes | No | No | No |
| Invite Manager | Yes | No | No | No |
| Invite Team Leader | Yes | Optional | No | No |
| Invite Sales | Yes | Optional | No | No |
| View all teams | Yes | Yes | No | No |
| View own team | Yes | Yes | Yes | Yes/Optional |
| Manage team Sales | Yes | Optional | Yes | No |
| Change roles | Yes | Limited/No | No | No |

For the first implementation, keep authorization explicit and simple rather than creating a large generic permission engine.

---

## 17. Replacing a Team Leader

Because each team has only one Team Leader, replacing one needs an explicit workflow.

Recommended behavior:

```text
Team A
Current Leader: Ahmed

Admin wants Sara to become Team Leader.
```

Possible flow:

```text
1. Admin selects Replace Team Leader.
2. Backend verifies Admin permission.
3. Existing leader is demoted/reassigned/removed from Team Leader role.
4. Sara becomes TEAM_LEADER for Team A.
5. Operation happens atomically.
```

Do not temporarily allow two active Team Leaders.

The exact destination role for the old Team Leader must be decided by the UI/action.

Examples:

- Change old leader to `SALES` in the same team.
- Move old leader to another team.
- Change them to `MANAGER`.
- Disable/remove them.

Do not silently guess.

---

## 18. Changing a User's Role

Every role change should re-run role/team validation.

Examples:

### SALES → MANAGER

```text
teamId should become null
```

### MANAGER → SALES

```text
teamId is required
```

### SALES → TEAM_LEADER

```text
same/new team must not already have another Team Leader
```

### TEAM_LEADER → SALES

```text
team can remain the same
```

After changing a Team Leader away from `TEAM_LEADER`, their previous team becomes leaderless until another Team Leader is assigned.

That state can be allowed temporarily unless business requirements say every team must always have a leader.

---

## 19. Disabling Users

Prefer disabling users instead of immediately deleting them.

Example:

```text
status = DISABLED
```

Backend authorization should block disabled users even if Clerk still has a valid user account/session.

Optionally also disable/revoke access on the Clerk side.

If a disabled user is a Team Leader, the backend must decide what happens to their team leadership.

Recommended:

- Do not disable a Team Leader without handling the team leader assignment.
- Either replace the leader first or explicitly leave the team leaderless.

---

## 20. UI Pages Needed

Likely admin UI:

```text
/users
/users/invite
/teams
/teams/:teamId
```

### Users page

Show:

- Name/email
- Role
- Team
- Status
- Actions

### Invite User modal/page

Fields:

```text
Email
Role
Team (conditional)
```

### Teams page

Show:

```text
Team Name
Team Leader
Sales Count
```

### Team details

Show:

```text
Team name
Team Leader
Sales members
Actions
```

---

## 21. Recommended Backend Modules

Keep responsibilities separated.

Example:

```text
auth/
users/
teams/
invitations/
authorization/
```

Possible service separation:

```text
AuthService
UserService
TeamService
InvitationService
AuthorizationService
```

Do not put all Clerk + role + team logic into one route/controller.

---

## 22. Suggested API Responsibilities

Exact URLs can follow the existing PostFlow API conventions.

Conceptually:

```text
POST   /invitations
GET    /invitations
DELETE /invitations/:id

GET    /users
GET    /users/:id
PATCH  /users/:id
PATCH  /users/:id/role
PATCH  /users/:id/status

GET    /teams
POST   /teams
GET    /teams/:id
PATCH  /teams/:id
DELETE /teams/:id
```

Possible dedicated action:

```text
PATCH /teams/:id/team-leader
```

This may be cleaner than trying to update multiple users manually from the frontend.

---

## 23. Backend Invariants

These must always remain true:

```text
1. Every PostFlow user has exactly one role.

2. SALES users have exactly one team.

3. TEAM_LEADER users have exactly one team.

4. ADMIN users do not require a team.

5. MANAGER users do not require a team.

6. A Team has at most one ACTIVE Team Leader.

7. A Team should have at most one PENDING Team Leader invite.

8. Roles and teams come from PostFlow DB, not from untrusted client state.

9. Every protected request resolves the authenticated Clerk user to a PostFlow user.

10. Disabled users cannot access protected PostFlow functionality.
```

---

## 24. Important Security Rules

Do not trust:

```text
role from frontend
teamId from session UI state
userId from request without authorization checks
```

Always verify server-side.

For team-scoped users:

```text
TEAM_LEADER / SALES
```

the backend should use the authenticated user's stored `teamId` when possible instead of trusting arbitrary team IDs sent by the client.

Example:

A Team Leader requesting:

```text
GET /teams/team_b/sales
```

must not get access if their own `teamId` is `team_a`.

---

## 25. Clerk Webhooks / Synchronization

Use Clerk webhooks where useful for identity lifecycle events.

Examples:

```text
user.created
user.updated
user.deleted
```

However, role/team assignment should still be controlled by PostFlow.

Recommended idea:

- Clerk events synchronize identity information.
- PostFlow invitation acceptance logic assigns business role/team.

Do not automatically create an unrestricted active PostFlow user for every Clerk user.

A Clerk user without a valid PostFlow invitation/assignment should not gain application access.

---

## 26. Existing Users Migration

If PostFlow already has users from the old public signup system, decide how to migrate them.

Recommended migration:

```text
1. Map existing Clerk users to PostFlow User records.
2. Assign an explicit role to every existing user.
3. Assign teamId for SALES/TEAM_LEADER users.
4. Make the initial trusted owner/admin an ADMIN.
5. Disable public signup.
6. Enable invite-only onboarding.
```

No user should remain without a known application role after migration.

---

## 27. Recommended Implementation Order

### Phase 1 — Database

Add/update:

```text
UserRole
UserStatus
Team
User.teamId
Invitation
InvitationStatus
```

Add uniqueness/index constraints where appropriate.

---

### Phase 2 — Authorization Foundation

Create reusable backend checks:

```text
requirePostFlowUser
requireActiveUser
requireRole(...)
requireTeamAccess(...)
```

Centralize these checks.

---

### Phase 3 — Team Management

Implement:

```text
Create team
List teams
View team
Update team
```

---

### Phase 4 — Invitation Flow

Implement:

```text
Create invitation
Role/team validation
Clerk invitation creation
Pending invite storage
Accept/link invite
Revoke invitation
```

---

### Phase 5 — User Management

Implement:

```text
List users
Change role
Change team
Disable user
Replace Team Leader
```

---

### Phase 6 — Frontend

Implement:

```text
Users page
Invite User UI
Teams page
Team details
Role-aware navigation/actions
```

Frontend permission checks improve UX but are not a substitute for backend authorization.

---

## 28. MVP Decisions

For the first version:

```text
Single company only
No Clerk Organizations
Invite-only access
No public signup
PostFlow DB owns roles
PostFlow DB owns teams
One role per user
One team per Sales user
One team per Team Leader
One Team Leader per team
Admin has global access
Manager is global/company-level
```

Do not add complex RBAC tables unless required later.

An enum-based role model is enough for the MVP.

---

## 29. Future Extensions

Possible later additions:

- Multiple companies/organizations.
- Managers assigned to specific teams.
- Multiple permission sets per role.
- Custom roles.
- Audit log.
- Invitation resend.
- Invitation expiration UI.
- User transfer between teams.
- Temporary role assignment.
- Multiple Team Leaders if business requirements change.
- Clerk Organizations if PostFlow becomes multi-tenant.

Do not build these prematurely.

---

## 30. Final Architecture Summary

```text
                    Clerk
        ┌─────────────────────────┐
        │ Authentication          │
        │ Sessions                │
        │ Identity                │
        │ Email verification      │
        │ Invitations             │
        └────────────┬────────────┘
                     │
                     │ clerkUserId
                     ▼
              PostFlow Backend
        ┌─────────────────────────┐
        │ User                    │
        │ Role                    │
        │ Team                    │
        │ Invitation metadata     │
        │ Authorization           │
        │ Business rules          │
        └────────────┬────────────┘
                     │
                     ▼
                  Database
```

Main principle:

> Clerk decides who the user is. PostFlow decides what the user is allowed to do.

