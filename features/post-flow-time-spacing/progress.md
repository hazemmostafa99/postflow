# Automatic Destination Spacing — Implementation Progress

## Completed

- [x] Apply automatic spacing to both `Now` and `Schedule` creation modes.
- [x] Use independently randomized 30–120-second gaps.
- [x] Keep the first destination at the requested start time.
- [x] Persist every generated timestamp on its publishing job.
- [x] Remove the create-form spacing checkbox and fixed-minute selector.
- [x] Remove manual spacing controls from the post schedule editor.
- [x] Regenerate spacing only for pending jobs when rescheduling.
- [x] Keep running and completed jobs unchanged.
- [x] Store the active spacing bounds on new or rescheduled posts.
- [x] Add deterministic tests for ordering, cumulative delays, inclusive bounds,
  immediate publishing, scheduled publishing, and pending-job rescheduling.
- [x] Verify API and web production builds.

## Verification

- `post-flow-time-spacing.spec.ts`: passing
- `posts.service.spec.ts`: passing
- API production build: passing
- Web production build: passing
- Web lint: no errors; existing unrelated warnings remain
