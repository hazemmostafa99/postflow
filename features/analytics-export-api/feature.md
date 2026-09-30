# Analytics Export API

## Goal

Create a backend-to-backend analytics API that lets an external backend fetch all PostFlow post data across all users.

The external backend authenticates with one shared API key stored in environment variables. The API returns posts, creators, publishing targets, Facebook post URLs, submission state, and latest engagement counters.

## Authentication

Use a static API key from the API environment.

```env
POSTFLOW_ANALYTICS_API_KEY=pf_live_...
```

Clients must send:

```http
Authorization: Bearer pf_live_...
```

Requests without a valid bearer token must return:

```http
401 Unauthorized
```

Do not use `x-clerk-user-id` for this API. This endpoint is not scoped to one dashboard user; it is an export/integration API that can read all posts.

## Primary Endpoint

```http
GET /api/analytics/posts
```

Query parameters:

```text
page       optional, default 1
limit      optional, default 100, max 500
from       optional ISO date, filters post createdAt >= from
to         optional ISO date, filters post createdAt <= to
status     optional Post.status
userId     optional PostFlow user id
teamId     optional PostFlow team id
role       optional creator role
```

The endpoint returns all posts across all users, newest first.
Creator filters are resolved through `User` records and then applied to
`Post.clerkUserId`. If a creator filter matches no users, the response is an
empty result set.

Date-only filters are interpreted as full UTC days:

```text
from=2026-09-29 -> 2026-09-29T00:00:00.000Z
to=2026-09-29   -> 2026-09-29T23:59:59.999Z
```

## Summary Endpoint

```http
GET /api/analytics/summary
```

Supported query parameters:

```text
from
to
status
userId
teamId
role
```

The summary endpoint uses the same filter semantics as
`GET /api/analytics/posts`.

```ts
type AnalyticsMetricBucket = {
  posts: number;
  targets: number;
  pending: number;
  running: number;
  success: number;
  failed: number;
  canceled: number;
  published: number;
  pendingApproval: number;
  unknownSubmission: number;
  reactions: number;
  comments: number;
};

type AnalyticsSummaryResponse = {
  filters: {
    from?: string;
    to?: string;
    status?: string;
    userId?: string;
    teamId?: string;
    role?: string;
  };
  totals: AnalyticsMetricBucket;
  byStatus: Record<string, number>;
  byCreator: Array<{
    id: string | null;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    name?: string;
    creatorMissing?: boolean;
    email?: string;
    role?: string;
    status?: string;
    teamId?: string | null;
    team?: {
      id: string;
      name: string;
      managerId?: string;
    };
  } & AnalyticsMetricBucket>;
  byTeam: Array<{
    teamId: string | null;
    teamName?: string;
    team?: {
      id: string;
      name: string;
      managerId?: string;
    };
  } & AnalyticsMetricBucket>;
};
```

## Reference Data Endpoints

These endpoints let an external analytics backend build filter controls without
calling admin APIs.

```http
GET /api/analytics/users
GET /api/analytics/teams
```

Both use the same analytics API key authentication.

Users response:

```ts
type AnalyticsUsersResponse = {
  users: Array<{
    id: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    email?: string;
    role?: string;
    status?: string;
    teamId?: string | null;
    team?: {
      id: string;
      name: string;
      managerId?: string;
    };
  }>;
};
```

Teams response:

```ts
type AnalyticsTeamsResponse = {
  teams: Array<{
    id: string;
    name: string;
    managerId?: string;
    manager?: {
      id: string;
      firstName?: string;
      lastName?: string;
      fullName?: string;
      email?: string;
    };
    memberCount: number;
    salesCount: number;
    teamLeader?: {
      id: string;
      firstName?: string;
      lastName?: string;
      fullName?: string;
      email?: string;
    };
  }>;
};
```

## Response Shape

```ts
type AnalyticsPostsResponse = {
  posts: AnalyticsPost[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};
```

Each post:

```ts
type AnalyticsPost = {
  id: string;
  content: string;
  mediaCount: number;
  status: string;
  createdAt?: string;
  updatedAt?: string;

  createdBy: {
    id: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    email?: string;
    role?: string;
    status?: string;
    teamId?: string | null;
    team?: {
      id: string;
      name: string;
      managerId?: string;
    };
  } | null;

  totals: {
    targetCount: number;
    pendingCount: number;
    runningCount: number;
    successCount: number;
    failedCount: number;
    canceledCount: number;
    publishedCount: number;
    pendingApprovalCount: number;
    unknownSubmissionCount: number;
    reactionCount: number;
    commentCount: number;
  };

  engagement: {
    reactionCount: number;
    commentCount: number;
    lastSyncedAt?: string;
  };

  targets: AnalyticsPostTarget[];
};
```

Each target is one `PublishingJob`:

```ts
type AnalyticsPostTarget = {
  jobId: string;
  groupId?: string;
  groupName?: string;
  groupUrl?: string;
  groupExternalId?: string;
  status: string;
  submissionStatus?: "PUBLISHED" | "PENDING_APPROVAL" | "UNKNOWN";
  postUrl?: string;
  submittedAt?: string;
  publishedDetectedAt?: string;
  scheduledFor?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;

  engagement?: {
    reactionCount?: number;
    commentCount?: number;
    lastSyncedAt?: string;
  };
};
```

## Aggregation Rules

Engagement is stored per `PublishingJob`, because one PostFlow post can be published to many Facebook groups.

For each returned post:

