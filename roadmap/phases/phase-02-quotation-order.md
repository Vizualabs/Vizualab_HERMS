---
title: Phase 2 - Quotation to Order
date: 2026-08-17
tags:
  - herms
  - roadmap
  - quotations
  - orders
status: draft
---

# Phase 2: Quotation → Order

## Goal

Implement the commercial flow: a quotation with the correct automatic price, a status machine, and conversion into an order without re-entry.

## Prerequisites (Inputs from Phase 1)

- Users/RBAC, customers, equipment items, immutable `price_history`, audit-log foundation.

## Work Items (in order)

1. Schema: `quotation`, `quotation_line`, `order`, `order_line` (from [database-schema.md](../../architecture/database-schema.md)).
2. Pricing resolver as one function (I-7): recurring → stored fixed list; new → manual per-line price. Used by every pricing path.
3. Quotation create: resolve each line's `unit_price_cents`, freeze it, compute totals (FR-2.1).
4. Quotation status machine: `Sent → Accepted | Rejected | Expired` (FR-2.3); reject invalid transitions.
5. Accept → Order: copy lines verbatim, freeze prices (FR-2.4, I-11).
6. Delivery (FR-2.2 deferred): write a `quotation_created` row to `outbox`, and expose copy-link / download-PDF. No provider call (I-12).
7. Frontend: quotation create/list/detail, order list/detail.

## Schema Changes

| Table | Purpose |
|---|---|
| `quotation` | FR-2.1, FR-2.3 |
| `quotation_line` | Frozen unit price per line (I-11) |
| `order` | FR-2.4 |
| `order_line` | Copied from quotation lines, frozen (I-11) |
| `outbox` | I-12 — quotation delivery intent; drained in Phase 5 |

## API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/quotations` | sales | Create (pricing resolver) |
| GET | `/api/quotations` | sales | List |
| GET | `/api/quotations/:id` | sales | Detail |
| POST | `/api/quotations/:id/accept` | sales | → Order (FR-2.4) |
| POST | `/api/quotations/:id/reject` | sales | Status → rejected |
| POST | `/api/quotations/:id/expire` | sales/system | Status → expired |
| GET | `/api/quotations/:id/pdf` | sales | PDF for copy-link fallback |
| GET | `/api/orders` | sales | List |
| GET | `/api/orders/:id` | sales | Detail |

## Frontend Deliverables

- Quotation create form (line items + automatic pricing for recurring).
- Quotation list + detail (status transitions).
- Order list + detail.

## Business Rules and Invariants

- BR-1 / **I-7**: one pricing resolver.
- **I-11**: freeze unit prices on lines.
- **I-12**: outbox, no direct provider call.

## Requirements Traceability

- FR-2.1: quotation generation with unit price and total.
- FR-2.2 (partial): quotation delivery, deferred to Phase 5.
- FR-2.3: quotation status.
- FR-2.4: conversion to order without re-entering lines.

## Tests

- A recurring customer's quotation prices itself with zero manual input (I-7).
- An accepted quotation produces an order with identical line items and prices (FR-2.4, I-11).
- Quotation accept writes an `outbox` row (I-12).
- Invalid status transitions are rejected (FR-2.3).

## Definition of Done

- Quotations price correctly for recurring and new customers.
- Accepting a quotation creates an order with identical lines.
- Quotation delivery is staged through `outbox` with a copy-link/PDF fallback.

## Outputs (Handoff to Phase 3)

- Orders with frozen line prices, quotation/order CRUD, outbox harness ready for Phase 5 drain.

## Delivery Priority

**Must have.**
