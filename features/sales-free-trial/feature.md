# Sales Free Trial

## Goal

Give every self-service PostFlow sales user one automatic 30-day free trial.
This feature controls product access only. It does not collect payments and does
not introduce checkout, cards, invoices, prices, or payment-provider webhooks.

## Audience

The trial applies only to an individual sales account:

```text
User.role = SALES
User.teamId = null
```

The trial does not apply to company accounts or company-managed users:

- `ADMIN`, `MANAGER`, and `TEAM_LEADER` users are exempt.
- A `SALES` user with a `teamId` is a company-managed user and is exempt.
- The existing company contact and subdomain flow is unchanged.

This distinction allows the current company workflow to keep using its roles
and teams while `sales.ipostflow.com` supports individual sales users.

## Trial Lifecycle

1. A visitor starts the free trial from the marketing website.
2. The visitor signs up through Clerk on `sales.ipostflow.com`.
3. `/api/auth/me` provisions the PostFlow user as it does today.
4. If the user is an individual sales user and has no subscription record, the
   API atomically creates one 30-day trial.
   Protected API access also performs the same atomic ensure operation as a
   fallback, so dashboard or extension requests cannot bypass provisioning.
5. Returning users reuse the original record. Signing out, signing back in, or
   changing email does not restart the trial.
6. The API calculates the effective status from server time in UTC.
7. When access expires, the user's data remains stored, but protected product
   actions are unavailable.

The trial duration is exactly 30 periods of 24 hours from the server timestamp;
it is not defined as the next calendar month.

## Subscription States

The API exposes one of these effective states:

```text
TRIALING  The original trial is still active.
ACTIVE    Access was manually extended beyond the original trial.
EXPIRED   The access end time has passed.
REVOKED   Access was explicitly revoked.
```

`status` is derived when the record is read so access expires correctly without
a scheduled job.

## Data Model

Use a separate `sales_subscriptions` collection. Do not overload
`User.status`, which continues to represent whether an administrator has
enabled or disabled a PostFlow user.

```ts
SalesSubscription {
  clerkUserId: string;        // unique; one trial per Clerk identity
  trialStartedAt: Date;
  trialEndsAt: Date;
  accessUntil: Date;          // starts equal to trialEndsAt
  revokedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

`accessUntil` leaves room for a future administrator to grant more access
without adding payment infrastructure. Manual extension UI is not part of the
first version.

## API Contract

`GET /api/auth/me` remains the provisioning entry point and adds:

```json
{
  "accountType": "INDIVIDUAL_SALES",
  "subscription": {
    "status": "TRIALING",
    "isAccessAllowed": true,
    "trialStartedAt": "2026-10-07T00:00:00.000Z",
    "trialEndsAt": "2026-11-06T00:00:00.000Z",
    "accessUntil": "2026-11-06T00:00:00.000Z",
    "daysRemaining": 30
  }
}
```

Exempt company-managed accounts return:

```json
{
  "accountType": "COMPANY_MANAGED",
  "subscription": null
}
```

The API must not trust dates or subscription state supplied by the browser.

## Access Enforcement

The backend is the source of truth.

- Active trials receive normal product access.
- Expired or revoked individual accounts receive HTTP `403` for protected
  product actions with a stable error code such as `SALES_SUBSCRIPTION_EXPIRED`.
- Authentication/profile and subscription-status reads remain available so the
  dashboard can show a useful expired state.
- The enforcement boundary applies to every API request carrying an
  `x-clerk-user-id`, including dashboard and extension routes. `/api/auth/me`
  is exempt so it can return the current subscription state.
- Internal invitation acceptance and API-key analytics routes do not carry a
  Clerk user header and keep their existing authentication behavior.
- Company-managed users remain governed by the existing role, team, and user
  status rules.
- Existing data is not deleted when access expires.
- UI checks improve the experience but never replace API enforcement.

## Dashboard Experience

During the trial, the dashboard shows a small status notice with the remaining
days and the exact expiration date.

When access expires, the dashboard shows a dedicated page that:

- Explains that the 30-day trial ended.
- Preserves sign-in and sign-out access.
- Links to PostFlow through the configured WhatsApp contact.
- Does not show payment or checkout controls.

## Existing Users

An eligible existing sales user with no subscription record receives one
30-day trial the first time they authenticate after this feature is deployed.
The unique `clerkUserId` index prevents a second trial.

The implementation must be deployed only against the intended sales database.
Building or testing the code must not connect to or migrate the existing
company database.

## Security and Reliability Requirements

- Use server time, never browser time, for access decisions.
- Create the first trial with an atomic upsert and a unique index.
- Do not expose a public endpoint that restarts or extends a trial.
- Do not accept `clerkUserId`, dates, or status in a request body.
- Return only the authenticated user's subscription information.
- Keep all comparisons and serialized timestamps in UTC.
- Cover boundary behavior around `accessUntil` with automated tests.

## Non-Goals

- Payments or payment providers.
- Credit or debit cards.
- Monthly or yearly prices.
- Checkout, invoices, refunds, or payment webhooks.
- Company subscriptions.
- Company subdomain provisioning.
- Automatic deletion after expiration.
- Administrator extension/revocation UI in the first version.

## Implementation Phases

1. Define and review the feature contract.
2. Add the backend subscription model and automatic trial provisioning.
3. Add backend access enforcement to protected sales operations.
4. Add the dashboard trial notice and expired state.
5. Verify individual, expired, returning, and company-managed scenarios.

