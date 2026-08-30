# Phase 9 implementation and validation

Phase 9 hardening is implemented without database-resident backups or snapshots. That feature is intentionally excluded because the project is using limited Neon free-tier storage. Reorder alerts retain only one small row per low-stock episode and resolve that row when stock recovers.

## Implemented

- Configurable equipment reorder thresholds, automatic open/resolve handling, deduplicated outbox notifications, and Store Admin/deputy WhatsApp recipients.
- Authenticated printable Delivery Note and Retention Note PDFs based on the SRS field lists. The generator is isolated in `apps/api/src/note-pdf.ts` so the layout can be adjusted when the client's physical form samples are supplied.
- Audit completeness verification for notes, stock ledger entries, discrepancies, finance records, claims, and reorder alerts.
- A read-only concurrent dashboard load runner with a hard p95 limit of three seconds.
- Structured request SLO fields, a `Server-Timing` response header, CloudWatch availability metrics, a 99.5 percent availability alarm, and a dashboard p95 latency alarm.

## Pre-deployment checks

Run these after migration `0009_phase_9_hardening.sql` has been applied to the target environment:

```powershell
bun --env-file=.env run verify:phase9:audit
bun run typecheck
bun run test
bun run db:check
bun run build
```

The database audit verifier is read-only.

## Dashboard load validation

Run against a deployed staging URL with a Business Owner or Finance account. The test sends only authenticated GET requests.

```powershell
$env:PHASE9_BASE_URL = 'https://staging.example.com'
$env:PHASE9_EMAIL = 'owner@example.com'
$env:PHASE9_PASSWORD = '<secret>'
$env:PHASE9_LOAD_REQUESTS = '120'
$env:PHASE9_LOAD_CONCURRENCY = '10'
bun run load:phase9
```

Pass criteria: no non-2xx responses and dashboard p95 below 3000 ms. Do not commit credentials or a session cookie.

## Mobile form validation

The two-minute NFR includes human reading, counting, and typing time, so it must be timed with representative users rather than inferred from an HTTP benchmark.

1. Open a fresh DN link on a common 360-430 px-wide phone using a normal mobile connection.
2. Start the timer when the form becomes visible.
3. Complete every line, enter a discrepancy reason when required, review, and submit.
4. Stop when the success confirmation appears. Repeat with an RN containing a missing/damaged item.
5. Record at least five runs of each form. Pass only when every trained-user run is under two minutes and no submission fails.

## Deferred until deployment

- Run the load and mobile timing validations against staging, then production at a safe request volume.
- Connect `AlarmTopicArn` to the operational SNS destination and confirm alarm delivery.
- Compare DN/RN PDFs with the client's actual paper forms and adjust presentation-only coordinates if samples differ.
- Database backup/restore rehearsal remains intentionally excluded under the current storage constraint.