- `totals.targetCount` is the number of publishing jobs for the post.
- `totals.reactionCount` is the sum of known job `engagement.reactionCount` values.
- `totals.commentCount` is the sum of known job `engagement.commentCount` values.
- Missing engagement values count as `0` only for aggregate totals.
- Missing engagement values must remain omitted or `undefined` inside individual targets.
- `engagement.lastSyncedAt` is the newest known target `engagement.lastSyncedAt`.

Do not treat missing target counters as confirmed zero at the target level.

## Creator Rules

Posts currently store:

```ts
Post.clerkUserId
```

The analytics API should join that value to:

```ts
User.clerkUserId
```

If a matching user exists, include name, email, role, status, and team id.
Use the PostFlow user id as the only public analytics user identifier:

```ts
createdBy.id = User._id
```

Do not expose Clerk user ids in analytics responses or analytics filters.

If the matching user belongs to a team, include readable team data:

```ts
createdBy.team = {
  id: User.teamId,
  name: Team.name,
  managerId?: Team.managerId
}
```

If no matching user exists, still return the post with a null creator:

```ts
createdBy: null
```

## Optional Endpoint

After the list endpoint works, add:

```http
GET /api/analytics/posts/:id
```

This returns one post in the same shape as `AnalyticsPost`.

## Out Of Scope

Do not implement in the first pass:

- API key database records.
- Scopes.
- Access levels.
- Per-user filtering.
- Historical engagement charts.
- Comment bodies.
- Reaction user details.
- Facebook scraping from this API.

The API only returns data already stored in MongoDB.

## Suggested Code Organization

```text
apps/api/src/analytics/
  analytics.module.ts
  analytics.controller.ts
  analytics.service.ts
```

Register the module in:

```text
apps/api/src/app.module.ts
```

The module should inject:

- `Post`
- `PublishingJob`
- `Group`
- `User`

## Implementation Phases

### Phase 1 - Static API Key Guard

- Read `POSTFLOW_ANALYTICS_API_KEY`.
- Parse `Authorization: Bearer ...`.
- Reject missing or invalid keys with `401`.
- Keep the logic isolated so it can later move to a guard if needed.

### Phase 2 - List Posts Export

- Add `GET /api/analytics/posts`.
- Return paginated posts across all users.
- Include `createdBy`.
- Include per-target jobs.
- Include engagement totals.

### Phase 3 - Filtering

- Add `from`, `to`, and `status`.
- Add creator filters: `userId`, `teamId`, and `role`.
- Validate dates.
- Keep pagination stable with `{ createdAt: -1, _id: -1 }`.

### Phase 4 - Single Post Export

- Add `GET /api/analytics/posts/:id`.
- Return `404` when the post does not exist.
- Use the same serializer as the list endpoint.

### Phase 5 - Tests

- Test invalid API key.
- Test valid API key.
- Test creator enrichment.
- Test missing creator fallback.
- Test aggregate engagement totals.
- Test pagination metadata.

### Phase 6 - Summary

- Add `GET /api/analytics/summary`.
- Reuse the same filter semantics as the posts export.
- Return global totals.
- Return counts by post status.
- Return rollups by creator.
- Return rollups by team.

### Phase 7 - Reference Data

- Add `GET /api/analytics/users`.
- Add `GET /api/analytics/teams`.
- Return minimal filter/display data only.
- Do not expose Clerk IDs.

## Example Request

```http
GET /api/analytics/posts?page=1&limit=100
Authorization: Bearer pf_live_...
```

## Example Response

```json
{
  "posts": [
    {
      "id": "post_id",
      "content": "Example post",
      "mediaCount": 1,
      "status": "COMPLETED",
      "createdAt": "2026-09-29T00:00:00.000Z",
      "createdBy": {
        "id": "mongo_user_id",
        "firstName": "Sara",
        "lastName": "Ahmed",
        "fullName": "Sara Ahmed",
        "email": "person@company.com",
        "role": "SALES",
        "status": "ACTIVE",
        "teamId": "team_id",
        "team": {
          "id": "team_id",
          "name": "Cairo Sales",
          "managerId": "manager_user_id"
        }
      },
      "totals": {
        "targetCount": 2,
        "pendingCount": 0,
        "runningCount": 0,
        "successCount": 2,
        "failedCount": 0,
        "canceledCount": 0,
        "publishedCount": 2,
        "pendingApprovalCount": 0,
        "unknownSubmissionCount": 0,
        "reactionCount": 15,
        "commentCount": 4
      },
      "engagement": {
        "reactionCount": 15,
        "commentCount": 4,
        "lastSyncedAt": "2026-09-29T01:00:00.000Z"
      },
      "targets": [
        {
          "jobId": "job_id",
          "groupId": "group_id",
          "groupName": "Facebook Group",
          "groupUrl": "https://www.facebook.com/groups/example",
          "status": "SUCCESS",
          "submissionStatus": "PUBLISHED",
          "postUrl": "https://www.facebook.com/groups/example/posts/123/",
          "engagement": {
            "reactionCount": 15,
            "commentCount": 4,
            "lastSyncedAt": "2026-09-29T01:00:00.000Z"
          }
        }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 100,
    "total": 1,
    "totalPages": 1
  }
}
```

## Definition Of Done

- External backend can fetch all posts using `Authorization: Bearer`.
- Invalid API keys are rejected.
- The API does not require `x-clerk-user-id`.
- Each post includes `createdBy`.
- Each post includes per-target publishing data.
- Each post includes aggregate reaction and comment counts.
- Missing creator records do not break export.
- Missing target engagement does not become fake target-level zero.
