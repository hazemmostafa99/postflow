# PostFlow Chrome Extension

The extension connects the local PostFlow dashboard/API with Facebook. It detects Facebook Groups, syncs them to the backend, and executes pending publishing jobs by interacting with Facebook group pages.

## Stack

- Chrome Extension Manifest V3
- TypeScript
- Chrome extension APIs: storage, tabs, alarms, activeTab

## Development URLs

The extension is currently configured for local development:

```text
Web: https://fitcure.online
API: https://api.fitcure.online
Facebook: https://www.facebook.com/*
```

These are declared in `manifest.json`.

## Install Dependencies

```bash
npm install
```

## Build

```bash
npm run build
```

The build compiles TypeScript and copies static popup files into `dist`.

## Watch

```bash
npm run watch
```

`watch` only watches TypeScript. If you edit popup HTML/CSS, run `npm run build` so static files are copied to `dist`.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the `apps/extension` folder.
5. Click Reload after each build.

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
scripts/copy-static.mjs          Copies popup HTML/CSS to dist during build
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

