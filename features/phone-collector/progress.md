# Phone Collector - Progress

## Goal

Add a Phone Collector tab to the existing Chrome Extension so users can collect phone numbers from the current page, review them, and manually sync selected numbers with PostFlow.

The required product flow is:

```text
Collect -> Validate -> Review/Edit -> Select -> Confirm -> Sync -> Show Result
```

---

# Phase 1 - Inspect Existing Architecture

## Checklist

* [x] Locate the extension popup/tab navigation implementation.
* [x] Identify current popup pages/tabs and UI conventions.
* [x] Identify content script/background service worker messaging patterns.
* [x] Identify existing active-tab lookup logic.
* [x] Identify existing API/backend integration utilities.
* [x] Identify existing authentication/session handling.
* [x] Identify existing extension state/storage utilities.
* [x] Search for existing phone normalization/validation logic or phone libraries.
* [x] Identify reusable UI styles/components.
* [x] Decide which files/modules should be reused or modified.

## Review Notes

```text
Status: COMPLETE

Files reviewed:

- `apps/extension/manifest.json`
- `apps/extension/package.json`
- `apps/extension/tsconfig.json`
- `apps/extension/scripts/copy-static.mjs`
- `apps/extension/src/popup/popup.html`
- `apps/extension/src/popup/popup.ts`
- `apps/extension/src/popup/popup.css`
- `apps/extension/src/background.ts`
- `apps/extension/src/content.ts`
- `apps/extension/src/postflow-content.ts`
- `apps/extension/tests/engagement.test.cjs`
- `apps/extension/tests/publishing-detection.test.cjs`
- `apps/api/src/app.module.ts`
- `apps/api/src/extensions/extensions.controller.ts`
- `apps/api/src/extensions/extensions.service.ts`
- `apps/api/src/groups/groups.controller.ts`
- `apps/api/src/groups/groups.service.ts`
- `apps/api/src/schemas/`
- `apps/web/src/app/api/extensions/connections/route.ts`
- `apps/extension/README.md`
- `README.md`

Findings:

- The extension is a Manifest V3 TypeScript project. `tsc` emits scripts to `dist`; the build script copies popup HTML/CSS and rewrites manifest paths for the packaged extension.
- The popup currently has one dashboard view, implemented with plain HTML, DOM-based TypeScript, and `popup.css`; there is no existing tab or page navigation component.
- The popup has `tabs` and `activeTab` permissions but does not query the active tab. Existing tab queries target PostFlow URLs or Facebook URLs. The background opens/updates Facebook tabs for publishing workflows.
- The background service worker handles runtime messages. Popup and web content scripts use `chrome.runtime.sendMessage`; Facebook content and background also use `chrome.tabs.sendMessage`, and group discovery uses a named runtime port.
- Facebook content scripts are limited to `https://www.facebook.com/*`; the PostFlow bridge is limited to local web app URLs and `https://fitcure.online/*`. The manifest declares `activeTab` but no `scripting` permission, and there is no generic-page content script or dynamic injection path. Generic loaded-DOM collection needs an explicit permission and injection decision before implementation.
- The background `apiFetch` reads `clerkUserId` and a persistent `extensionInstanceId` from `chrome.storage.local`, then sends them as `x-clerk-user-id` and `x-extension-instance-id` headers. Extension requests and session handling are already centralized there.
- The current API has extension registration/status routes and a Facebook group sync route. Group sync verifies the Facebook identity and writes group records; it is not a suitable phone-number contract. No phone/contact model, route, or persistence flow was found.
- Extension view state and current profile/status data use `chrome.storage.local`. There is no general state/store library.
- No phone normalization/validation helper or phone-number library is present in the extension or API dependencies.
- Existing popup styles are local CSS. Extension tests use Node's built-in test runner, TypeScript transpilation, and `linkedom` for DOM-oriented behavior.
- No repository `AGENTS.md` file was found.

Existing modules to reuse:

