---
title: HERMS Invariants
date: 2026-08-17
tags:
  - herms
  - invariants
  - business-rules
  - agentic-workflow
status: draft
---

# HERMS — Invariants

Rules that hold in **every** phase. An agent may not weaken one to make a task pass. If a task appears to require breaking one, stop and raise it.

Each invariant names its SRS source so it can be re-argued with the client rather than quietly dropped in code.

---

## I-1 · Stock moves only through an approved note

**Source:** BR-4, FR-3.5, FR-4.5, FR-6.1, NFR §6.3

The stock ledger is append-only. Every row cites the ID of an **approved** delivery note or retention note. There is exactly one code path that inserts ledger rows, and it runs inside the store-admin approval transaction.

Forbidden: an admin "adjust stock" screen, a seed script that writes to the ledger outside this path, a migration that back-fills quantities, an `UPDATE items SET qty = ...` anywhere.

Permitted: an opening-balance note, itself created and approved through the normal gate.

## I-2 · Physical count precedes approval

**Source:** FR-7.2, FR-7.3, FR-7.4

Approval requires a store-admin-entered counted quantity. Where the count differs from the submitted figure, the difference is flagged for review **before** approval can complete. There is no bulk-approve, no approve-without-count, and no auto-approve on a timer.

## I-3 · Price history is immutable

**Source:** FR-9.7, FR-1.5

Rows in `price_history` are never updated or deleted. Corrections are new offsetting rows. Enforce with a database trigger, not a code review habit.

The escalation job (FR-9.3) and point-in-time claim pricing (FR-9.5) both assume history is a truthful record of the past. An in-place edit silently corrupts every claim ever priced.

## I-4 · Damage claims price at the date of damage

**Source:** FR-9.5, BR-6

Claim amount is looked up from `price_history` as at the date the damage was **recorded** — not the current price, not the price at claim time, not the price at invoice time.

Any use of `item.current_price` in claim calculation is a bug.

## I-5 · A claim needs a customer-responsible discrepancy and finance sign-off

**Source:** BR-5, FR-9.1, FR-9.6, FR-9.2

Two gates, in order:

1. The discrepancy's responsible party is `Customer`. Staff-responsible discrepancies are never billable.
2. A Finance/Accounts user reviews and confirms the claim before it reaches the customer's outstanding balance or the pending-payments figure.

## I-6 · Returns reconcile cumulatively, enforced at close

**Source:** FR-4.2, FR-4.6, BR-3

For each item on an order:

```
Σ returned + Σ balance + Σ missing_damaged  =  delivered
```

summed across **all** retention notes for that order. Enforced when the order is marked `Fully Returned` — **not** on each individual partial note, which would make partial returns impossible.

## I-7 · Pricing model is resolved by one function

**Source:** BR-1, FR-1.2, FR-1.3

`Recurring` → the customer's stored fixed price list. `New` → the price entered on that quotation. One resolver function, called from quotation, order, invoice and claim paths. No second implementation, no inline `if customer.type ===` scattered through routes.

## I-8 · Every stock, price, discrepancy and payment change is attributable

**Source:** FR-12.3, FR-7.5, NFR §6.2, §6.6

Each such change writes an audit row: actor (authenticated user **or** verified link token), action, entity, before/after values, timestamp. Audit rows are append-only. Reversals and corrections are new rows, never edits — this is how FR-6.5 write-off reversals are recorded.

## I-9 · Note links are scoped, expiring, and logged

**Source:** FR-11.1, FR-12.2, NFR §4.4, §6.2

A link token grants access to exactly one note and expires. It exposes no data beyond that order. Expiry is checked at read time. Every use is logged. Tokens never appear in a URL query string (they land in access logs) — use a path segment or POST body.

## I-10 · Money is integer minor units

**Source:** engineering, protecting FR-8.x and §6.6

All monetary values are integers in cents. No floats, no `number` arithmetic on currency. Rounding rules are declared once, in one place.

## I-11 · Order documents freeze their prices

**Source:** FR-8.1, FR-9.5

A quotation, order or invoice stores the unit price used at the time it was created. A price escalation six months later must not retroactively change a historical invoice's value. Never join to `items.current_price` when rendering a past document.

## I-12 · Outbox before provider

**Source:** SRS §4.3, FR-2.2, FR-11.4 · engineering

Notification intent is written to the `outbox` table in the same transaction as the business change. A separate publisher moves it to SQS. Nothing in the request path calls WhatsApp, SMS or email directly.

Consumers are idempotent — SQS is at-least-once, and a customer must never receive the same quotation twice.

---

## Priority discipline

The SRS uses MoSCoW. `M` ships in its phase. `S` ships in its phase unless explicitly deferred with the client. `C` waits for Phase 9.

Two exceptions where the SRS's own priority understates the dependency:

- **FR-4.6** (multiple partial retention notes) is marked `S` but must ship with Phase 4 — it defines the reconciliation model in I-6.
- **FR-1.5 / FR-9.7** (price history + immutability) must exist from Phase 1, well before the Phase 7 features that consume them.

---

## Tests That Must Exist

Regression guards for the invariants, not coverage theatre. These tests must never be deleted; if a change breaks one, the change is wrong — not the test.

1. Submitting a note leaves stock **unchanged**; approving it changes stock (I-1).
2. No route other than approval can insert a stock-ledger row (I-1).
3. Approval is refused when no counted quantity was entered (I-2).
4. `UPDATE` on `price_history` is rejected by the database (I-3).
5. Damage recorded before an escalation date bills at the **pre-escalation** price after escalation has run (I-4).
6. A staff-responsible discrepancy cannot be raised as a claim (I-5).
7. A claim does not appear in the customer balance until Finance confirms (I-5).
8. Order delivered 100 / returned 60 + 30 / missing 8 / damaged 2 reconciles and closes; the same order with 99 accounted for refuses to close (I-6).
9. Running the escalation job twice in one day produces one price-history row per item (Phase 7 idempotency).
10. An expired link token is refused; a valid token grants access to its own note only (I-9).
