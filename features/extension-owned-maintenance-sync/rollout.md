# Extension-Owned Maintenance Sync — Rollout Runbook

## Current Rollout State

Repository implementation is ready for a controlled rollout. This document
does not record a production deployment. Automatic analytics remains disabled
in the production extension build until an explicit rollout approval changes
`apps/extension/.env.production`.

## Initial Safety Limits

- Pending scheduler wake: every 10 minutes.
- Analytics scheduler wake: every 15 minutes.
- Deterministic startup jitter: 0–2 minutes per extension instance.
- Maximum automatic batch: 3 items per work type.
- Maintenance execution budget: 45 seconds.
- Maintenance lease: 5 minutes.
- Processing: sequential, one Facebook navigation at a time.
- Priority: publishing, then pending approval, then analytics.
- Automatic analytics tabs: background-only, with no foreground retry.

Do not increase these limits during the initial observation period.

## Deployment Order

1. Back up the database using the normal production procedure.
2. From `apps/api`, run `npm run report-connection-ownership` against the
   production database and review every unresolved Group and publishing job.
   Report mode is read-only and prints `Mode: REPORT ONLY (no writes)`.
3. After the report is approved, run `npm run migrate-connection-ownership`,
   then rerun `npm run report-connection-ownership`. Unresolved jobs must remain
   excluded from worker queues or be explicitly assigned before proceeding.
4. Deploy the API containing strict worker ownership, atomic maintenance
   leases, result-token validation, indexes, and structured diagnostics.
5. Deploy the web application containing the durable
   `/api/jobs/:id/maintenance-request` proxy.
6. Build and distribute the production extension with automatic analytics
   still disabled. This enables strict publishing ownership, queued manual
   refresh, and conservative pending scheduling first.
7. Observe the pending-only rollout and investigate the halt conditions below.
8. After explicit approval, change `AUTOMATIC_ANALYTICS_ENABLED=true` in the
   production extension environment, rebuild, verify the generated `env.js`,
   and distribute the new extension build.

## Required Monitoring

API structured events:

- `maintenance.claim.created`
- `maintenance.claim.empty`
- `maintenance.result.accepted`
- `maintenance.ownership.rejected`
- `maintenance.lease.conflict`
- `maintenance.lease.expired`

Review the events by `workType`, `connectionId`, masked extension instance ID,
and result status. Never add claim tokens, cookies, Facebook DOM, or post
content to operational logs.

For an individual Chrome profile, inspect the persisted extension counters:

```js
chrome.storage.local.get('maintenanceDiagnosticsV1').then(console.log)
```

Track at minimum:

- Claim requests, claims created, and empty claims by work type.
- Accepted successes and failures by work type.
- Ownership rejections.
- Lease conflicts and expirations.
- API latency/error rate for job claim and result endpoints.
- Facebook navigation and render failures.
- Whether publishing waits behind maintenance work.

## Halt Conditions

Stop the rollout and disable automatic analytics if any of these occur:

- A profile opens or updates a job assigned to another connection.
- A missing, unknown, or unverified instance receives worker job data.
- The same maintenance job is processed concurrently.
- Scheduled analytics activates a foreground tab.
- Publishing is delayed behind a maintenance batch.
- Lease conflicts or expirations repeatedly affect healthy active profiles.
- API or Facebook-navigation failure rates materially increase from the
  pre-rollout baseline.

## Rollback

To stop automatic analytics, set `AUTOMATIC_ANALYTICS_ENABLED=false`, rebuild
the production extension, and distribute/reload it. Startup clears the
analytics alarm. Publishing, pending approval, and queued manual refresh remain
available.

If pending scheduling must also be stopped, do not remove ownership checks or
claim-token validation. Ship a dedicated pending-scheduler flag or extension
change. Existing leases expire after five minutes, so no database rollback is
required for abandoned claims.

## Completion Evidence

Record the following in `progress.md` after an actual rollout:

- Deployment date and extension version.
- Migration report and unresolved-record decision.
- Initial observation duration.
- Claim, empty-claim, failure, ownership, and lease results.
- Confirmation that publishing priority and background-only analytics remain
  correct.
- Any rollback or limit change, including who approved it.