- `apps/extension/src/popup/popup.html`, `popup.ts`, and `popup.css` for the new popup view and its visual conventions.
- `apps/extension/src/background.ts` for service-worker message routing, active-tab coordination, extension storage access, and authenticated API requests.
- The existing `chrome.storage.local` APIs for persistent collection/review state as appropriate.
- `apps/extension/manifest.json` and the existing TypeScript build pipeline for registering any collector content script.
- `apps/extension/tests/` conventions and installed `linkedom` for focused DOM extraction coverage in a later phase.
- Existing NestJS module/controller/service/schema structure as the pattern for a future phone sync contract; no current endpoint can be reused directly.

Planned integration points:

- Add a Phone Collector view and navigation control to the existing popup files, preserving the current vanilla HTML/CSS/TypeScript approach.
- Add a dedicated collection message handled by the background, which resolves the current active tab and relays the request to a content script. First resolve generic-page access permissions and script injection in the relevant messaging phase.
- Keep page DOM extraction in a content-script-context module; keep popup state and user review in the extension UI, and use `chrome.storage.local` if state must survive popup closure/reopen.
- Reuse the background `apiFetch` and its existing Clerk/extension identity headers for eventual sync. Add a purpose-built backend contract and storage path only after the API/data model is designed; do not route phone data through group sync.
- Implement phone normalization/validation as a reusable module with a suitable library choice in its dedicated phase, since none currently exists.

Assumptions:

- "Phone Collector tab" can be represented as a view inside the existing extension popup; there is no existing multi-page popup navigation to extend.
- The current authenticated Clerk user ID is the intended owner for phone sync, while Facebook identity verification should not be inherited automatically from the group sync flow.
- Generic current-page support is required by the feature scope, so the manifest's current Facebook-only content-script matches must be addressed before collection can work beyond Facebook.

Known limitations:

- The current extension does not have a generic page DOM access path. The permitted approach and user-facing permission scope remain to be decided during implementation.
- No existing phone sync API/data model exists, so backend behavior and the response counts must be designed in the backend contract phase.
```

## Review Gate

Stop after documenting the existing architecture and planned integration points.

Do not implement UI, extraction, or API changes until this phase is reviewed.

---

# Phase 2 - Define Phone Collector Types and State Model

## Checklist

* [x] Define collected phone candidate/result types.
* [x] Define validation statuses.
* [x] Define duplicate metadata if needed.
* [x] Define selected/review state shape.
* [x] Define source page metadata shape.
* [x] Decide whether state needs persistence.
* [x] Use existing storage/state utilities when available.

Suggested conceptual types:

```ts
type PhoneCollectionSource = {
  type: "facebook" | "generic";
  url: string;
  title?: string;
};

type CollectedPhoneNumber = {
  id: string;
  raw: string;
  normalized?: string;
  valid: boolean;
  selected: boolean;
  duplicateOf?: string;
  reason?: string;
};
```

## Review Notes

```text
Status: COMPLETE

Files changed:

- `apps/extension/src/phone-collector/types.ts`
- `features/phone-collector/progress.md`

State strategy:

- Persist one versioned `PhoneCollectorState` value in `chrome.storage.local` under the `phoneCollectorState` key. This matches the extension's current storage pattern and preserves the user's review/selection after the popup closes or rerenders.
- Keep extraction candidates separate from review rows. Review rows retain the original raw value, the editable value, validation status, normalized value when valid, and selection state.
- Keep collection and sync statuses/errors in the same state object. Leave the backend sync result shape for Phase 7, when the API contract is designed.
- Track duplicates in the summary and omit duplicate entries from the review list; `found` counts extracted candidates, while `valid`, `invalid`, and `duplicates` describe post-deduplication review results.

Known limitations:

