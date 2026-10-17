# Observability Runbook

## Signals

- Errors: `captureException` emits scrubbed JSON with `event=exception` and forwards to `OBSERVABILITY_INGEST_URL` or `NEXT_PUBLIC_OBSERVABILITY_INGEST_URL` when configured.
- Logs: API routes include `x-request-id`; production JSON logs should be shipped from stdout/stderr to the hosting log drain.
- Metrics: `recordMetric` emits JSON metric events for `issuance.success`, `issuance.failure`, `verification.attempt`, `ipfs.pin_file.latency_ms`, `ipfs.pin_file.error`, `ipfs.pin_json.latency_ms`, and `ipfs.pin_json.error`.

## Dashboards

- Issuance volume: count `issuance.success` and `issuance.failure` by hour.
- Verification volume: count `verification.attempt` grouped by `context.resultType`.
- IPFS health: p95 `ipfs.pin_file.latency_ms` / `ipfs.pin_json.latency_ms` and error counts by status.
- API errors: count `event=exception` grouped by `context.context` and `context.requestId`.

## Alerts

- Page on-call if `event=exception` is greater than 5 events in 5 minutes.
- Page on-call if any public API uptime check fails 3 times in a row.
- Page on-call if IPFS error metrics are greater than 3 in 10 minutes or p95 latency is above 10 seconds for 10 minutes.
- Warn during business hours if `issuance.failure / (issuance.success + issuance.failure)` is above 10% for 15 minutes.
- Page on-call if `message="Data retention is not being enforced"` appears. This means the published privacy policy has stopped being true — see [Data retention](#data-retention).

## Triage

1. Find the alert's `requestId`, route context, and deployment version in the log aggregator.
2. Check whether failures are isolated to Supabase, Stellar RPC, or Pinata/IPFS.
3. For verification failures, compare `verification.attempt` result types against `/api/admin/stats`.
4. If RPC/IPFS is degraded, switch traffic to a known-good provider endpoint and redeploy.
5. After mitigation, leave an incident note with root cause, customer impact, and follow-up tasks.

Severity, escalation, the emergency contract levers (including when to `pause`),
user communication and post-incident reviews are defined in the
[incident-response plan](./incident-response.md).

## Data retention

The nightly purge enforces the retention periods published at `/legal/privacy`
(see [decisions/0002](../decisions/0002-data-retention.md)). It runs at 03:00 UTC
via `GET /api/cron/retention` (scheduled in `frontend/vercel.json`) and, where
the extension exists, via pg_cron — both call `public.run_retention_purge()`.

**How it can break**

| Symptom | Cause | Fix |
| --- | --- | --- |
| Admin panel: "No retention purge has succeeded in over 48 hours" | `CRON_SECRET` unset, so the route returns 503 | Set `CRON_SECRET` in the Vercel project and redeploy |
| Cron invocations return 401 | `CRON_SECRET` changed without a redeploy | Redeploy so the running function picks up the new value |
| Purge runs but rows stay overdue | The migration has not been applied | Run `supabase/schema.sql`, then `SELECT public.run_retention_purge();` |
| `lastFailure` is populated | The DELETE itself failed (lock contention, disk) | Read `error` in `public.maintenance_runs`, then re-run manually |

**Checks**

```sql
-- Current state, as the admin console sees it.
SELECT public.retention_status();

-- Must be 0 on a compliant deployment.
SELECT COUNT(*) FROM public.verification_logs
WHERE created_at < NOW() - INTERVAL '90 days';

SELECT COUNT(*) FROM public.contact_messages
WHERE COALESCE(handled_at, created_at) < NOW() - INTERVAL '24 months';

-- Run history.
SELECT started_at, status, rows_deleted, duration_ms, detail, error
FROM public.maintenance_runs
WHERE job = 'retention'
ORDER BY started_at DESC
LIMIT 20;
```

**Manual run** (service_role, e.g. the Supabase SQL editor):

```sql
SELECT public.run_retention_purge();
```

It is idempotent and records itself like any scheduled run.

## Smoke Test

1. Configure the ingest endpoint in production secrets.
2. Trigger a controlled server error in a non-production deployment.
3. Confirm the exception appears in the tracker within seconds with scrubbed context and a request ID.
4. Run one credential verification and confirm dashboard volume increments.
