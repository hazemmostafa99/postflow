# Post Visibility Scopes - Progress

## Goal

Apply role-based post visibility:

```text
ADMIN       -> ALL
MANAGER     -> ALL
TEAM_LEADER -> DIRECT_TEAM
SALES       -> OWN
```

## Source Documents

- `features/post-visibility-scopes/feature.md`

---

# Phase 1 - Feature Definition

## Checklist

- [x] Define role-to-scope mapping.
- [x] Define manager all-post visibility rule.
- [x] Define team leader direct-team rule.
- [x] Define sales own-post rule.
- [x] Confirm no schema change is required.

## Review Notes

```text
Status: COMPLETE

Files changed:
- features/post-visibility-scopes/feature.md
- features/post-visibility-scopes/progress.md

Implementation:
- Feature specification created before code changes.
```

---

# Phase 2 - Backend Visibility Filter

## Checklist

- [x] Inject required auth, user, and team dependencies into PostsService.
- [x] Resolve the active PostFlow user from `x-clerk-user-id`.
- [x] Build post filters by role.
- [x] Apply filters to list posts.
- [x] Apply filters to paginated posts.
- [x] Apply filters to single post reads.
- [x] Apply filters to schedule/control mutations.
- [x] Apply filters to bulk delete.

## Review Notes

```text
Status: COMPLETE

Files changed:
- apps/api/src/posts/posts.service.ts
- apps/api/src/posts/posts.module.ts

Implementation:
- PostsService now resolves the active PostFlow user before post reads and
  post-level mutations.
- ADMIN receives an unscoped post filter.
- MANAGER receives all posts in the company, like ADMIN.
- TEAM_LEADER receives posts from members with the same `teamId`.
- SALES receives only posts where `Post.clerkUserId` matches the authenticated
  Clerk user.
- The same visibility filter is applied to list, paginated list, detail,
  schedule updates, pause/resume/cancel, and bulk delete.

Tests/checks:
- `npm run build` in `apps/api` passes.

Known limitations:
- Focused automated scope tests are not added yet.
- The manager scope update to `ALL` has not been covered by an automated test.
```

---

# Phase 3 - Verification

## Checklist

- [x] Run API build.
- [ ] Add or update focused tests if practical.
- [ ] Verify admin filter is unscoped.
- [ ] Verify manager filter is unscoped.
- [ ] Verify team leader filter uses direct team members.
- [ ] Verify sales filter uses own posts only.

## Review Notes

```text
Status: IN PROGRESS

Files changed:
- apps/api/src/posts/posts.service.ts
- apps/api/src/posts/posts.module.ts

Tests/checks:
- `npm run build` in `apps/api` passes.

Known limitations:
- Role-specific automated tests are still pending.
```

---

# Phase 4 - Created By Display

## Checklist

- [x] Include creator metadata in post list responses.
- [x] Include creator metadata in post detail responses.
- [x] Add a Created by column to the posts table.
- [x] Show creator metadata on the post detail header.
- [x] Fall back to Clerk user ID when a PostFlow user record is missing.

## Review Notes

```text
Status: COMPLETE

Files changed:
- apps/api/src/posts/posts.service.ts
- apps/web/src/app/(dashboard)/posts/page.tsx
- apps/web/src/app/(dashboard)/posts/[id]/page.tsx
- features/post-visibility-scopes/feature.md
- features/post-visibility-scopes/progress.md

Implementation:
- PostsService now attaches `createdBy` to list and detail responses.
- Posts list displays creator email or Clerk user ID plus role when available.
- Post details header displays the same creator information.

Tests/checks:
- `npm run build` in `apps/api` passes.
- `npm run build` in `apps/web` passes when rerun outside the sandbox after
  the sandboxed build hit `spawn EPERM` during the TypeScript phase.

Known limitations:
- No dedicated UI snapshot or role-scope tests yet.
```

---

# Phase 5 - User Names

## Checklist

- [x] Add optional `firstName` and `lastName` fields to PostFlow users.
- [x] Sync Clerk first/last names through `/api/auth/me`.
- [x] Preserve and update names for existing provisioned users.
- [x] Accept optional names during invitation acceptance.
- [x] Include `firstName`, `lastName`, and `fullName` in post creators.
- [x] Prefer full name in posts UI creator labels.
- [x] Support names in the admin creation script.

## Review Notes

```text
Status: COMPLETE

Files changed:
- apps/api/src/schemas/user.schema.ts
- apps/api/src/auth/auth.controller.ts
- apps/api/src/auth/authorization.service.ts
- apps/api/src/users/users.service.ts
- apps/api/src/invitations/invitations.controller.ts
- apps/api/src/invitations/invitations.service.ts
- apps/api/src/posts/posts.service.ts
- apps/api/src/analytics/analytics.service.ts
- apps/api/scripts/create-admin.mjs
- apps/web/src/app/(dashboard)/layout.tsx
- apps/web/src/app/(dashboard)/posts/page.tsx
- apps/web/src/app/(dashboard)/posts/[id]/page.tsx
- features/post-visibility-scopes/feature.md
- features/post-visibility-scopes/progress.md

Implementation:
- User records now support optional first and last names.
- Dashboard auth sync sends Clerk first/last names to the API.
- Existing users are updated when a newer Clerk name/email is available.
- Post creator metadata now includes first name, last name, and derived full
  name.
- Posts list and detail pages prefer `createdBy.fullName`, then email, then
  Clerk user ID.

Tests/checks:
- `npm run build` in `apps/api` passes.
- `npm run build` in `apps/web` passes when rerun outside the sandbox after
  the sandboxed build hit `spawn EPERM` during the TypeScript phase.

Known limitations:
- Existing users only receive names after they next load the dashboard, unless
  a separate backfill script is added later.
```

---

# Progress Summary

| Phase | Status | Reviewed |
| --- | --- | --- |
| 1. Feature definition | Complete | No |
| 2. Backend visibility filter | Complete | No |
| 3. Verification | In Progress | No |
| 4. Created by display | Complete | No |
| 5. User names | Complete | No |

---

# Implementation Workflow

Each implementation session should:

1. Read `features/post-visibility-scopes/feature.md`.
2. Read this progress file.
3. Inspect post, user, team, and authorization code.
4. Work on the first incomplete phase unless the user asks otherwise.
5. Update this progress file.
6. Run relevant checks.
7. Provide a short review summary.