- Persisted phone candidates remain in local extension storage until replaced or cleared by later UI behavior.
- IDs are opaque strings; generation and collision handling are left to the extraction/state implementation phases.
- Type definitions do not enforce invariants such as keeping invalid numbers unselected; the state update flow must enforce them.
```

## Review Gate

Review the data shape before adding extraction logic.

---

# Phase 3 - Add Page Extraction Logic

## Checklist

* [x] Add reusable generic phone extraction helper.
* [x] Extract from visible page text.
* [x] Extract from `tel:` links.
* [x] Extract from relevant DOM attributes only when useful.
* [x] Keep Facebook-specific logic out of the generic collector.
* [x] Return raw candidate numbers with minimal source metadata.
* [x] Avoid aggressive scrolling or crawling.
* [ ] Add focused tests if the project test setup supports it.

## Review Notes

```text
Status: REVIEWED - user directed continuation; manual page verification pending

Files changed:

- `apps/extension/src/phone-collector/phone-extractor.ts`
- `features/phone-collector/progress.md`

Extraction sources:

- Rendered text from `document.body.innerText`.
- Visible `tel:` links, decoding percent escapes when possible.
- Visible `aria-label`, `title`, `data-phone`, `data-telephone`, `data-mobile`, and telephone microdata `content` values.
- Candidate values must contain 7 to 15 decimal digits. Unicode decimal digits are retained as raw candidates for Phase 4 normalization.
- Candidate records contain an opaque ID, raw text, and source kind. This phase does not normalize, validate, or deduplicate.
- No scrolling, pagination, or Facebook-specific extraction was added.

Tests/checks:

- No tests or build checks were run. Manual extraction verification remains pending.

Known limitations:

- Extraction runs with a page `Document`; Phase 5 now injects and calls it through the active-tab messaging path.
- `innerText` and computed styles rely on the browser DOM; closed shadow roots are not scanned.
- Duplicate candidates can be returned when a number appears in both visible text and an attribute. Phase 4 owns deduplication.
- The focused test checklist item remains open.

Function notes:

- `extractPhoneCandidates(doc)`: scans the document's rendered text and visible phone-related links/attributes, returning raw candidates with source labels.
- `extractPhoneCandidatesFromText(text, origin)`: finds phone-shaped substrings with 7-15 decimal digits and creates candidate records; it does not normalize or validate them.
- `isPhoneCandidateElementVisible(element)`: rejects an element if it or an ancestor is hidden by HTML attributes or computed CSS.
- `createPhoneCandidateId()`: creates a random opaque ID, with a timestamp/sequence/random fallback when `crypto.randomUUID()` is unavailable.
```

## Review Gate

Verify extraction on a generic loaded page before adding normalization/validation.

---

# Phase 4 - Normalize, Validate, and Deduplicate Numbers

## Checklist

* [x] Search for existing phone validation logic (none found).
* [x] Search for an existing phone-number library (none found; added `libphonenumber-js`).
* [x] Normalize equivalent number formats to a consistent representation.
* [x] Validate candidates for UX.
* [x] Deduplicate normalized numbers.
* [x] Preserve invalid candidates separately when useful.
* [ ] Add tests for normalization and deduplication.

Example equivalent inputs:

```text
010 1234 5678
010-1234-5678
+20 10 1234 5678
00201012345678
```

Expected conceptual normalized form:

```text
+201012345678
```

## Review Notes

```text
Status: IMPLEMENTED - build passed; tests pending

Files changed:

- `apps/extension/package.json`
- `apps/extension/package-lock.json`
- `apps/extension/scripts/copy-static.mjs`
- `apps/extension/src/popup/popup.html`
- `apps/extension/src/phone-collector/libphonenumber.d.ts`
- `apps/extension/src/phone-collector/phone-normalizer.ts`
- `apps/extension/src/phone-collector/phone-extractor.ts`
- `features/phone-collector/progress.md`

Normalization strategy:

