---
title: Phase 3 - Stock Ledger, Delivery Note and Approval Gate
date: 2026-08-17
tags:
  - herms
  - roadmap
  - stock
  - delivery
  - approval
status: draft
---

# Phase 3: Stock Ledger, Delivery Note and Approval Gate ⭐

## Goal

Implement the highest-risk, highest-value capability: an append-only stock ledger, link-based Delivery Note submission, and the Store Admin approval gate. Budget the most time here.

## Prerequisites (Inputs from Phase 2)

- Orders with frozen line prices; RBAC, audit, and token infrastructure from Phase 1.

## Work Items (in order)

1. Schema: `stock_ledger`, `delivery_note`, `delivery_note_line`, `note_token`, `discrepancy` (from [database-schema.md](../../architecture/database-schema.md)).
2. Ledger write path lives **only** in the approval service (I-1). Add a trigger rejecting `UPDATE`/`DELETE` on `stock_ledger`.
3. Delivery Note create from an order: per line `issued_qty` vs `handed_over_qty` (FR-3.1).
4. Mismatch forces a reason (`Damaged | Missing | Not Accepted | Other`, with `Other` requiring free text) (FR-3.2, BR-2) and auto-creates a `discrepancy` row (FR-3.3).
5. Tokenized link submission: unique, time-bound, scoped to one note; store hash in `note_token`; mobile pre-filled form, no login (FR-3.4, FR-11.1, FR-11.2, FR-12.2, I-9).
6. Submit → note status `pending_approval`; the token is the attribution identity (FR-12.3).
7. Approval queue per store (Store Admin + Deputy) (FR-7.1); physical-count entry with difference flagging (FR-7.2, FR-7.3).
8. Approve → atomic stock-out in the approval transaction (FR-3.5, BR-4). Reject/reopen transitions.
9. Field correction until the admin starts counting (FR-4.7, delivery side).
10. Link resend/regenerate with prior-token revocation (FR-11.5).
11. Frontend: DN create, mobile field form, admin approval queue + count screen.

## Schema Changes

| Table | Purpose |
|---|---|
| `stock_ledger` | I-1 append-only movements |
| `delivery_note` / `delivery_note_line` | FR-3.1, FR-3.2 |
| `note_token` | FR-11.1, I-9 scoped link |
| `discrepancy` | FR-3.3, FR-5.1 write path |

## API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/orders/:id/delivery-notes` | sales | Create DN |
| GET | `/api/delivery-notes/:id/link` | sales/store | Generate/return submission link |
| POST | `/api/delivery-notes/:id/resend-link` | sales/store | Revoke prior token + new one (FR-11.5) |
| GET | `/api/notes/token/:token` | token | Validate + pre-fill form |
| POST | `/api/notes/token/:token/submit` | token | Submit note (→ pending_approval) |
| GET | `/api/approvals` | store_admin | Pending queue for the store |
| POST | `/api/approvals/:noteId/count` | store_admin | Enter physical count |
| POST | `/api/approvals/:noteId/approve` | store_admin | Atomic stock posting |
| POST | `/api/approvals/:noteId/reject` | store_admin | Reject |

## Frontend Deliverables

- Delivery Note create form.
- Mobile field form opened via token (pre-filled order lines, no login).
- Store Admin pending-approval queue with physical-count entry and difference review.

## Business Rules and Invariants

- BR-2 / **I-1**: stock only via approved note; append-only ledger.
- BR-4 / **I-2**: physical count precedes approval.
- **I-8**: audit every action.
- **I-9**: scoped, expiring, logged tokens.

## Requirements Traceability

- FR-6.1, FR-6.2: stock ledger and value.
- FR-3.1 to FR-3.5: Delivery Note lifecycle.
- FR-11.1, FR-11.2, FR-11.3, FR-11.5: link submission and resend.
- FR-7.1 to FR-7.5: approval workflow.
- FR-12.2: field staff without full login.
- FR-5.1: discrepancy registry write path.

## Tests

- Invariant test #1: submitting a note leaves stock unchanged; approving changes it (I-1).
- Invariant test #2: no route other than approval inserts a ledger row (I-1).
- Invariant test #3: approval refused when no counted quantity entered (I-2).
- Invariant test #10: expired token refused; valid token scoped to its note (I-9).
- Delivery mismatch without a reason is rejected (BR-2).

## Definition of Done

- Stock is append-only; the only ledger write path is the approval transaction.
- A field user can submit a note via token without login.
- Approval requires a count; differences are flagged before approval.
- Both permanent regression guards pass.

## Outputs (Handoff to Phase 4)

- Approved delivery notes, stock ledger (out), discrepancy write path, token/link infra, and the reusable approval-gate service.

## Delivery Priority

**Must have.** This is the release-blocking data-integrity control.
