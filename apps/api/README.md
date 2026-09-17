# PostFlow API

The API is a NestJS backend for PostFlow. It stores synced groups, posts, publishing jobs, and extension installation/session state in MongoDB.

## Stack

- NestJS 11
- Mongoose
- MongoDB
- TypeScript

## Environment Variables

Create `apps/api/.env`:

```env
DATABASE_URL=mongodb://localhost:27017/postflow
CLERK_SECRET_KEY=your_secret_key
PORT=8000
```

## Development

```bash
npm install
npm run start:dev
```

The API defaults to:

```text
http://localhost:8000
```

## Build

```bash
npm run build
npm run start:prod
```

## Bootstrap the first Admin

The first Admin is created once from the API workspace. The script creates the Clerk user first and then the matching active PostFlow user. If the database write fails, it removes the Clerk user again.

```bash
set ADMIN_PASSWORD=use-a-secure-password
npm run create-admin -- --email admin@company.com
```

On PowerShell:

```powershell
$env:ADMIN_PASSWORD = "use-a-secure-password"
npm run create-admin -- --email admin@company.com
```

Do not commit the password or put it in source control. `DATABASE_URL` and `CLERK_SECRET_KEY` must be available in `apps/api/.env` or the shell environment.

## Tests

```bash
npm run test
npm run test:e2e
npm run test:cov
```

## Main Modules

```text
src/extensions  Extension registration, heartbeat, and Facebook session state
src/groups      Facebook Group sync, search, pagination, and delete-all
src/posts       Post creation, post lists, post details, job queue, and status updates
src/schemas     Mongoose schemas
```

## Authentication Model

The API expects each request to include:

```text
x-clerk-user-id
```

The web app and extension both send this header. API queries are scoped by this user id.

## Key Endpoints

Groups:

```text
POST   /api/groups/sync
GET    /api/groups
GET    /api/groups?page=1&limit=20&search=query
DELETE /api/groups
```

Posts:

```text
POST   /api/posts
GET    /api/posts
GET    /api/posts?page=1&limit=10
GET    /api/posts/:id
DELETE /api/posts
```

Jobs:

```text
GET  /api/jobs/next
POST /api/jobs/:id/status
```

Extension:

```text
POST /api/extensions/register
POST /api/extensions/heartbeat
POST /api/extensions/session
```

## Data Flow

1. Extension syncs Facebook Groups with `POST /api/groups/sync`.
2. Web app creates a post with selected target group ids.
3. API creates one `PublishingJob` per selected group.
4. Extension polls `GET /api/jobs/next`.
5. Extension publishes to Facebook and updates job status.
