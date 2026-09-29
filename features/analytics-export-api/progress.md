# Analytics Export API - Progress

## Goal

Expose all stored PostFlow post analytics to another backend through a static API key.

```text
External backend
      ->
Authorization: Bearer POSTFLOW_ANALYTICS_API_KEY
      ->
GET /api/analytics/posts
      ->
All posts + creators + targets + engagement totals
```

## Source Documents

- `features/analytics-export-api/feature.md`

---

# Phase 1 - Static API Key Auth

## Checklist

- [x] Read `POSTFLOW_ANALYTICS_API_KEY` from config/environment.
- [x] Parse `Authorization` header.
- [x] Require `Bearer <key>` format.
- [x] Reject missing key with `401`.
- [x] Reject invalid key with `401`.
- [x] Do not require `x-clerk-user-id`.
- [x] Keep auth logic isolated for analytics/export routes.

## Review Notes

```text
Status: COMPLETE

Files changed:
- `apps/api/src/analytics/analytics.controller.ts`

Implementation:
- `Authorization: Bearer <key>` is validated against
  `POSTFLOW_ANALYTICS_API_KEY`.
- Missing, malformed, unconfigured, or invalid keys return `401`.
- The analytics routes do not read or require `x-clerk-user-id`.

Tests/checks:
- `npm run build` in `apps/api` passes.

Known limitations:
- No dedicated auth unit/e2e tests yet.
```

## Review Gate

Confirm auth behavior before exposing data.

---

# Phase 2 - Analytics Module Skeleton

## Checklist

- [x] Create `apps/api/src/analytics/analytics.module.ts`.
- [x] Create `apps/api/src/analytics/analytics.controller.ts`.
- [x] Create `apps/api/src/analytics/analytics.service.ts`.
- [x] Register analytics module in `apps/api/src/app.module.ts`.
- [x] Inject `Post`, `PublishingJob`, `Group`, and `User` models.

## Review Notes

```text
Status: COMPLETE

Files changed:
- `apps/api/src/analytics/analytics.module.ts`
- `apps/api/src/analytics/analytics.controller.ts`
- `apps/api/src/analytics/analytics.service.ts`
- `apps/api/src/app.module.ts`

Implementation:
- Added a dedicated `AnalyticsModule`.
- Registered the module in the root API module.

Tests/checks:
- `npm run build` in `apps/api` passes.

Known limitations:
```

---

# Phase 3 - List Posts Export

## Checklist

- [x] Add `GET /api/analytics/posts`.
- [x] Query all posts across all users.
- [x] Sort by `{ createdAt: -1, _id: -1 }`.
- [x] Add `page` query parameter.
- [x] Add `limit` query parameter.
- [x] Clamp `limit` to a safe maximum.
- [x] Return pagination metadata.
- [x] Exclude raw `mediaUrls`; return `mediaCount`.

## Review Notes

```text
Status: COMPLETE

Endpoint:
- `GET /api/analytics/posts`

Files changed:
- `apps/api/src/analytics/analytics.controller.ts`
- `apps/api/src/analytics/analytics.service.ts`

Implementation:
- Lists posts across all users with default `page=1`, `limit=100`, and max
  `limit=500`.
- Returns pagination metadata and `mediaCount`.

Tests/checks:
- `npm run build` in `apps/api` passes.

Known limitations:
- No dedicated pagination tests yet.
```

---

# Phase 4 - Creator Enrichment

## Checklist

- [x] Collect post `clerkUserId` values.
- [x] Query matching users by `User.clerkUserId`.
- [x] Add `createdBy.id` when a user exists.
- [x] Add `createdBy.email` when available.
- [x] Add `createdBy.firstName`, `createdBy.lastName`, and `createdBy.fullName` when available.
- [x] Add `createdBy.role`.
- [x] Add `createdBy.status`.
- [x] Add `createdBy.teamId`.
- [x] Add readable `createdBy.team` data when the user's team exists.
- [x] Keep posts exportable when a matching user is missing.

## Review Notes

```text
Status: COMPLETE

Files changed:
- `apps/api/src/analytics/analytics.service.ts`
- `apps/api/src/analytics/analytics.module.ts`

Implementation:
- Enriches creator data from `User.clerkUserId`.
- Includes creator first name, last name, and full name.
- Joins creator `teamId` to `Team` and returns `createdBy.team` with id, name,
  and manager id when available.
- Returns `createdBy: null` if no user record exists.

Tests/checks:
- `npm run build` in `apps/api` passes.

Known limitations:
- Missing/deleted team records leave `teamId` present and omit `team`.
```

---

