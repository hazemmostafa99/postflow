# Sales Free Trial - Progress

## Source Document

- `features/sales-free-trial/feature.md`

## Phase 1 - Feature Definition

- [x] Define individual-sales eligibility.
- [x] Define company-user exemption.
- [x] Define the 30-day lifecycle and effective statuses.
- [x] Define the no-payment boundary.
- [x] Define API, dashboard, security, and rollout behavior.

Status: Complete

## Phase 2 - Backend Trial Provisioning

- [x] Add the sales subscription schema and unique identity index.
- [x] Add atomic one-time trial provisioning.
- [x] Add server-derived subscription summaries.
- [x] Include the subscription in `/api/auth/me`.
- [x] Keep company-managed users exempt.
- [x] Add focused lifecycle tests.
- [x] Run API tests and build.

Status: Complete

Review notes:

```text
Files changed:
- apps/api/src/schemas/sales-subscription.schema.ts
- apps/api/src/sales-subscriptions/sales-subscription-policy.ts
- apps/api/src/sales-subscriptions/sales-subscription-policy.spec.ts
- apps/api/src/sales-subscriptions/sales-subscriptions.service.ts
- apps/api/src/sales-subscriptions/sales-subscriptions.module.ts
- apps/api/src/auth/auth.controller.ts
- apps/api/src/auth/auth.module.ts
- features/sales-free-trial/feature.md
- features/sales-free-trial/progress.md

Implementation:
- Added the dedicated sales_subscriptions collection with a unique Clerk user
  identity index.
- Added an atomic $setOnInsert upsert that grants exactly 30 periods of 24
  hours and reuses the original record on later sign-ins.
- Added server-derived TRIALING, ACTIVE, EXPIRED, and REVOKED summaries.
- Added accountType and subscription to /api/auth/me.
- Limited automatic provisioning to SALES users without a teamId.
- Company-managed roles and SALES users assigned to a team return no
  subscription and keep their existing behavior.
- Added no payment packages, fields, routes, or configuration.

Checks:
- Focused policy tests passed: 5 tests.
- API build passed.
- ESLint passed for the new subscription and changed auth files.

Rollout limitation:
- No database process was started and no database was migrated during this
  phase. Before runtime verification, DATABASE_URL must point to the intended
  sales database rather than the existing company database.
- Backend enforcement and dashboard UI belong to the next phases.
```

## Phase 3 - Backend Access Enforcement

- [x] Define the protected-operation enforcement boundary.
- [x] Reject expired/revoked individual users with a stable API error.
- [x] Keep auth/status access available.
- [x] Ensure extension operations cannot bypass expiration.
- [x] Add focused access tests.

Status: Complete

Review notes:

```text
Files changed:
- apps/api/src/app.module.ts
- apps/api/src/sales-subscriptions/sales-subscription-access.guard.ts
- apps/api/src/sales-subscriptions/sales-subscription-policy.ts
- apps/api/src/sales-subscriptions/sales-subscription-policy.spec.ts
- apps/api/src/sales-subscriptions/sales-subscriptions.module.ts
- features/sales-free-trial/feature.md
- features/sales-free-trial/progress.md

Enforcement boundary:
- A global Nest guard checks API requests that carry x-clerk-user-id.
- /api/auth/me stays available for provisioning and status responses.
- Individual SALES users without a team must have TRIALING or ACTIVE access.
- Company-managed roles and SALES users with a team bypass this individual
  subscription rule and keep their existing authorization behavior.
- Dashboard, groups, posts, leads, connections, and extension job routes all
  pass through the same guard.
- Analytics API-key requests and the trusted invitation acceptance bridge do
  not carry a Clerk user header and retain their current authentication.

Errors:
- Expired access returns HTTP 403 with SALES_SUBSCRIPTION_EXPIRED.
- Revoked access returns HTTP 403 with SALES_SUBSCRIPTION_REVOKED.
- The response includes the server-derived subscription summary for the
  dashboard's next-phase expired state.

Checks:
- Focused policy tests passed: 8 tests.
- API build passed.
- ESLint passed for all subscription files and changed module/auth files.

Limitations:
- No database process was started and no existing database was modified.
- Browser/dashboard handling of the 403 response belongs to Phase 4.
```

## Phase 4 - Dashboard Experience