- Use `libphonenumber-js` 1.13.14 with its max metadata browser bundle for strict digit-pattern validation. The build copies the bundle locally, and the popup loads it before the normalizer; runtime parsing does not use a CDN.
- Treat national-format numbers as Egyptian (`EG`) based on the supplied examples. Explicit international country codes take precedence; a leading `00` is converted to `+`.
- Normalize Unicode compatibility forms and decimal digits before parsing, then use strict parsing (`extract: false`) and `isValid()`.
- Store valid values in E.164 format. Deduplicate valid numbers by that canonical value, retain the first candidate, and count later matches as duplicates.
- Keep invalid candidates in the review rows with a reason and `selected: false`; valid unique rows start selected.

Validation strategy:

- Client-side validation uses the library's full metadata for UX only. Backend validation remains required in Phase 7.
- The library's `parseDigits()` handles non-ASCII decimal digits; no custom digit table was added.

Tests/checks:

- Dependency install completed; npm reported zero vulnerabilities.
- Extension development build passed (`npm run build:dev`).
- No tests were added or run; the focused normalization test checklist remains open.

Known limitations:

- The default region for unprefixed local numbers is Egypt. Other local numbering plans need an explicit country-selection design.
- Invalid candidates are preserved individually; duplicate counting currently applies to valid canonical numbers.
- The API must independently validate and deduplicate in Phase 7.

Function notes:

- `normalizeAndDeduplicatePhoneCandidates(candidates)`: builds review rows and summary counts, omitting repeated valid E.164 numbers.
- `normalizePhoneNumber(raw)`: validates one full candidate using `EG` as the default region and returns its E.164 value or an error reason.
- `normalizePhoneInput(value)`: applies Unicode compatibility normalization, converts Unicode decimal digits with the library, and maps `00` to `+`.
```

## Review Gate

Confirm phone handling rules before connecting the collector to UI.

---

# Phase 5 - Wire Extension Messaging

## Checklist

* [x] Add/reuse a popup-to-background or popup-to-content message for collection.
* [x] Ensure collection happens in the content script/page context.
* [x] Handle missing content script.
* [x] Handle restricted browser pages.
* [x] Return normalized collection results to the popup.
* [x] Preserve existing extension messaging behavior.
* [x] Add logging that avoids sensitive data.

## Review Notes

```text
Status: IMPLEMENTED - build passed; manual active-tab verification pending

Files changed:

- `apps/extension/manifest.json`
- `apps/extension/src/background.ts`
- `apps/extension/src/popup/popup.ts`
- `apps/extension/src/phone-collector/content.ts`
- `apps/extension/src/phone-collector/types.ts`
- `features/phone-collector/progress.md`

Message flow:

- Popup's `requestPhoneCollection()` sends `{ type: "COLLECT_PHONE_NUMBERS" }` to the service worker.
- The worker queries the active tab in the last-focused window, rejects non-HTTP(S) pages, and pings for an existing collector.
- If needed, the worker injects the local phone library, extractor, normalizer, and content listener into the active tab's isolated content context.
- The content listener extracts and normalizes there, then responds with source metadata, raw candidates, review rows, and summary. Nothing is sent to the backend or persisted in this phase.
- Injection paths are derived from the manifest's service-worker location, supporting both the source extension folder and the packaged `dist` folder.

Error handling:

- Returns distinct errors for no active tab, unsupported browser/file pages, injection failure, and collection failure/no response.
- Does not log candidate values or include phone data in error responses.
- Uses `activeTab` and `scripting`; it does not request broad host permissions.

Tests/checks:

- `npm run build:dev` passed.
- Confirmed the packaged output contains the local phone library, extractor, normalizer, and content listener, and the generated manifest includes `scripting`.
- No tests were run. Manual active-tab collection verification remains pending.

Known limitations:

- The popup now exposes the collection message through the Phone Collector view; active-tab collection still needs manual verification.
- Active-tab collection still needs to be manually verified in Chrome on both a normal page and a restricted browser page.
- Collection handles the top-level document and does not traverse frames or closed shadow roots.

Function notes:

- `getPhoneCollectorScriptFiles()`: builds script paths relative to the service worker's directory in the active extension layout.
- `collectPhoneNumbersFromActiveTab()`: finds the active tab, checks page access, installs the collector if missing, and returns its response or a user-facing error.
- `requestPhoneCollection()`: sends the popup request and converts message transport failures into a typed collection error for the UI.
- `getPhoneCollectionSource()`: records page URL/title and classifies Facebook versus generic pages.
- `collectPhoneNumbersForCurrentPage()`: runs extraction and normalization inside the content script and assembles the response.
- The content runtime message listener answers the readiness ping and invokes collection while catching page-scan errors.
```

## Review Gate

Verify the extension can collect from the active tab before building the full review UI.

---

# Phase 6 - Add Phone Collector Tab UI

## Checklist

* [x] Add a new `Phone Collector` tab to the existing extension UI.
* [x] Show current active page URL/title.
* [x] Add `Collect Numbers` action.
* [x] Show loading state during collection.
* [x] Show empty state when no numbers are found.
* [x] Show inaccessible-page/content-script errors.
* [x] Show summary counts: found, valid, duplicates, invalid.
* [x] Display valid and invalid numbers in an editable review list.
* [x] Allow select/unselect for valid entries.
* [x] Allow select all valid entries.
* [x] Allow clear selection.
* [x] Allow removing incorrect numbers.
* [x] Preserve collection and review state across popup close/reopen.

## Review Notes

```text
Status: IMPLEMENTED - development build passed; manual UI review pending

Files changed:

- `apps/extension/src/popup/popup.html`
- `apps/extension/src/popup/popup.ts`
- `apps/extension/src/popup/popup.css`
- `features/phone-collector/progress.md`

UI behavior:

- Added accessible Groups and Phone Collector tabs. Tab switching supports left/right arrows and Home/End.
- Set the popup width to 600px without a viewport-width cap, and increased typography, spacing, and control dimensions after visual feedback that the original compact sizing was too small.
- The collector displays the active tab title and URL, a Collect Numbers action, collection/loading/error/empty states, and found/valid/duplicate/invalid totals.
- The review list contains editable valid and invalid rows. Invalid rows cannot be selected; valid edits are normalized again, and edits duplicating another valid row are rejected with a row-level message.
- Users can select or clear individual valid rows, select all valid rows, clear all selections, and remove rows.
- No sync or confirmation UI was added; that belongs to Phase 8.

State behavior:

- Collection and review choices persist under `phoneCollectorState`; the selected popup view persists under `phoneCollectorActiveView`.
- A collection left in progress when the popup closes is recovered as a retryable interruption error. Collection failures retain the existing review rows.
- Invalid rows stay unselected until corrected and validated.
- Totals are a snapshot of the collection result and do not change when the user edits or removes rows; the UI labels them Collection totals.

Tests/checks:

- `npm run build:dev` passed in `apps/extension`.
- Tests were not run. Manual UI review and active-tab collection verification remain pending.

Function notes:

- `createEmptyPhoneCollectorState()`: creates the versioned idle state and zeroed collection totals.
- `setActivePopupView(view)`: updates tab accessibility/visibility, refreshes active-page details, and saves the chosen view.
- `handlePopupTabKeydown(event)`: provides keyboard navigation between the popup tabs.
- `loadActivePageDetails()`: reads the active browser tab and renders its title and URL, including an unavailable-page fallback.
- `loadPhoneCollectorState()`: restores the saved collection and selected view, recovering an interrupted collection so it can be retried.
- `persistPhoneCollectorState()`: stores the current collection/review state in `chrome.storage.local`.
- `renderPhoneCollector()`: renders summary counts, status text, selection count, and the review list from state.
- `renderPhoneReviewNumber(number)`: builds one DOM row with editable input, validation status, selection checkbox, and remove action.
- `setPhoneNumberSelected(id, selected)`: updates one valid row's selection.
- `selectAllValidPhoneNumbers()`: selects every valid row and leaves invalid rows unselected.
- `clearPhoneNumberSelection()`: clears selection without deleting rows.
- `removePhoneReviewNumber(id)`: removes a row and its transient edit warning.
- `updatePhoneReviewNumber(id, value)`: normalizes an edited value, updates validation/selection, and blocks duplicates of another valid row.
- `collectPhoneNumbers()`: requests a scan from the extension worker, retains previous rows on failure, and saves successful results for review.
- `requestPhoneCollection()`: sends the collector message to the service worker and maps transport failures to a typed error response.
```

## Review Gate

Manually review the UI before adding backend sync.

---

# Phase 7 - Add Backend/API Sync Contract

## Checklist

* [x] Locate existing PostFlow API patterns for extension requests.
* [x] Decide whether an existing endpoint can accept collected numbers.
* [x] Add a separate backend endpoint and service; the groups endpoint is Facebook-specific.
* [x] Validate and normalize numbers server-side.
* [x] Deduplicate numbers server-side.
* [x] Persist numbers in a user-owned phone contacts collection.
* [x] Include source metadata: type and URL.
* [x] Return clear sync counts/details.
* [ ] Add backend tests if applicable.

Conceptual request:

```json
{
  "numbers": [
    "+201001234567",
    "+201112345678"
  ],
  "source": {
    "type": "facebook",
    "url": "CURRENT_PAGE_URL"
  }
}
```

## Review Notes

```text
Status: IMPLEMENTED - API build passed; tests pending; contract review pending

Files changed:

- `apps/api/package.json`
- `apps/api/package-lock.json`
- `apps/api/src/app.module.ts`
- `apps/api/src/schemas/phone-contact.schema.ts`
- `apps/api/src/phone-contacts/phone-contacts.controller.ts`
- `apps/api/src/phone-contacts/phone-contacts.service.ts`
- `apps/api/src/phone-contacts/phone-contacts.module.ts`
- `features/phone-collector/progress.md`

Endpoint/contract:

- `POST /api/phone-contacts/sync`; requires the existing `x-clerk-user-id` header. It does not require a verified Facebook identity.
- Request: `{ "numbers": ["+201001234567"], "source": { "type": "facebook", "url": "https://www.facebook.com/..." } }`.
- Response fields: `submitted` is the input item count; `valid` is the count of unique valid E.164 numbers; `duplicates` counts repeated valid numbers within the request; `invalid` counts rejected inputs; `added` counts new user records; `alreadyExisted` counts numbers already stored for that user.
- Sync batches are limited to 500 entries.

Validation behavior:

- The API uses `libphonenumber-js/max` independently of the extension, with Egypt as the default region, Unicode decimal digit conversion, and `00` prefix handling. Invalid candidates are counted and never stored.
- The API validates source type and HTTP(S) URL, rejects URLs with credentials, and removes URL fragments before storage.
- A compound unique index on `clerkUserId` and `normalizedNumber` enforces per-user deduplication. Repeat sync updates the source and last-seen timestamp rather than inserting another row.
- Source metadata represents the latest sync source for each number; source history is not retained.

Tests/checks:

- `npm run build` passed in `apps/api`.
- Backend tests were not added or run. The npm install audit output reported two high-severity dependency advisories; they were not investigated in this phase.

Function notes:

- `PhoneContactsController.sync()`: requires the Clerk user header, rejects a non-object body, and delegates the request to the service.
- `isRecord(value)`: checks that untrusted values are non-null, non-array objects before accessing fields.
- `normalizePhoneNumber(value)`: converts compatible/Unicode digits, parses using the shared phone library rules, and returns E.164 only when valid.
- `normalizePhoneSource(value)`: validates the source type and web URL, removes fragments, and returns canonical metadata.
- `PhoneContactsService.syncPhoneNumbers()`: validates the batch, counts invalids and duplicates, and bulk-upserts unique numbers with their latest source metadata.
```

## Review Gate

Review the backend contract before wiring it to the extension UI.

---

# Phase 8 - Add Confirmation and Sync UI

## Checklist

* [x] Disable sync when no valid numbers are selected or no source is available.
* [x] Show confirmation before sending.
* [x] Send only selected, valid normalized numbers.
* [x] Use the existing extension API/auth pattern.
* [x] Show sync in progress.
* [x] Show API/auth/session and network errors.
* [x] Show sync result counts from the backend response.
* [x] Keep selected numbers visible after failure for retry.
* [x] Do not automatically sync after collection.

## Review Notes

```text
Status: IMPLEMENTED - extension build passed; manual sync verification pending