# Phase 5 - Target Job Details

## Checklist

- [x] Fetch all jobs for returned posts.
- [x] Populate or join group details.
- [x] Return one target per `PublishingJob`.
- [x] Include job status.
- [x] Include submission status.
- [x] Include Facebook `postUrl`.
- [x] Include submitted/published/scheduled/started/completed timestamps.
- [x] Include job error when present.
- [x] Include target engagement only when counters or timestamp exist.

## Review Notes

```text
Status: COMPLETE

Files changed:
- `apps/api/src/analytics/analytics.service.ts`

Implementation:
- Each publishing job is returned as a target.
- Group details are populated from `groupId`.
- Target engagement is omitted when no counter or sync timestamp exists.

Tests/checks:
- `npm run build` in `apps/api` passes.

Known limitations:
- Missing/deleted groups leave group fields omitted.
```

---

# Phase 6 - Engagement Totals

## Checklist

- [x] Compute `targetCount`.
- [x] Compute job status counts.
- [x] Compute submission status counts.
- [x] Sum known target `reactionCount`.
- [x] Sum known target `commentCount`.
- [x] Compute newest target `engagement.lastSyncedAt`.
- [x] Do not emit fake zero values at target level.
- [x] Use zero only for aggregate sums.

## Review Notes

```text
Status: COMPLETE

Files changed:
- `apps/api/src/analytics/analytics.service.ts`

Implementation:
- Computes post-level totals from target jobs.
- Target-level missing counters remain omitted.

Tests/checks:
- `npm run build` in `apps/api` passes.

Known limitations:
- Paused jobs are not represented by a dedicated total field in the current
  response contract.
```

---

# Phase 7 - Filters

## Checklist

- [x] Add `from` created date filter.
- [x] Add `to` created date filter.
- [x] Add post `status` filter.
- [x] Validate invalid dates.
- [x] Keep filtered pagination totals correct.

## Review Notes

```text
Status: COMPLETE

Files changed:
- `apps/api/src/analytics/analytics.controller.ts`
- `apps/api/src/analytics/analytics.service.ts`

Implementation:
- Supports `from`, `to`, and `status` filters.
- Invalid date filters return `400`.
- Count and list use the same filter.

Tests/checks:
- `npm run build` in `apps/api` passes.

Known limitations:
```

---

# Phase 8 - Single Post Export

## Checklist

- [x] Add `GET /api/analytics/posts/:id`.
- [x] Return one `AnalyticsPost`.
- [x] Return `404` for missing posts.
- [x] Reuse list serialization logic.
- [x] Require the same API key auth.

## Review Notes

```text
Status: COMPLETE

Endpoint:
- `GET /api/analytics/posts/:id`

Files changed:
- `apps/api/src/analytics/analytics.controller.ts`
- `apps/api/src/analytics/analytics.service.ts`

Implementation:
- Returns one serialized analytics post.
- Invalid or missing ids return `404`.

Tests/checks:
- `npm run build` in `apps/api` passes.

Known limitations:
```

---

# Phase 9 - Tests

## Checklist

- [ ] Test missing API key.
- [ ] Test invalid API key.
- [ ] Test valid API key.
- [ ] Test posts across multiple users are returned.
- [ ] Test creator enrichment.
- [ ] Test missing creator fallback.
- [ ] Test target details.
- [ ] Test engagement totals.
- [ ] Test pagination metadata.
- [ ] Test filters.
- [ ] Test single post export.
- [ ] Test summary totals.
- [ ] Test summary by creator.
- [ ] Test summary by team.

## Review Notes

```text
Status: NOT STARTED

Files changed:

Tests/checks:

Known limitations:
```

---

# Phase 10 - Filters and Summary

## Checklist

- [x] Add creator filters to `GET /api/analytics/posts`.
- [x] Support `userId` filter.
- [x] Support `teamId` filter.
- [x] Support `role` filter.
- [x] Add `GET /api/analytics/summary`.
- [x] Reuse the same filter logic for posts and summary.
- [x] Return totals across posts, targets, submissions, and engagement.
- [x] Return `byStatus`.
- [x] Return `byCreator`.
- [x] Return `byTeam`.

## Review Notes

```text
Status: COMPLETE

Files changed:
- `apps/api/src/analytics/analytics.controller.ts`
- `apps/api/src/analytics/analytics.service.ts`
- `features/analytics-export-api/feature.md`
- `features/analytics-export-api/progress.md`

Implementation:
- Added `userId`, `teamId`, and `role` creator filters to the
  posts export endpoint.
- Added `GET /api/analytics/summary` with totals, by-status counts, creator
  rollups, and team rollups.
- Summary and posts export use the same filter builder.

Tests/checks:
- `npm run build` in `apps/api` passes.

Known limitations:
- Dedicated analytics tests remain pending.
- Summary currently computes from matching posts and jobs in application code;
  this is simple and consistent, but large datasets may eventually need MongoDB
  aggregation pipelines.
```

