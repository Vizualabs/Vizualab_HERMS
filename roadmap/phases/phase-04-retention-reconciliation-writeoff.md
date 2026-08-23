---
title: Phase 4 - Retention Note, Reconciliation and Write-off
date: 2026-08-17
tags:
  - herms
  - roadmap
  - retention
  - reconciliation
  - stock
status: draft
---

# Phase 4: Retention Note, Reconciliation and Write-off

## Goal

Digitize returns, enforce cumulative reconciliation, and write off confirmed missing or damaged stock.

## Prerequisites (Inputs from Phase 3)

- Approved delivery notes, stock ledger (out), discrepancy registry, token/link infra, approval-gate service.

## Work Items (in order)

1. Schema: `retention_note`, `retention_note_line` (from [database-schema.md](../../architecture/database-schema.md)).
2. Retention Note create from an order: per line `returned_qty`, `balance_qty`, `missing_damaged_qty` (FR-4.1).
3. Partial retention notes over time (FR-4.6); reuse the Phase 3 token link and approval gate (FR-4.5).
4. Shortfall requires type + responsible party `Customer | Staff Member` (FR-4.3, BR-3) — this feeds Phase 7 claims.
5. Cumulative reconciliation across all retention notes, enforced when the order is marked `Fully Returned` (FR-4.2, I-6).
6. Approve → stock-in returned quantity; write off confirmed missing/damaged (FR-6.3).
7. Reversal window (FR-6.5): Store Admin reverses a write-off within 7 days with a reason; System Admin override beyond. Reversals are new ledger/audit rows, never edits (I-1, I-8).
8. Discrepancy resolution states: `Resolved | Written Off | Claimed` (FR-5.5).
9. Frontend: RN create, return mobile form, admin count screen, order-close action.

## Schema Changes

| Table | Purpose |
|---|---|
| `retention_note` / `retention_note_line` | FR-4.1, FR-4.3 |

## API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/orders/:id/retention-notes` | sales | Create RN |
| GET/POST | `/api/notes/token/:token` (reused) | token | Pre-fill + submit return |
| POST | `/api/approvals/:noteId/count` (reused) | store_admin | Return count entry |
| POST | `/api/approvals/:noteId/approve` (reused) | store_admin | Stock-in + write-off (branches by note type) |
| POST | `/api/orders/:id/close` | store_admin | Enforce cumulative reconciliation (I-6) |
| POST | `/api/discrepancies/:id/write-off-reverse` | store_admin/system | Reverse within window (FR-6.5) |

## Reconciliation Invariant

```
Σ returned + Σ balance + Σ missing_damaged = delivered
```

Getting this wrong makes partial returns impossible. Enforce it cumulatively at order close, not per note.

## Business Rules and Invariants

- BR-3 / **I-6**: cumulative reconciliation at close.
- **I-1**: stock-in/write-off only via approval.
- **I-2**: physical count precedes approval.
- **I-8**: reversals are new audit rows.

## Requirements Traceability

- FR-4.1 to FR-4.7: Retention Note lifecycle and correction.
- FR-6.3, FR-6.5: write-off and reversal.
- FR-5.5: discrepancy resolution statuses.
- BR-3 and BR-5.

## Tests

- Invariant test #8: order delivered 100 / returned 60 + 30 / missing 8 / damaged 2 reconciles and closes; 99 accounted-for refuses to close (I-6).
- Write-off reversal within the window restores stock as new ledger rows (FR-6.5).

## Definition of Done

- Partial returns work; reconciliation is enforced only at close.
- Returned quantity increases stock; confirmed missing/damaged is written off — both only via approval.
- Reversals are time-bound, permission-controlled, and fully audited.

## Outputs (Handoff to Phases 5–7)

- Closed orders, discrepancies with responsible party (for Phase 7 claims), reversible write-offs, complete stock ledger.

## Delivery Priority

**Must have.**
