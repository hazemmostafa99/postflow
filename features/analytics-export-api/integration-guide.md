# PostFlow Analytics API Integration

Production base URL:

```text
https://api.fitcure.online
```

## Auth

Send the API key as a bearer token:

```http
Authorization: Bearer pf_live_6FyNfgn5SawF0YdJnYbGpNSXHYEnS3Chp8R48rPx8f8
```

Do not send `x-clerk-user-id`. This API returns posts across all PostFlow users.

## Endpoints

List posts:

```http
GET https://api.fitcure.online/api/analytics/posts?page=1&limit=100
```

Get one post:

```http
GET https://api.fitcure.online/api/analytics/posts/{postId}
```

Summary:

```http
GET https://api.fitcure.online/api/analytics/summary
```

Reference users:

```http
GET https://api.fitcure.online/api/analytics/users
```

Reference teams:

```http
GET https://api.fitcure.online/api/analytics/teams
```

## Query Params

| Param | Description |
| --- | --- |
| `page` | Optional. Default `1`. |
| `limit` | Optional. Default `100`, max `500`. |
| `from` | Optional ISO date. Filters `createdAt >= from`. |
| `to` | Optional ISO date. Filters `createdAt <= to`. |
| `status` | Optional top-level post status. |
| `userId` | Optional PostFlow analytics user id. |
| `teamId` | Optional PostFlow team id. |
| `role` | Optional creator role. |

Valid top-level post statuses:

```text
DRAFT
PUBLISHING
PAUSED
CANCELED
COMPLETED
PARTIAL_FAILURE
```

Note: `PUBLISHED` is a target `submissionStatus`, not a top-level post status.
Date-only `to` filters include the whole UTC day. For example, `to=2026-09-29`
means through `2026-09-29T23:59:59.999Z`.

## Response Summary

```ts
{
  posts: Array<{
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
      };
    } | null;
    totals: {
      targetCount: number;
      publishedCount: number;
      pendingApprovalCount: number;
      reactionCount: number;
      commentCount: number;
    };
    engagement: {
      reactionCount: number;
      commentCount: number;
      lastSyncedAt?: string;
    };
    targets: Array<{
      jobId: string;
      groupName?: string;
      groupUrl?: string;
      status: string;
      submissionStatus?: "PUBLISHED" | "PENDING_APPROVAL" | "UNKNOWN";
      postUrl?: string;
      engagement?: {
        reactionCount?: number;
        commentCount?: number;
        lastSyncedAt?: string;
      };
    }>;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
```

## Example

```bash
curl "https://api.fitcure.online/api/analytics/posts?page=1&limit=100" \
  -H "Authorization: Bearer <POSTFLOW_ANALYTICS_API_KEY>"
```

## Errors

```text
401 Unauthorized - missing or invalid API key
400 Bad Request  - invalid date filter
404 Not Found    - post not found
```

## Notes

- Store the API key only in backend env/secrets.
- Never expose the key in browser/client-side code.
- Engagement is stored per target, then summed at the post level.
- Missing target engagement means unknown, not zero.
