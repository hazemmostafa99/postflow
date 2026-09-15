# PostFlow

PostFlow is a local-first publishing workspace for creating posts in a web app and publishing them to Facebook Groups through a Chrome extension.

The project is split into three apps:

- `apps/web` - Next.js dashboard for authentication, post creation, group selection, and publishing status.
- `apps/api` - NestJS API backed by MongoDB for users, groups, posts, jobs, and extension status.
- `apps/extension` - Chrome extension that detects Facebook Groups, syncs them to the API, and executes pending publishing jobs in Facebook.

## Features

- Clerk authentication in the web dashboard.
- Facebook Group sync through the Chrome extension.
- Create text and image posts from the web app.
- One publishing job per target group.
- Extension-driven publishing flow with configurable posting timings.
- Posts list, post details, job status tracking, and bulk delete actions.

## Tech Stack

- Next.js 16, React 19, Tailwind CSS, Clerk
- NestJS 11, Mongoose, MongoDB
- Chrome Extension Manifest V3
- TypeScript across all apps

## Repository Structure

```text
apps/
  api/        NestJS backend API
  extension/ Chrome extension
  web/        Next.js web dashboard
```

## Prerequisites

- Node.js 20+
- npm
- MongoDB connection string
- Clerk application keys
- Chrome or another Chromium browser for the extension

## Environment Variables

Create local `.env` files in the apps that need them.

`apps/api/.env`

```env
DATABASE_URL=mongodb://localhost:27017/postflow
PORT=8000
```

`apps/web/.env`

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_publishable_key
CLERK_SECRET_KEY=your_secret_key
API_URL=http://localhost:8000
```

Do not commit real `.env` files or production secrets.

## Local Development

Install dependencies per app:

```bash
cd apps/api
npm install

cd ../web
npm install

cd ../extension
npm install
```

Start the API:

```bash
cd apps/api
npm run start:dev
```

Start the web app:

```bash
cd apps/web
npm run dev
```

Build the extension:

```bash
cd apps/extension
npm run build
```

Load the extension in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select `apps/extension`.
5. Keep the web app running at `http://localhost:3000` and the API running at `http://localhost:8000`.

## How The Flow Works

1. The user signs in to the web dashboard with Clerk.
2. The dashboard exposes the signed-in user id to the extension on localhost.
3. The extension stores that user id locally.
4. On Facebook, the extension can scan and sync groups to the API.
5. The user creates a post in the web app and selects target groups.
6. The API creates one publishing job per target group.
7. The extension checks for pending jobs, opens the target Facebook Group, fills the composer, posts, and updates job status.

## Useful Commands

API:

```bash
npm run start:dev
npm run build
npm run test
```

Web:

```bash
npm run dev
npm run build
npm run lint
```

Extension:

```bash
npm run build
npm run watch
```

## Notes

- The extension currently targets local development URLs: `http://localhost:3000` and `http://localhost:8000`.
- Post images are stored as data URLs today. Moving media to object storage is a future improvement.
- Facebook UI changes can affect the extension automation flow. Posting timings are centralized in `apps/extension/src/posting-config.ts`.
