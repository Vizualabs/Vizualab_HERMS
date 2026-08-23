---
title: Phase 6 - Payments, Invoicing and Expenses
date: 2026-08-17
tags:
  - herms
  - roadmap
  - finance
  - payments
status: draft
---

# Phase 6: Payments, Invoicing and Expenses

## Goal

Track amounts owed and paid per order and customer, and record business expenses.

## Prerequisites (Inputs from Phase 2)

- Orders with frozen line prices (invoice source of truth).

## Work Items (in order)

1. Schema: `payment`, `expense` (from [database-schema.md](../../architecture/database-schema.md)).
2. Invoice value per order from the order's own priced lines — never recomputed from current item prices (FR-8.1, I-11).
3. Payments including partials (FR-8.2).
4. Outstanding balance per customer and per order (FR-8.3); update `customer.outstanding_balance_cents` transactionally.
5. Expenses independent of orders (FR-8.4).
6. Monthly income vs expenses and net position (FR-8.5).
7. Money as integer cents everywhere (I-10); no floats.

## Schema Changes

| Table | Purpose |
|---|---|
| `payment` | FR-8.2, append-only |
| `expense` | FR-8.4 |

## API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/orders/:id/invoice` | finance, sales | Invoice from priced lines |
| POST | `/api/payments` | finance | Record payment (partial allowed) |
| GET | `/api/customers/:id/balance` | finance | Outstanding balance |
| POST | `/api/expenses` | finance | Record expense |
| GET | `/api/finance/monthly` | finance, owner | Income vs expenses, net |

## Frontend Deliverables

- Payment entry form.
- Customer/order balance view.
- Expense entry.
- Monthly income/expense view.

## Invariants Touched

- **I-10** — integer money.
- **I-11** — invoice uses frozen prices.
- **I-8** — every payment/expense audited.

## Requirements Traceability

- FR-8.1 to FR-8.5.

## Tests

- Three partial payments against one invoice leave a correct balance to the cent (I-10).
- Monthly figures match the sum of their rows (FR-8.5).
- A price escalation does not change a historical invoice value (I-11).

## Definition of Done

- Payments, balances, and expenses reconcile to the cent.
- All money is integer minor units.

## Outputs (Handoff to Phases 7–8)

- Customer/order balances (for claims) and financial data (for the dashboard).

## Delivery Priority

**Must have.**