- [x] Show trial status and remaining days.
- [x] Add the dedicated expired-trial state.
- [x] Link expired users to the configured WhatsApp contact.
- [x] Add loading and API-failure behavior.
- [x] Verify English UI copy.

Status: Complete

Review notes:

```text
Files changed:
- apps/web/src/lib/postflow-user.ts
- apps/web/src/components/trial-status-banner.tsx
- apps/web/src/app/(dashboard)/layout.tsx
- apps/web/src/app/trial-expired/page.tsx
- apps/web/src/app/trial-expired/loading.tsx
- apps/web/.env.example
- apps/web/.env.production.example
- apps/web/README.md
- README.md
- features/sales-free-trial/progress.md

Active trial experience:
- The dashboard reads the server-derived subscription returned by /api/auth/me.
- TRIALING users see a compact notice with the exact UTC expiration date and
  remaining whole days.
- ACTIVE manually extended users and company-managed users do not see the
  trial notice.

Expired/revoked experience:
- Individual users without access are redirected before dashboard content is
  rendered.
- /trial-expired explains the status, confirms that existing account data is
  retained, and provides WhatsApp contact and sign-out actions.
- The page contains no price, card, checkout, or payment controls.
- Users whose access is active and company-managed users cannot remain on the
  expired page; they are redirected back to the dashboard.

Failure/loading behavior:
- Auth API network and non-success responses fail closed to /access-denied.
- Missing subscription data for an individual account also fails closed.
- The expired route includes a loading skeleton.
- The WhatsApp number is configured through NEXT_PUBLIC_WHATSAPP_NUMBER.

Checks:
- Web production build passed and includes /trial-expired.
- Web lint passed with 0 errors and 3 pre-existing warnings.
- English UI copy was reviewed for trial, expiration, revocation, data
  retention, no-payment messaging, contact, and sign-out states.

Limitations:
- No browser session or database-backed runtime test was performed because the
  existing database must not be used for this sales rollout.
```

## Phase 5 - Final Verification

- [x] Verify a new individual user receives exactly one trial.
- [x] Verify returning users do not restart the trial.
- [x] Verify the expiration boundary.
- [x] Verify company-managed users are exempt.
- [x] Verify expired users retain their stored data.
- [x] Verify no payment code or configuration was introduced.
- [x] Confirm deployment targets the intended sales database.

Status: Complete

Review notes:

```text
Automated verification:
- Added service tests for first-trial creation, returning-user date reuse, and
  duplicate-key concurrency recovery.
- The provisioning upsert uses $setOnInsert, so an existing record's original
  trialStartedAt, trialEndsAt, and accessUntil are not reset.
- Policy tests cover the exact expiration boundary, revocation, manually
  extended access, individual eligibility, company exemption, auth exemption,
  extension protection, and stable access error codes.
- Focused subscription suites passed: 11 tests across 2 suites.

Data and scope audit:
- Subscription enforcement reads user/subscription state and throws access
  errors; it contains no record deletion or database-drop behavior.
- Expiration therefore preserves existing posts, contacts, groups, jobs, and
  account data.
- Source and package audit found no Stripe, Paddle, Paymob, checkout, invoice,
  card, or payment-provider implementation.
- Current Git branch is sales.
- The configured DATABASE_URL is present, non-local, and contains an explicit
  sales identifier. Its secret value was not printed.

Build and lint checks:
- API production build passed.
- API subscription/auth lint passed with no errors.
- Web production build passed and contains /trial-expired.
- Web lint passed with no errors and 3 unrelated existing warnings.
- git diff --check passed.

Runtime safety:
- Verification did not connect to the database, create users, or mutate data.
- A live Clerk signup/expiration smoke test should be performed after deploying
  the API and dashboard with the confirmed sales database configuration.
```

## Progress Summary

| Phase | Status |
| --- | --- |
| 1. Feature definition | Complete |
| 2. Backend trial provisioning | Complete |
| 3. Backend access enforcement | Complete |
| 4. Dashboard experience | Complete |
| 5. Final verification | Complete |

## Implementation Workflow

1. Read `feature.md` and this file.
2. Work on the first incomplete phase.
3. Keep company-managed users and payment behavior out of scope.
4. Update this file with changed files, checks, assumptions, and limitations.
5. Stop at each reviewable phase boundary.

