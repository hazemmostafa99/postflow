# Phone Collector - Feature Specification

## Feature Name

Phone Collector

## Goal

Add a new Chrome Extension tab that lets a user collect phone numbers from the currently opened page, review and adjust the results, then manually sync the approved numbers with PostFlow.

The required user flow is:

```text
Collect -> Validate -> Review/Edit -> Select -> Confirm -> Sync -> Show Result
```

Do not automatically send collected numbers to the backend.

---

# Progress Tracking

This feature must be implemented using:

```text
progress.md
```

Before making any code changes:

1. Open `progress.md`.
2. Identify the first incomplete phase.
3. Work only on that phase.
4. Update the progress file after completing the phase.
5. Stop after the phase is complete.
6. Wait for review before continuing to the next phase.

Do not complete multiple phases in one pass unless explicitly instructed.

The progress file is the source of truth for implementation status.

---

# Existing Project Constraint

The repository already contains an existing browser extension and PostFlow/backend integration.

Extend the current implementation. Do not rebuild the project from scratch.

Before implementation, inspect and reuse:

* Extension architecture.
* Current tabs/pages inside the extension.
* Content script/background service worker messaging.
* Existing API/backend integration patterns.
* Existing authentication, state, and storage utilities.
* Existing UI components and styling conventions.
* Existing phone validation or normalization logic, if present.

Reuse the existing architecture, naming conventions, utilities, and UI patterns whenever possible.

---

# User Flow

1. The user opens a webpage, such as a Facebook page.
2. The user opens the extension popup.
3. The user navigates to a new tab called `Phone Collector`.
4. The extension displays the current active tab/page.
5. The user clicks `Collect Numbers`.
6. The extension scans the currently loaded page through the appropriate content script/page context.
7. The extension normalizes, validates, and deduplicates the extracted numbers.
8. The extension shows a review screen.
9. The user selects, unselects, edits, or removes numbers.
10. The user clicks `Send to PostFlow`.
11. The extension shows a confirmation step.
12. After confirmation, the selected numbers are sent to PostFlow through the existing API/backend integration.
13. The extension displays the backend sync result.
14. After a successful sync, the submitted collection is cleared from the extension review; failed submissions remain available for retry.
15. Saved phone contacts are available from a Leads page in the PostFlow dashboard.

## Leads Dashboard

The dashboard's `Leads` page lists the signed-in user's saved phone contacts with their source page and collection timestamps. The list supports phone-number search and pagination. Leads remain stored in PostFlow when the extension clears its local review after a successful submission.

---

# First Version Scope

Collect phone numbers only from content that is already loaded in the page DOM.

Do not implement yet:

```text
aggressive auto-scrolling
continuous scraping
pagination crawling
background crawling
bulk Facebook scraping
site-specific Facebook scraping beyond basic source metadata
```

The first version should be simple and stable, while leaving room for later:

```text
infinite scrolling
automatic scrolling
collecting newly loaded content
site-specific collectors
```

---

# Extraction Requirements

Extract candidate phone numbers from useful page sources such as:

* Visible page text.
* `tel:` links.
* Relevant DOM attributes when appropriate.

Do not tightly couple the generic collector to Facebook.

Create reusable extraction logic so other websites can use the same collector.

The architecture should allow future collectors such as:

```text
generic collector
Facebook collector
LinkedIn collector
Google Maps collector
```

without rewriting the core flow.

---

# Normalization, Validation, and Deduplication

After extraction:

* Normalize phone numbers.
* Validate numbers.
* Remove duplicates.
* Separate valid and invalid results when useful.

Example source values:

```text
010 1234 5678
010-1234-5678
+20 10 1234 5678
00201012345678
```

These should ideally normalize to a consistent format such as:

```text
+201012345678
```

Use the project's existing phone validation logic if one already exists.

If the project already uses a library such as `libphonenumber-js`, reuse it instead of introducing duplicate logic.

Client-side validation is for UX only. The backend must still treat numbers from the extension as untrusted input and perform its own validation and deduplication.

---

# Review UI

The Phone Collector tab should show the current page and collection results.

Example:

```text
Phone Collector

Current page:
facebook.com/...

Collection complete

Found: 48
Valid: 41
Duplicates: 5
Invalid: 2

[Select All] [Clear]

[x] +201001234567   [Remove]
[x] +201112345678   [Remove]
[x] +201221234567   [Remove]

[Send 41 Numbers to PostFlow]
```

The user must be able to:

* View collected numbers.
* Select and unselect numbers.
* Remove incorrect numbers.
* Select all.
* Clear selection.
* Review invalid results when useful.

---

# Sync Flow

When the user clicks `Send to PostFlow`, show a confirmation step:

```text
You are about to send 40 phone numbers to PostFlow.

[Cancel]
[Confirm & Sync]
```

After confirmation, send selected numbers using the existing PostFlow API/backend architecture.

