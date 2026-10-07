# Lead Qualification Board - Implementation Progress

## Goal

Upgrade the existing Leads page into an owner-scoped qualification workspace
with:

```text
Needs Review
Qualified | Not Qualified
Lead Groups
Notes
```

## Source Documents

- `features/lead-qualification-board/feature.md`

---

## Progress Rules

Before making implementation changes:

1. Read `feature.md` and this progress file.
2. Identify the first incomplete phase.
3. Inspect the existing implementation related to that phase.
4. Work only on that phase unless the user explicitly requests multiple phases.
5. Run the checks relevant to the changed code.
6. Update the phase checklist and review notes.
7. Stop at the review gate before continuing to the next phase.

Do not mark a checkbox complete until the implementation exists and has been
verified. Document any skipped check or known blocker in the phase review
notes.

---

## Status Overview

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Schema and service behavior | Not started |
| 2 | API contracts and backend tests | Not started |
| 3 | Lead editor and quick actions | Not started |
| 4 | Qualification board UI | Not started |
| 5 | Filtering, compatibility, and final verification | Not started |

Current phase:

```text
Phase 1 - Schema and Service Behavior
```

---

# Phase 1 - Schema and Service Behavior

## Objective

Add persisted qualification and notes data without breaking existing contacts
or extension synchronization.

## Checklist

- [ ] Add the `UNREVIEWED`, `QUALIFIED`, and `NOT_QUALIFIED` status values.
- [ ] Add `qualificationStatus` to the `PhoneContact` schema.
- [ ] Default new contacts to `UNREVIEWED`.
- [ ] Add the plain-text `notes` field to the `PhoneContact` schema.
- [ ] Default notes to an empty string.
- [ ] Enforce the 2000-character notes limit.
- [ ] Add an owner/status/time index suitable for board queries.
- [ ] Preserve the existing owner/number unique index.
- [ ] Treat legacy contacts with a missing status as `UNREVIEWED`.
- [ ] Treat legacy contacts with missing notes as having empty notes.
- [ ] Add reusable qualification-status validation/normalization.
- [ ] Add reusable notes validation/normalization.
- [ ] Ensure extension sync leaves the status of an existing lead unchanged.
- [ ] Ensure extension sync leaves the notes of an existing lead unchanged.
- [ ] Ensure extension sync creates new leads as `UNREVIEWED`.
- [ ] Add or update service tests for schema/service behavior.
- [ ] Run the relevant API tests.
- [ ] Run the API build or typecheck.

## Review Notes

```text
Status: NOT STARTED

Files changed:
- None

Implementation:
- None

Tests/checks:
- Not run

Assumptions:
- Existing contacts must be considered unreviewed.
- Recollection must not erase manual CRM work.

Known limitations/blockers:
- None recorded
```

## Review Gate

Confirm that legacy data and extension sync are safe before changing the public
API contract.

---

# Phase 2 - API Contracts and Backend Tests

## Objective

Expose owner-scoped status, notes, filtering, counts, and partial updates to the
dashboard.

## Checklist

- [ ] Return `qualificationStatus` for every listed lead.
- [ ] Return `notes` for every listed lead.
- [ ] Add `qualificationStatus` filtering to `GET /api/phone-contacts`.
- [ ] Reject unsupported status filter values.
- [ ] Make `UNREVIEWED` filtering include legacy records with no stored status.
- [ ] Return status counts for the active search and group filters.
- [ ] Keep counts scoped to the authenticated `clerkUserId`.
- [ ] Preserve existing search behavior.
- [ ] Preserve existing category/group filtering behavior.
- [ ] Preserve existing pagination limits and validation.
- [ ] Accept optional status and notes fields when creating a manual lead.
- [ ] Default an omitted create status to `UNREVIEWED`.
- [ ] Change `PATCH /api/phone-contacts/:id` to accept partial updates.
- [ ] Reject an empty update payload.
- [ ] Validate only supplied update fields.
- [ ] Preserve fields omitted from an update.
- [ ] Allow a status-only update for quick qualification actions.
- [ ] Preserve phone normalization and duplicate-number conflict behavior.
- [ ] Enforce the notes length limit on create and update.
- [ ] Ignore or reject unknown fields rather than persisting them.
- [ ] Keep list, create, update, counts, and delete owner-scoped.
- [ ] Add tests for all supported status values.
- [ ] Add tests for invalid status and oversized notes.
- [ ] Add tests for partial and empty updates.
- [ ] Add tests for legacy unreviewed records.
- [ ] Add tests proving another user's lead cannot be read or changed.
- [ ] Add tests proving status counts do not leak another user's data.
- [ ] Add tests proving sync preserves existing status and notes.
- [ ] Run the phone-contact test suite.
- [ ] Run the API build or typecheck.

## Review Notes

```text
Status: NOT STARTED

Files changed:
- None

Implementation:
- None

Tests/checks:
- Not run

Assumptions:
- The existing `/api/phone-contacts` route remains the single lead API.
- The persisted `category` field remains the first-version lead group value.

Known limitations/blockers:
- None recorded
```

## Review Gate

Confirm the response shape, filtered counts, partial-update behavior, and
ownership tests before connecting the new UI.

---

# Phase 3 - Lead Editor and Quick Actions

## Objective

Let users create and edit the new lead fields and change qualification status
without resending unrelated values.

## Checklist

