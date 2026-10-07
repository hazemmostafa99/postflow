# Lead Qualification Board - Feature Specification

## Feature Name

Lead Qualification Board

## Goal

Turn the existing Leads page into a focused qualification workspace where a
signed-in user can:

- Review newly collected leads.
- Mark a lead as `Qualified` or `Not Qualified`.
- Organize leads into simple business groups such as `Villas`, `Apartments`,
  `Real Estate`, or `Marketing`.
- Record notes against each lead.
- Search and filter the board without losing the existing source and collection
  information.

The main working view should be a responsive two-column board:

```text
Needs Review (3)

Qualified (12)                    Not Qualified (8)
+--------------------------+      +--------------------------+
| +20 100 123 4567         |      | +20 111 234 5678         |
| Group: Villas            |      | Group: Marketing         |
| Interested in New Cairo  |      | Wrong audience           |
| Facebook - 2 hours ago   |      | Website - yesterday      |
+--------------------------+      +--------------------------+
```

Existing lead collection and synchronization behavior must continue to work.

---

## Existing Project Constraints

The repository already has:

- A dashboard page at `apps/web/src/app/(dashboard)/leads/page.tsx`.
- Lead create, edit, and delete controls.
- A NestJS phone contacts controller and service.
- A MongoDB `PhoneContact` schema.
- Search, category filtering, source metadata, and pagination.
- Per-user lead ownership through `clerkUserId`.

Extend these implementations. Do not create a second lead model, a separate
CRM module, or a parallel API.

All reads and mutations must remain scoped to the authenticated user's
`clerkUserId`.

---

## Terminology

### Lead Status

Qualification is represented by an explicit three-state value:

```text
UNREVIEWED
QUALIFIED
NOT_QUALIFIED
```

`UNREVIEWED` is required even though the main board has two columns. A newly
collected lead has not yet been rejected and must not be silently treated as
`NOT_QUALIFIED`.

### Lead Group

For the first version, a lead belongs to zero or one business group.

The existing `category` field is the persisted lead-group value. The dashboard
should label this concept as `Group` or `Lead Group`, while the backend may keep
the field name `category` for compatibility with the collector and existing
stored data.

Examples:

```text
Villas
Apartments
Real Estate
Marketing
Uncategorized
```

This feature does not introduce a separate Group collection or reuse the
Facebook publishing Group model.

### Notes

The first version stores one editable plain-text notes field on each lead. It is
not a note history or activity timeline.

---

## User Experience

### Page Header and Filters

Keep the existing top-bar placement and provide:

- Search by phone number or lead group.
- Filter by lead group.
- Filter by qualification status when useful outside the board columns.
- An `Add Lead` action.
- A clear way to reset active filters.

Search and group filters apply consistently to the review area and both board
columns.

### Needs Review

Unreviewed leads appear in a compact `Needs Review` section above the two main
columns.

Each unreviewed lead must offer direct actions to mark it as:

- `Qualified`
- `Not Qualified`

The section must show its matching lead count and an empty state when no review
is required. It may initially show a limited number of cards with a way to view
or load more.

### Qualification Board

The main content contains:

- A `Qualified` column.
- A `Not Qualified` column.
- A count in each column heading.
- Independent empty states.
- Independent pagination or `Load more` behavior so a large column does not
  prevent the other column from being used.

On wide screens, display both columns side by side. On narrow screens, stack
them vertically without causing horizontal page scrolling.

Drag and drop is not required for the first version. Every card must instead
have an accessible button or menu for changing its status. The design may add
drag and drop later as progressive enhancement, but keyboard and touch users
must always have a non-drag action.

### Lead Card

Each card displays:

- Normalized phone number with a `tel:` link.
- Lead group, falling back to `Uncategorized`.
- A short, line-clamped notes preview when notes exist.
- Source type and source link when available.
- Added or last-collected timestamp.
- Qualification action.
- Edit and delete actions.

The full notes value must remain available through the edit/detail experience;
truncating the card preview must never truncate the stored value.

### Add and Edit Experience

Extend the existing lead dialog, or replace it with a consistent detail dialog
or side panel, to edit:

- Phone number.
- Lead group.
- Qualification status.
- Notes.

For a manually created lead, the default status is `UNREVIEWED` unless the user
explicitly chooses another status.

Saving, error, disabled, and loading states must remain clear. Closing a dialog
must not silently discard changes without the existing expected browser/dialog
behavior.

### Delete Experience

Keep an explicit confirmation before deleting a lead. Deletion remains scoped
to a lead owned by the signed-in user.

---

## Data Model

Extend `PhoneContact` with:

```ts
qualificationStatus: 'UNREVIEWED' | 'QUALIFIED' | 'NOT_QUALIFIED';
notes: string;
```

Recommended schema behavior:

