# PostFlow Web

The web app is the authenticated PostFlow Sales dashboard. It handles authentication, post creation, group selection, post lists, and publishing status views. The public website lives in `apps/marketing`.

## Stack

- Next.js 16 App Router
- React 19
- Tailwind CSS
- Clerk authentication
- shadcn-style local UI components

## Main Responsibilities

- Sign in and sign up with Clerk.
- Render the authenticated dashboard shell.
- Expose the signed-in Clerk user id for the Chrome extension.
- List posts and publishing status.
- Create posts with text and images.
- Fetch synced Facebook Groups from the API.
- Proxy authenticated API calls through Next route handlers.

## Environment Variables

Create `apps/web/.env`:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_publishable_key
CLERK_SECRET_KEY=your_secret_key
API_URL=http://localhost:8000
NEXT_PUBLIC_MARKETING_URL=http://localhost:3000
NEXT_PUBLIC_WHATSAPP_NUMBER=201044280822
```

`API_URL` points to the NestJS API.

`NEXT_PUBLIC_MARKETING_URL` points back to the public Marketing application.

`NEXT_PUBLIC_WHATSAPP_NUMBER` is the international-format WhatsApp contact used by the expired-trial page.

For production, Next.js automatically loads `.env.production`. Use `.env.production.example` as the deployment template and set the production Clerk keys in the hosting provider's secret environment variables. The production template keeps the current API endpoint unchanged until the separate PostFlow API and database are ready.

## Development

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3001
```

## Build

```bash
npm run build
npm run start
```

## Important Paths

```text
src/app/page.tsx                      Redirects to the dashboard
src/app/(dashboard)/dashboard/page.tsx Dashboard overview
src/app/(dashboard)/posts/page.tsx    Posts list
src/app/(dashboard)/posts/[id]/page.tsx
src/components/create-post-form.tsx   New post form
src/components/new-post-dialog.tsx    New post modal
src/app/api/posts/route.ts            Web proxy for post mutations
src/app/api/groups/route.ts           Web proxy for group reads/deletes
```

## API Proxy Behavior

The web app reads the authenticated Clerk user and forwards requests to the API with:

```text
x-clerk-user-id
```

This keeps user scoping consistent between the dashboard, API, and extension.