---

# Phase 11 - Public Analytics User Identity

## Checklist

- [x] Stop exposing `createdBy.clerkUserId`.
- [x] Stop exposing both `createdBy.userId` and `createdBy.clerkUserId`.
- [x] Use `createdBy.id` as the only public analytics user id.
- [x] Remove `clerkUserId` from analytics query filters.
- [x] Keep internal Clerk joins private to the API implementation.
- [x] Return `createdBy: null` when a matching PostFlow user is missing.

## Review Notes

```text
Status: COMPLETE

Files changed:
- `apps/api/src/analytics/analytics.controller.ts`
- `apps/api/src/analytics/analytics.service.ts`
- `features/analytics-export-api/feature.md`
- `features/analytics-export-api/progress.md`
- `features/analytics-export-api/integration-guide.md`

Implementation:
- Analytics responses now expose one user identifier: `id`.
- Analytics filters now expose one user filter: `userId`.
- Clerk ids remain internal for joining legacy post ownership data to users.

Tests/checks:
- `npm run build` in `apps/api` passes.

Known limitations:
- Existing posts still store `Post.clerkUserId`; the API hides that detail.
```

---

# Phase 12 - Date Filter Inclusivity

## Checklist

- [x] Treat date-only `from` as the start of the UTC day.
- [x] Treat date-only `to` as the end of the UTC day.
- [x] Preserve exact timestamp filtering for full ISO datetime values.
- [x] Document date-only filter behavior.

## Review Notes

```text
Status: COMPLETE

Files changed:
- `apps/api/src/analytics/analytics.service.ts`
- `features/analytics-export-api/feature.md`
- `features/analytics-export-api/integration-guide.md`
- `features/analytics-export-api/progress.md`

Implementation:
- `to=YYYY-MM-DD` now includes posts through `23:59:59.999Z` on that date.
- `from=YYYY-MM-DD` remains the beginning of the date.

Tests/checks:
- `npm run build` in `apps/api` passes.

Known limitations:
- Date-only behavior is UTC-based.
```

---

# Phase 13 - Reference Users and Teams

## Checklist

- [x] Add `GET /api/analytics/users`.
- [x] Add `GET /api/analytics/teams`.
- [x] Use only PostFlow public ids.
- [x] Do not expose Clerk IDs.
- [x] Return minimal user fields for filtering/display.
- [x] Return minimal team fields plus useful counts.

## Review Notes

```text
Status: COMPLETE

Files changed:
- `apps/api/src/analytics/analytics.controller.ts`
- `apps/api/src/analytics/analytics.service.ts`
- `features/analytics-export-api/feature.md`
- `features/analytics-export-api/integration-guide.md`
- `features/analytics-export-api/progress.md`

Implementation:
- Added analytics reference endpoints for users and teams.
- Users include id, name, email, role, status, and team.
- Teams include id, name, manager, team leader, member count, and sales count.

Tests/checks:
- `npm run build` in `apps/api` passes.

Known limitations:
- These endpoints are unpaginated reference lists.
```

---

# Progress Summary

| Phase | Status | Reviewed |
| --- | --- | --- |
| 1. Static API key auth | Complete | No |
| 2. Analytics module skeleton | Complete | No |
| 3. List posts export | Complete | No |
| 4. Creator enrichment | Complete | No |
| 5. Target job details | Complete | No |
| 6. Engagement totals | Complete | No |
| 7. Filters | Complete | No |
| 8. Single post export | Complete | No |
| 9. Tests | Not Started | No |
| 10. Filters and Summary | Complete | No |
| 11. Public analytics user identity | Complete | No |
| 12. Date Filter Inclusivity | Complete | No |
| 13. Reference Users and Teams | Complete | No |

---

# Implementation Workflow

Each implementation session should:

1. Read `features/analytics-export-api/feature.md`.
2. Read this progress file.
3. Inspect the current post, job, group, and user schemas.
4. Work on the first incomplete phase unless the user asks otherwise.
5. Update this progress file.
6. Run relevant tests or build checks.
7. Provide a short review summary.

---

# Review Summary Template

```text
Phase completed:

Files changed:

Implementation:

API behavior:

Tests/checks:

Known limitations:

Progress file updated:
Yes

Ready for review:
Yes
```