```text
qualificationStatus
  required: true
  default: UNREVIEWED
  enum: UNREVIEWED, QUALIFIED, NOT_QUALIFIED

notes
  trim: true
  default: empty string
  maximum length: 2000 characters
```

Keep the existing fields and unique ownership constraint:

```text
clerkUserId
normalizedNumber
category
source
lastSeenAt
createdAt
updatedAt
```

Add an index suitable for owner-scoped status queries, for example:

```text
clerkUserId + qualificationStatus + lastSeenAt
```

Do not weaken the existing unique index on:

```text
clerkUserId + normalizedNumber
```

---

## Existing Data and Backward Compatibility

Existing contacts do not have `qualificationStatus` or `notes`.

They must behave as:

```text
qualificationStatus = UNREVIEWED
notes = ""
```

Queries for `UNREVIEWED` must temporarily include records where
`qualificationStatus` is missing, unless implementation includes a safe
backfill migration.

Do not classify existing leads as `NOT_QUALIFIED`.

The extension sync payload must remain compatible. If the extension does not
send qualification fields, newly inserted contacts default to `UNREVIEWED`.
When a previously qualified contact is collected again, synchronization may
update its source, category, and `lastSeenAt`, but must not reset its
qualification status or overwrite its notes.

---

## API Requirements

Continue using the existing base route:

```text
/api/phone-contacts
```

### List Leads

Extend:

```text
GET /api/phone-contacts
```

Supported query behavior should include:

```text
search
category
qualificationStatus
page
limit
```

Requirements:

- Validate `qualificationStatus` against the supported enum.
- Preserve current search, category, page, and limit behavior.
- Return `qualificationStatus` and `notes` for each contact.
- Return enough count information to render `Needs Review`, `Qualified`, and
  `Not Qualified` totals for the active search/group filters.
- Counts must remain scoped to the authenticated user.
- Status filtering must treat legacy records with no status as `UNREVIEWED`.

The frontend may request each status independently to support independent
column pagination. Avoid relying on one mixed paginated result and dividing
only that page in the browser, because its column counts and contents would be
incorrect.

### Create Lead

Extend:

```text
POST /api/phone-contacts
```

Accepted fields:

```ts
{
  number: string;
  category?: string;
  qualificationStatus?: 'UNREVIEWED' | 'QUALIFIED' | 'NOT_QUALIFIED';
  notes?: string;
}
```

Omitted status defaults to `UNREVIEWED`. Omitted notes default to an empty
string.

### Update Lead

Extend:

```text
PATCH /api/phone-contacts/:id
```

The endpoint should accept a partial update containing one or more of:

```ts
{
  number?: string;
  category?: string;
  qualificationStatus?: 'UNREVIEWED' | 'QUALIFIED' | 'NOT_QUALIFIED';
  notes?: string;
}
```

This allows a quick status change without resending the phone number and group.

Requirements:

- Reject an empty update.
- Validate only supplied fields.
- Preserve omitted fields.
- Normalize and validate a supplied phone number using the existing logic.
- Preserve duplicate-number handling.
- Reject unknown status values.
- Enforce the notes length limit server-side.
- Return the updated lead.
- Never update a lead owned by another user.

### Delete and Sync

Keep the existing routes and ownership behavior:

```text
DELETE /api/phone-contacts/:id
POST /api/phone-contacts/sync
```

Sync must not overwrite the notes or qualification status of an existing lead.

---

## Validation Rules

- Status must be one of the three supported values.
- Notes must be plain text with at most 2000 characters after normalization.
- Lead group continues to use the existing category normalization and
  80-character limit.
- Phone numbers continue to use the existing server-side normalization and
  validation.
- Client-side validation improves UX but never replaces backend validation.
- Unknown request fields must not be persisted.

---

## Loading, Empty, and Error States

Handle at least:

- Entire Leads API unavailable.
- One board request failing while another succeeds.
- No leads at all.
- No leads matching the active search/group filters.
- No unreviewed leads.
- Empty Qualified column.
- Empty Not Qualified column.
- Status update in progress.
- Status update failure with the card left in its previous state.
- Notes save in progress and failure.
- Delete in progress and failure.

Do not permanently move a card in the UI until the server accepts its new
status. An optimistic update is allowed only if it rolls back correctly on
failure.

---

## Accessibility Requirements

- Every status-changing control has an accessible name.
- Status is communicated in text, not by color alone.
- Board columns use meaningful headings.
- Dialog or side-panel focus is managed correctly.
- All actions work with keyboard navigation.
- Notes inputs have visible labels and error messages.
- Loading states expose appropriate disabled and busy behavior.

---

## Security and Ownership Requirements

- Resolve ownership on the backend using the authenticated Clerk user ID.
- Include `clerkUserId` in every lead read, count, update, and delete filter.
- Never trust a user ID, owner ID, or status count supplied by the client.
- Do not expose another user's groups, notes, sources, or counts.
- Preserve existing URL validation for lead sources.
- Render notes as text; do not inject note content as HTML.

