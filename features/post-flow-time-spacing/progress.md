# Post Flow — Time Spacing Progress

## Feature

**Minimum time spacing between posts in Post Flow**

Status: `In Progress`

---

## Requirements

- [x] Define the feature behavior.
- [x] Define basic scheduling formula.
- [x] Define minimum spacing concept.
- [x] Support values such as 2 and 3 minutes.
- [x] Define schedule preview behavior.
- [ ] Confirm final preset spacing options.
- [ ] Confirm whether custom spacing input is required.
- [ ] Confirm maximum allowed spacing.

---

## Frontend

- [ ] Add `Space posts apart` toggle to Post Flow.
- [ ] Add spacing selector/input.
- [ ] Add 2-minute option.
- [ ] Add 3-minute option.
- [ ] Add validation message for invalid spacing.
- [ ] Calculate preview times on the client.
- [ ] Show scheduled time beside each post.
- [ ] Recalculate preview when start time changes.
- [ ] Recalculate preview when spacing changes.
- [ ] Recalculate preview when posts are reordered.
- [ ] Recalculate preview when a post is removed.
- [ ] Disable/hide spacing input when spacing is turned off.
- [ ] Add loading/error states for save action.

### Suggested frontend state

```ts
const [spacePostsApart, setSpacePostsApart] = useState(false);
const [spacingMinutes, setSpacingMinutes] = useState(3);
```

---

## Backend

- [x] Add `spacePostsApart` to Post Flow request/schema.
- [x] Add `spacingMinutes` to Post Flow request/schema.
- [x] Validate minimum spacing.
- [x] Validate maximum spacing if required.
- [x] Sort posts using their Post Flow order.
- [x] Calculate `scheduledAt` for every post.
- [x] Save final `scheduledAt` values.
- [ ] Prevent changes to already-published posts.
- [ ] Recalculate future posts when the flow is edited.
- [x] Return calculated schedule to the frontend.
- [ ] Handle timezone conversion correctly.

### Completed groundwork

- [x] Implement reusable schedule calculation utility with backend validation.
- [x] Add unit coverage for 2-minute and 3-minute spacing, ordering, disabled spacing, single-post flows, invalid values, maximum spacing, and invalid dates.
- [x] Persist optional Post Flow scheduling configuration and per-job `scheduledFor` timestamps.
- [x] Return scheduled job times from the create-post API.
- [x] Prevent the extension from receiving scheduled jobs before they are due.
- [x] Add start-time, spacing toggle, preset selector, and schedule preview controls to the create-post form.

### Core formula

```ts
scheduledAt = startTime + index * spacingMinutes * 60 * 1000;
```

---

## Database

- [ ] Decide whether spacing configuration belongs on `PostFlow`.
- [ ] Add `spacingMinutes` field if required.
- [ ] Add `spacePostsApart` field if required.
- [ ] Ensure every scheduled post has `scheduledAt`.
- [ ] Ensure post ordering is persisted.
- [x] Add schema fields for existing MongoDB documents (migration not required).
- [ ] Test migration against existing Post Flows.

Suggested fields:

```text
PostFlow
- spacePostsApart Boolean
- spacingMinutes   Int?

Post
- order            Int
- scheduledAt      DateTime?
```

---

## API

- [x] Update create Post Flow endpoint.
- [ ] Update edit Post Flow endpoint.
- [x] Update validation schema.
- [x] Return post schedule preview/result.
- [ ] Document request/response changes.

---

## Tests

### Unit Tests

- [x] 3 posts + 2-minute spacing.
- [x] 3 posts + 3-minute spacing.
- [x] One post only.
- [x] Reject 0-minute spacing.
- [x] Reject negative spacing.
- [x] Verify post ordering.
- [x] Verify UTC timestamps.

### Integration Tests

- [ ] Create a new spaced Post Flow.
- [ ] Edit spacing before publishing starts.
- [ ] Change post order.
- [ ] Remove a post.
- [ ] Add another post.
- [ ] Edit a partially completed flow.
- [ ] Verify published posts remain unchanged.

### UI Tests

- [ ] Toggle spacing on/off.
- [ ] Change from 2 to 3 minutes.
- [ ] Verify preview updates immediately.
- [ ] Verify correct time after drag-and-drop reorder.
- [ ] Verify validation messages.

---

## Suggested Implementation Order

1. [x] Add/update database fields.
2. [x] Add backend validation.
3. [x] Implement scheduling utility function.
4. [x] Update create Post Flow API.
5. [x] Update edit Post Flow API.
6. [x] Add frontend spacing controls.
7. [x] Add live schedule preview and schedule editor.
8. [ ] Handle reorder/remove behavior.
9. [x] Add automated tests.
10. [ ] QA edge cases and time zones.

---

## Definition of Done

The feature is complete when a user can select a minimum interval such as **2 or 3 minutes**, create multiple posts in one Post Flow, preview their calculated schedule, save the flow, and have every post published according to that spacing without changing already-published posts.
