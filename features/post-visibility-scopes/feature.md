# Post Visibility Scopes

## Goal

Post visibility should follow the authenticated PostFlow user's role:

```text
ADMIN
scope = ALL

MANAGER
scope = ALL

TEAM_LEADER
scope = DIRECT_TEAM

SALES
scope = OWN
```

The backend must be the source of truth. The frontend should keep sending only
the authenticated Clerk user ID; it must not send role or team scope decisions.

## Scope Rules

### ADMIN - ALL

Admins can see and operate on all posts in the company.

### MANAGER - ALL

Managers can see and operate on all posts in the company, regardless of which
team created them.

### TEAM_LEADER - DIRECT_TEAM

Team Leaders can see and operate on posts created by users in their own
`teamId`.

### SALES - OWN

Sales users can see and operate only on posts where:

```text
Post.clerkUserId = authenticated clerkUserId
```

## API Behavior

The existing posts endpoints should keep the same URLs and response shapes:

- `GET /api/posts`
- `GET /api/posts/:id`
- `PATCH /api/posts/:id/schedule`
- `POST /api/posts/:id/pause`
- `POST /api/posts/:id/resume`
- `POST /api/posts/:id/cancel`
- `DELETE /api/posts`

The backend should apply the role-based visibility filter before reading or
mutating a post.

Post read responses should include creator metadata so shared post views can
show who created each post:

```ts
createdBy: {
  clerkUserId: string;
  userId?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  role?: string;
  status?: string;
  teamId?: string | null;
}
```

Post creation remains owned by the authenticated creator:

```text
Post.clerkUserId = authenticated clerkUserId
```

Group validation during creation remains scoped to the authenticated creator's
groups.

## Data Model

PostFlow users store first and last names so shared views can display a human
creator name without depending on Clerk IDs or email-only labels.

Existing fields used:

- `Post.clerkUserId`
- `User.clerkUserId`
- `User.firstName`
- `User.lastName`
- `User.role`
- `User.teamId`

## Security Requirements

- Resolve the authenticated Clerk user to an active PostFlow user before
  applying post visibility.
- Do not trust role, team, or scope values from the client.
- Team-scoped users with no `teamId` must not accidentally receive broader
  access.
- Admin and manager scopes are unfiltered across company posts.

## Non-Goals

- Custom permission sets.
- Multi-company tenancy.
- Changing the analytics export API.
- Changing Facebook extension job claiming behavior.
