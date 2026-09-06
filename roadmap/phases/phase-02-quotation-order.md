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
2. Pricing resolver as one function (I-7): standard → customer exception or equipment price fallback; custom → explicit price on each selected line.
3. Quotation create: resolve each line's `unit_price_cents`, freeze it, compute totals (FR-2.1).
4. Quotation status machine: `Sent → Accepted | Rejected | Expired` (FR-2.3); reject invalid transitions.
5. Customer link response: signed, hashed-at-rest, expiring link permits accept/reject without a login; token paths are redacted from logs.
6. Accepted → Order: an authenticated Sales action copies lines verbatim and cannot create a duplicate order (FR-2.4, I-11).
7. Delivery: preserve the `quotation_created` outbox history and expose manual copy-link, WhatsApp Web, and download-PDF actions. No provider call.
8. Frontend: quotation create/list/detail, public customer response, order list/detail.

## Schema Changes

| Table | Purpose |
|---|---|
| `quotation` | FR-2.1, FR-2.3, including `pricing_mode` |
| `quotation_line` | Frozen unit price per line (I-11) |
| `order` | FR-2.4 |
| `order_line` | Copied from quotation lines, frozen (I-11) |
| `outbox` | I-12 — quotation delivery intent; drained in Phase 5 |
| `note_token` | Reused for hashed, expiring quotation links; no new token table |

## API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/quotations` | sales | Create (pricing resolver) |
| GET | `/api/quotations` | sales | List |
| GET | `/api/quotations/:id` | sales | Detail |
| GET | `/api/quotations/:id/share-link` | sales | Retrieve the same unexpired customer link |
| GET | `/api/public/quotations/:token` | public token | Safe customer detail |
| POST | `/api/public/quotations/:token/accept` | public token | Status → accepted |
| POST | `/api/public/quotations/:token/reject` | public token | Status → rejected and revoke link |
| POST | `/api/quotations/:id/order` | sales | Accepted quotation → Order (FR-2.4) |
| POST | `/api/quotations/:id/reject` | sales | Status → rejected |
| POST | `/api/quotations/:id/expire` | sales/system | Status → expired |
| GET | `/api/quotations/:id/pdf` | sales | PDF for copy-link fallback |
| GET | `/api/orders` | sales | List |
| GET | `/api/orders/:id` | sales | Detail |

## Frontend Deliverables

- Quotation create form with Standard and Custom pricing; custom editing is limited to selected lines.
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

- Standard mode uses customer price exceptions and falls back to registered equipment prices with zero manual input (I-7).
- Custom mode starts from standard prices and permits selected-line overrides.
- Customer acceptance and Sales order conversion are separate transitions; expired/rejected links cannot be used.
- An accepted quotation produces an order with identical line items and prices (FR-2.4, I-11).
- Quotation creation writes its traceable `outbox` history row (I-12).
- Invalid status transitions are rejected (FR-2.3).

## Definition of Done

- Quotations price correctly in Standard and Custom modes.
- Converting an accepted quotation creates one order with identical frozen lines.
- Quotation delivery is manual through a secure copy link, WhatsApp Web, or PDF download.

## Outputs (Handoff to Phase 3)

- Orders with frozen line prices, quotation/order CRUD, outbox harness ready for Phase 5 drain.

## Delivery Priority

**Must have.**
