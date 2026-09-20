# PostFlow Chrome Extension

The extension connects the local PostFlow dashboard/API with Facebook. It detects Facebook Groups, syncs them to the backend, and executes pending publishing jobs by interacting with Facebook group pages.

## Stack

- Chrome Extension Manifest V3
- TypeScript
- Custom build: `tsc` plus `scripts/copy-static.mjs` (no bundler)
- Chrome extension APIs: storage, tabs, alarms, activeTab

## Environment Configuration

Build-time public API configuration is committed in:

- `.env.development`: `API_BASE_URL=http://localhost:8000`
- `.env.production`: `API_BASE_URL=https://api.fitcure.online`

The build reads the selected file using Node's `parseEnv` and generates
`dist/env.js`. `src/background.ts` reads it with:

```ts
import { API_BASE_URL, BUILD_ENV } from './env.js';
```

API requests use `${API_BASE_URL}${path}`. The build also emits `BUILD_ENV`
from the selected build mode. Only `API_BASE_URL` is read from the env file;
shell environment variables and other `.env` files are not loaded. These URLs
are public. Never put secrets in extension environment files or bundled code.

The manifest permits both API hosts and the production frontend. The dashboard
content script runs on localhost and `https://fitcure.online/*` to read the
signed-in user ID and handle dashboard sync actions.

```text
Web: http://localhost:3000
Production web: https://fitcure.online
Facebook: https://www.facebook.com/*
```

## Install Dependencies

Use Node.js 20.12 or newer. Run all commands from `apps/extension`.

```bash
npm install
```

## Build

```bash
npm run build:dev
# Or, for production:
npm run build:prod
```

Both commands compile TypeScript and copy the popup files, generated API config,
and a manifest with paths relative to `dist` into `apps/extension/dist`.
`npm run build` is an alias for `npm run build:dev`, preserving the local default.
Each build replaces the configuration in the same output folder; the last build
determines its environment. The build does not change any backend or deployment.

## Watch

```bash
npm run watch
```

`watch` first creates a complete development build, then watches TypeScript.
If you edit environment files, the manifest, or popup HTML/CSS, restart watch or
run `npm run build:dev` so those files are regenerated in `dist`.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the `apps/extension/dist` folder (it contains `manifest.json`).
5. Click Reload after each build.

To identify the active environment, click the extension's **service worker**
link on `chrome://extensions` and open **Console**. Each service worker start logs:

```text
[PostFlow] DEV environment | API: http://localhost:8000
# Or:
[PostFlow] PROD environment | API: https://api.fitcure.online
```

This identifies the loaded build configuration; it does not confirm API connectivity.

## Important Files

```text
manifest.json                    Chrome extension manifest
src/background.ts                API communication, heartbeats, job polling, job orchestration
src/content.ts                   Facebook group detection and posting automation
src/facebook-session.ts          Facebook session detection
src/postflow-content.ts          Reads the signed-in web app user id
src/posting-config.ts            Central timing config for posting steps
src/popup/popup.html             Extension popup UI
src/popup/popup.ts               Popup behavior
src/popup/popup.css              Popup styles
src/env.d.ts                     Type declaration for the generated API config module
.env.development                 Public development API URL
.env.production                  Public production API URL
scripts/copy-static.mjs          Copies popup files and generates config/manifest in dist
```

## How It Works

1. The user opens the PostFlow web app and signs in.
2. `postflow-content.ts` reads the hidden user id from the dashboard page and stores it in extension storage.
3. The popup displays web app connection and group sync status.
4. On Facebook, `content.ts` can scan the DOM and call Facebook GraphQL endpoints to find groups.
5. `background.ts` sends discovered groups to the API.
6. The extension checks the API for pending publishing jobs.
7. For each job, it opens the target group page, starts the composer, inserts text/media, clicks Post, and reports success or failure.

## Posting Timing

Posting step durations are centralized in:

```text
src/posting-config.ts
```

Tune this file when Facebook is slow or when the automation needs to move faster. After editing it, run:

```bash
npm run build
```

Then reload the extension in Chrome.

## Notes

- The extension must run in a browser profile that is already logged in to Facebook.
- Facebook UI changes can break selectors or timing assumptions.
- The extension uses the locally stored Clerk user id to call the API with `x-clerk-user-id`.