Conceptual payload:

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

Adapt the exact payload to existing backend contracts.

Do not create a completely separate API layer if the project already has one.

After the backend responds, show a sync result based on the real response:

```text
Sync Complete

40 sent
35 added
5 already existed
0 invalid
```

---

# Architecture

Prefer a flow similar to:

```text
Extension Phone Collector UI
        |
Extension messaging layer
        |
Background / Service Worker if required
        |
Content Script
        |
Extract numbers from current page
        |
Normalize / Validate / Deduplicate
        |
Return results to Extension UI
        |
User reviews numbers
        |
User confirms
        |
PostFlow API
        |
Display sync result
```

Extraction must happen through the appropriate content script or page context.

Do not attempt to read page DOM directly from the popup or background worker if the existing architecture does not support that.

---

# State

Collection state should survive normal extension UI re-renders.

Use the existing state/store solution if one exists.

If persistence is needed, prefer the existing extension storage abstraction or `chrome.storage.local`.

Do not rely only on an in-memory variable inside a Manifest V3 service worker because it may be suspended.

---

# Error and Loading States

Handle at least:

* Collection in progress.
* No phone numbers found.
* Page cannot be accessed.
* Content script unavailable.
* Unsupported or restricted browser page.
* API sync in progress.
* API sync failure.
* Authentication or session error if relevant.
* Successful sync.

Example messages:

```text
Collecting phone numbers...
```

```text
No phone numbers were found on this page.
```

```text
Unable to scan this page. Browser internal pages cannot be accessed.
```

---

# Suggested Module Responsibilities

Follow the current project structure first.

If new modules are required, keep responsibilities separated conceptually:

```text
phone-collector/
  phoneExtractor
  phoneNormalizer
  phoneValidator
  phoneDeduplicator
  collection state/store
  Boost sync service
  Phone Collector UI
```

Exact file and folder names should follow existing project conventions.

---

# Backend Requirements

Use existing PostFlow backend patterns.

The backend should:

* Treat extension-provided numbers as untrusted input.
* Validate and normalize numbers server-side.
* Deduplicate numbers.
* Associate synced numbers with useful source metadata.
* Return counts or details that the extension can display.

Do not invent a new backend contract without first checking existing models, controllers, and services.

---

# Implementation Rules for AI Agent

When working on this feature:

1. Read this file.
2. Read `progress.md`.
3. Inspect the existing code before making architectural decisions.
4. Find the first incomplete progress phase.
5. Implement only that phase.
6. Keep changes minimal and focused.
7. Update `progress.md`.
8. Include:

   * files changed,
   * implementation summary,
   * assumptions,
   * known limitations.

9. Run available lint, typecheck, or tests relevant to the changed code.
10. Stop after finishing the current phase.

Do not automatically start the next phase.

---

# Manual Test Cases

## Test 1 - Generic Page With Numbers

Action:

Open a normal webpage containing phone numbers and run collection.

Expected:

* Numbers are extracted from visible content.
* Duplicates are removed.
* Valid numbers are selectable.
* Invalid candidates are either hidden or shown separately according to the chosen UX.

---

## Test 2 - Facebook Page

Action:

Open a Facebook page with phone numbers already loaded in the DOM.

Expected:

* The current page is shown.
* Collection runs through the content script.
* DOM access failures are handled gracefully.

---

## Test 3 - Restricted Browser Page

Action:

Open a browser internal page such as `chrome://extensions`.

Expected:

* The extension does not crash.
* The UI shows an inaccessible-page error.

---

## Test 4 - Review Before Sync

Action:

Collect numbers, remove one, clear selection, select all, then sync.

Expected:

* Only selected numbers are sent.
* No numbers are sent before confirmation.

---

## Test 5 - API Failure

Action:

Trigger sync while the backend is unavailable or session is invalid.

Expected:

* The selected numbers remain visible.
* The UI shows a clear failure state.
* The user can retry after fixing the issue.

---

# Out of Scope

Do not implement in the first version:

```text
automatic scrolling
continuous scraping
pagination
site-specific Facebook crawler
LinkedIn collector
Google Maps collector
CRM enrichment
automatic sync without review
scheduled phone collection
```

---

# Definition of Done - Initial Feature

The initial Phone Collector feature is complete when:

* A Phone Collector tab exists in the extension.
* The tab shows the current active page.
* The user can collect numbers from the loaded DOM through the content script/page context.
* Numbers are normalized, validated, and deduplicated.
* The user can review, select, unselect, and remove numbers.
* The user must confirm before syncing.
* Selected numbers sync through the existing PostFlow API/backend architecture.
* The UI shows loading, empty, inaccessible-page, sync failure, and success states.
* Client-side and backend validation are both in place where required.
* Existing extension functionality remains intact.
* `progress.md` is fully updated.
* Relevant checks/tests pass or known existing blockers are documented.