Files changed:

- `apps/extension/src/phone-collector/types.ts`
- `apps/extension/src/background.ts`
- `apps/extension/src/popup/popup.html`
- `apps/extension/src/popup/popup.ts`
- `apps/extension/src/popup/popup.css`
- `features/phone-collector/progress.md`

Confirmation behavior:

- The send button is disabled unless at least one valid number is selected and collection source metadata is available.
- Sending opens a confirmation dialog with the current selected count. Cancel or Escape closes it without an API request.

Sync behavior:

- Popup asks the service worker to sync; the worker reads persisted collector state and derives selected, valid E.164 numbers itself. It does not trust a phone list supplied in the message.
- The worker calls `/api/phone-contacts/sync` through `apiFetch`, using the established Clerk user and extension instance headers.
- The popup displays progress, success counts, authentication/permission/network/server errors, and retains the review selection on failure.
- After a successful sync, the popup clears its local candidates, numbers, source, and selection while retaining the sync result. Failures preserve the review for retry.
- Sync results persist locally. If the popup closes during a request, reopening exposes a retryable state; retry is idempotent against the Phase 7 endpoint.
- Collection never triggers sync. The request only starts after explicit confirmation.

Tests/checks:

- `npm run build:dev` passed in `apps/extension`.
- Tests were not run. Manual confirmation, success, and API-failure flows remain pending.
- A manual sync attempt returned no background-worker response; the built worker contains the sync handler. Reloading the unpacked extension and retrying is pending.

Function notes:

- `isApiFetchFailure(value)`: recognizes the optional structured error result from the shared API helper.
- `isPhoneSyncResult(value)`: validates the backend count fields before they are displayed.
- `phoneSyncErrorForStatus(status)`: maps HTTP and network status codes to safe user-facing errors.
- `apiFetch(...)`: retains existing API/auth behavior and optionally returns status details for this sync workflow.
- `syncPhoneNumbersToBackend()`: loads persisted state, filters selected valid numbers, and calls the backend contract.
- `getSelectedPhoneNumbers()`: returns unique normalized values selected in the current review state.
- `openPhoneSyncConfirmation()`: opens the confirmation dialog and persists the confirming state.
- `closePhoneSyncConfirmation()`: cancels confirmation without sending.
- `handlePhoneSyncDialogClose()`: restores idle state when the dialog is dismissed with Escape.
- `requestPhoneSync()`: sends the popup-to-worker sync message and maps message transport failures.
- `confirmAndSyncPhoneNumbers()`: persists syncing status, requests sync, and saves either the backend result or a retryable error.
```

## Review Gate

Manually verify review-before-sync behavior.

---

# Phase 9 - Manual Testing

## Scenario A - Generic Page

* [ ] Open a page with visible phone numbers.
* [ ] Collect numbers successfully.
* [ ] Duplicates are removed.
* [ ] Valid numbers can be selected and removed.

## Scenario B - Facebook Page

* [ ] Open a Facebook page with already-loaded phone numbers.
* [ ] Current page metadata is displayed.
* [ ] Collection works through the content script.
* [ ] No Facebook-specific crawler behavior is triggered.

## Scenario C - Restricted Page

* [ ] Open a browser internal page.
* [ ] Collection fails gracefully.
* [ ] The extension does not crash.

## Scenario D - Review Gate

* [ ] Collection does not automatically sync.
* [ ] Sync requires explicit confirmation.
* [ ] Only selected numbers are sent.

## Scenario E - API Failure

* [ ] Simulate or trigger sync failure.
* [ ] Failure state is shown.
* [ ] User can retry without collecting again.

## Review Notes

```text
Status: NOT STARTED