- [ ] Update the frontend Lead type with status and notes.
- [ ] Label the existing category concept as `Group` or `Lead Group`.
- [ ] Add a group field to the create/edit experience.
- [ ] Add a qualification status control to the create/edit experience.
- [ ] Add a labeled multiline notes input.
- [ ] Show the notes character limit or remaining count when useful.
- [ ] Default a newly opened create form to `UNREVIEWED`.
- [ ] Populate all stored values when editing an existing lead.
- [ ] Submit status and notes through the existing Next.js API proxy flow.
- [ ] Add a reusable quick-status action.
- [ ] Make quick-status actions send a status-only PATCH request.
- [ ] Disable repeated actions while a status update is pending.
- [ ] Refresh or update the view only after a successful response.
- [ ] Roll back any optimistic UI change after failure.
- [ ] Show clear validation and server errors.
- [ ] Preserve the existing add, edit, and delete flows.
- [ ] Verify keyboard access and dialog focus behavior.
- [ ] Add/update frontend tests where the project has an established pattern.
- [ ] Run web lint or targeted lint.
- [ ] Run the web build or typecheck.

## Review Notes

```text
Status: NOT STARTED

Files changed:
- None

Implementation:
- None

Tests/checks:
- Not run

Assumptions:
- One editable notes field is sufficient for the first version.
- One lead can belong to at most one lead group.

Known limitations/blockers:
- Notes history and multiple tags are intentionally out of scope.
```

## Review Gate

Confirm create, edit, validation, and quick-status interactions before replacing
the table with the board.

---

# Phase 4 - Qualification Board UI

## Objective

Replace the mixed lead table with a responsive review area and two-column
qualification board.

## Checklist

- [ ] Add a `Needs Review` section for `UNREVIEWED` leads.
- [ ] Show the matching unreviewed count.
- [ ] Add direct Qualified and Not Qualified actions to review cards.
- [ ] Add the Qualified column and its count.
- [ ] Add the Not Qualified column and its count.
- [ ] Fetch or paginate each status independently.
- [ ] Avoid splitting one mixed paginated response in the browser.
- [ ] Add a reusable lead card.
- [ ] Show the normalized number and `tel:` link.
- [ ] Show the lead group with an `Uncategorized` fallback.
- [ ] Show a line-clamped notes preview without modifying stored notes.
- [ ] Preserve source type and safe source links.
- [ ] Preserve useful created/last-collected timestamps.
- [ ] Include status, edit, and delete actions on each card.
- [ ] Add an all-leads empty state.
- [ ] Add an empty state for each board section.
- [ ] Add an API-unavailable state.
- [ ] Handle a partial failure when only one status request fails.
- [ ] Stack columns on narrow screens.
- [ ] Prevent page-level horizontal overflow.
- [ ] Use text labels so status is not communicated by color alone.
- [ ] Provide accessible headings and control names.
- [ ] Verify mouse, touch, and keyboard interaction.
- [ ] Run web lint or targeted lint.
- [ ] Run the web build or typecheck.

## Review Notes

```text
Status: NOT STARTED

Files changed:
- None

Implementation:
- None

Tests/checks:
- Not run

Assumptions:
- Drag and drop is not required for the first version.
- Accessible buttons remain the primary way to change status.

Known limitations/blockers:
- None recorded
```

## Review Gate

Review the board at desktop and mobile widths before final compatibility and
regression verification.

---

# Phase 5 - Filtering, Compatibility, and Final Verification

## Objective

Finish board-wide filters, confirm backward compatibility, and run complete
feature verification.

## Checklist

- [ ] Apply phone/group search consistently to all three status sections.
- [ ] Apply the group filter consistently to all three status sections.
- [ ] Add a clear/reset-filters action.
- [ ] Preserve active filters during independent pagination/load-more actions.
- [ ] Ensure displayed counts reflect the active search/group filters.
- [ ] Verify existing category values appear as lead groups.
- [ ] Verify legacy records appear under Needs Review.
- [ ] Verify adding a manual lead still works.
- [ ] Verify editing a phone number still normalizes and validates it.
- [ ] Verify duplicate phone-number handling remains intact.
- [ ] Verify deleting a lead still requires confirmation.
- [ ] Verify existing source URLs remain safe and usable.
- [ ] Verify extension sync creates an unreviewed lead.
- [ ] Verify recollection preserves existing status and notes.
- [ ] Verify no cross-user lead data or counts are exposed.
- [ ] Verify loading, empty, validation, and failure states.
- [ ] Verify responsive layout and keyboard navigation.
- [ ] Run the complete relevant API test suite.
- [ ] Run the complete relevant web test suite, if configured.
- [ ] Run API lint/build/typecheck commands.
- [ ] Run web lint/build/typecheck commands.
- [ ] Record all commands and results below.
- [ ] Update the status overview to mark every completed phase accurately.

## Review Notes

```text
Status: NOT STARTED

Files changed:
- None

Implementation:
- None

Tests/checks:
- Not run

Assumptions:
- Lead ownership remains per signed-in user in this release.

Known limitations/blockers:
- Team-shared leads, assignment, multiple tags, notes history, bulk actions,
  automated scoring, and pipeline stages are outside this feature.
```

## Review Gate

The feature is ready for acceptance only after all applicable Definition of
Done items in `feature.md` are satisfied and all test/build results are recorded.

---

## Final Verification Record

Complete this section during Phase 5.

```text
API tests:
- Not run

API build/typecheck:
- Not run

Web tests:
- Not run

Web lint:
- Not run

Web build/typecheck:
- Not run

Manual verification:
- Not run

Remaining known limitations:
- None recorded beyond the documented out-of-scope items
```