---

## Suggested Implementation Phases

### Phase 1 - Schema and Service Behavior

- Add qualification status and notes to the schema.
- Support legacy records as unreviewed.
- Add normalization and validation helpers.
- Ensure sync preserves existing status and notes.
- Add relevant indexes.

### Phase 2 - API Contracts and Tests

- Add status filtering and counts.
- Make lead updates partial.
- Extend create and update responses.
- Add service/controller tests for ownership, validation, legacy records, and
  sync preservation.

### Phase 3 - Lead Editor

- Add status, group, and notes fields.
- Support quick status changes.
- Preserve existing create, edit, and delete behavior.

### Phase 4 - Board UI

- Add the Needs Review section.
- Add Qualified and Not Qualified columns.
- Build responsive lead cards and empty states.
- Add independent pagination or load-more behavior.

### Phase 5 - Filtering and Verification

- Apply search and group filters across all sections.
- Verify counts and URL/query behavior.
- Run lint, typecheck, unit tests, and relevant browser-level checks.

---

## Manual Test Cases

### Test 1 - Newly Collected Lead

Action:

Sync a new number from the extension without qualification or notes fields.

Expected:

- The lead is created successfully.
- It appears in `Needs Review`.
- Its status is `UNREVIEWED`.
- Its notes are empty.

### Test 2 - Qualify a Lead

Action:

Mark an unreviewed lead as qualified.

Expected:

- The API updates only the status.
- The card moves to the Qualified column after a successful response.
- Counts update correctly.

### Test 3 - Reject a Lead

Action:

Mark a qualified lead as not qualified.

Expected:

- The card moves from Qualified to Not Qualified.
- Its number, group, notes, and source remain unchanged.

### Test 4 - Edit Group and Notes

Action:

Set the group to `Villas` and add a note, then reopen the lead.

Expected:

- The group and full note are saved.
- The card shows the group and a shortened note preview.
- Reopening the editor shows the full stored note.

### Test 5 - Filter the Board

Action:

Filter by the `Villas` group.

Expected:

- Needs Review and both columns show only matching leads.
- Each displayed count represents the filtered result.
- Clearing the filter restores all leads.

### Test 6 - Legacy Lead

Action:

Load a stored contact that has no qualification status or notes fields.

Expected:

- It appears as unreviewed.
- The page does not crash.
- Editing it can persist the new fields.

### Test 7 - Recollect an Existing Qualified Lead

Action:

Sync a phone number that already belongs to a qualified lead with notes.

Expected:

- Source/category and `lastSeenAt` follow existing sync behavior.
- Status remains `QUALIFIED`.
- Notes remain unchanged.

### Test 8 - Ownership

Action:

Attempt to read, update, or delete another user's lead ID.

Expected:

- The lead is not returned or modified.
- No notes, group, status, source, or count information leaks.

### Test 9 - Failure During Status Change

Action:

Change a status while the API is unavailable.

Expected:

- A clear error is shown.
- The card remains in, or returns to, its previous column.
- The user can retry.

### Test 10 - Responsive and Keyboard Use

Action:

Use the page on a narrow viewport and navigate actions by keyboard.

Expected:

- Columns stack cleanly.
- No page-level horizontal overflow is introduced.
- Status, edit, and delete actions remain reachable and understandable.

---

## Out of Scope

Do not implement in the first version:

- Multiple groups/tags on one lead.
- A separate CRUD screen for group definitions.
- Reusing Facebook publishing groups as lead groups.
- Notes history, comments, mentions, attachments, or audit timeline.
- Lead assignment to another user or sales representative.
- Company-wide or team-wide shared lead visibility.
- Automated lead scoring.
- Automated qualification.
- Sales pipeline stages beyond the three qualification states.
- Required drag-and-drop behavior.
- Bulk status changes or bulk deletion.

---

## Definition of Done

This feature is complete when:

- Existing and newly synced leads safely default to `UNREVIEWED`.
- The Leads page includes a Needs Review area and separate Qualified and Not
  Qualified columns.
- Users can change a lead's status without resending unrelated fields.
- Users can store and edit one notes field per lead.
- The existing category is presented as a lead group.
- Search and group filters apply correctly across statuses.
- Each section shows correct filtered counts and supports large result sets.
- Existing source links, timestamps, add, edit, delete, sync, and phone
  validation behavior remain intact.
- Re-syncing a lead does not erase its status or notes.
- All API access remains owner-scoped.
- Legacy contacts without the new fields are handled correctly.
- Responsive, loading, empty, failure, and accessible interaction states are
  implemented.
- Relevant backend tests, frontend checks, lint, and typecheck pass, or any
  unrelated existing blockers are documented.