Manual test environment:

-

Results:

-

Known issues:

-
```

---

# Phase 10 - Add Leads Dashboard and Clear Successful Submissions

## Checklist

* [x] Clear locally collected numbers, candidates, and source metadata after successful sync.
* [x] Preserve the review selection when sync fails.
* [x] Add an authenticated, per-user API listing with phone-number search and pagination.
* [x] Add a Leads page to the dashboard with source links and collection timestamps.
* [x] Add Leads to dashboard navigation.

## Review Notes

```text
Status: IMPLEMENTED - API and extension builds passed; web typecheck passed

Files changed:

- `apps/extension/src/popup/popup.ts`
- `apps/api/src/phone-contacts/phone-contacts.controller.ts`
- `apps/api/src/phone-contacts/phone-contacts.service.ts`
- `apps/api/src/schemas/phone-contact.schema.ts`
- `apps/web/src/components/app-sidebar.tsx`
- `apps/web/src/app/(dashboard)/leads/page.tsx`
- `features/phone-collector/feature.md`
- `features/phone-collector/progress.md`

Behavior:

- Successful sync clears the extension's captured review data while preserving the backend result counts.
- The API scopes every lead query to the authenticated Clerk user and returns paginated contacts ordered by last collection time.
- The dashboard page supports phone-number search, pagination, click-to-call numbers, and links to source pages.

Checks completed:

- `npm run build` passed in `apps/api`.
- `npm run build:dev` passed in `apps/extension`.
- `npx tsc --noEmit` passed in `apps/web`.
- The API endpoint responds with 401 when called without an authenticated user header.
- `npm run build` in `apps/web` could not fetch the existing Inter font from Google Fonts in this network-restricted environment.
- Browser-level sync and Leads data verification remains pending.
```

## Review Gate

Verify a successful submission clears the extension review, a failed submission retains it, and synced contacts appear only for the signed-in user in the Leads page.

---

# Phase 11 - Cleanup and Final Verification

## Checklist

* [ ] Remove temporary debugging code.
* [ ] Keep useful structured logs only.
* [ ] Confirm no auto-scroll/crawling was introduced.
* [ ] Confirm no automatic backend sync happens after collection.
* [ ] Confirm client-side validation is not treated as backend trust.
* [ ] Confirm existing extension flows still work.
* [ ] Run relevant extension checks.
* [ ] Run relevant API checks.
* [ ] Update this progress file.

## Review Notes

```text
Status: NOT STARTED

Files changed:

-

Checks completed:

-

Known limitations:

-
```

---

# Progress Summary

| Phase | Status | Reviewed |
| --- | --- | --- |
| 1. Inspect existing architecture | Complete | Yes |
| 2. Define types and state | Complete | Yes |
| 3. Add extraction logic | Complete | Yes |
| 4. Normalize, validate, deduplicate | Complete | Yes |
| 5. Wire extension messaging | Complete | Yes |
| 6. Add Phone Collector tab UI | Complete | Yes |
| 7. Add backend/API sync contract | Complete | Yes |
| 8. Add confirmation and sync UI | Complete | No |
| 9. Manual testing | Not Started | No |
| 10. Leads dashboard and successful-submission cleanup | Implemented | No |
| 11. Cleanup and final verification | Not Started | No |

---

# AI Agent Workflow

For every implementation session:

1. Read `feature.md`.
2. Read this file.
3. Find the first incomplete phase.
4. Inspect existing code relevant to that phase.
5. Implement only that phase.
6. Update its checklist and notes.
7. Run relevant checks.
8. Provide a review summary.
9. Stop.

Do not continue automatically to the next phase.

---

# Review Summary Template

```text
Phase completed:

Files changed:

Implementation:

Extension/message flow:

Backend changes:

Tests/checks:

Known limitations:

Progress file updated:
Yes

Ready for review:
Yes
```
