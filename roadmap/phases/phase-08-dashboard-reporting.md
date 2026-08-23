---
title: Phase 8 - Dashboard and Reporting
date: 2026-08-17
tags:
  - herms
  - roadmap
  - dashboard
  - reporting
status: draft
---

# Phase 8: Dashboard and Reporting

## Goal

Provide management visibility. Every tile now reads real, reconciled data.

## Prerequisites (Inputs from Phases 3–7)

- Approved notes, stock ledger, discrepancies, payments, claims, and price history.

## Work Items (in order)

1. Pre-aggregated rollup tables / materialized views, refreshed on approval (never a per-load ledger scan).
2. Stock quantity and value by item (FR-10.1).
3. Pending vs received payments this month, with prior-month trend (FR-10.2).
4. Monthly income vs expenses, net (FR-10.3).
5. Open missing/damaged with value, reason, responsible party, filterable by date/customer/item (FR-10.4, FR-5.2).
6. Ranked most-missing/damaged items and most-associated customers (FR-10.5, FR-5.3, FR-5.4).
7. Pending escalation confirmations (FR-10.7).
8. PDF/Excel export (FR-10.6).

## API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/dashboard/stock` | owner, finance | FR-10.1 |
| GET | `/api/dashboard/payments` | owner, finance | FR-10.2 |
| GET | `/api/dashboard/income-expenses` | owner, finance | FR-10.3 |
| GET | `/api/dashboard/discrepancies` | owner, finance | FR-10.4, FR-5.2 |
| GET | `/api/dashboard/rankings` | owner, finance | FR-10.5, FR-5.3, FR-5.4 |
| GET | `/api/dashboard/escalations` | owner | FR-10.7 |
| GET | `/api/dashboard/export` | owner, finance | FR-10.6 |

## Frontend Deliverables

- Management dashboard (stock, payments, income/expenses, discrepancies, rankings).
- Export action.

## Invariants Touched

- **I-8** — dashboard totals reconcile to audited source transactions.

## Performance Decision

The 3-second NFR (§6.1) over years of data means pre-aggregated rollups, not per-page-load scans.

## Requirements Traceability

- FR-10.1 to FR-10.7.
- FR-5.2, FR-5.3, FR-5.4.
- SRS §9.

## Tests

- Each dashboard total reconciles to its source transactions.
- Dashboard load meets the 3-second NFR with multi-year data.

## Definition of Done

- All dashboard tiles read real, reconciled data.
- Load meets the NFR; export works.

## Outputs (Handoff to Phase 9)

- Management dashboard and reporting.

## Delivery Priority

**Must have.** Export (FR-10.6) is Should Have and may follow the first release if necessary.
