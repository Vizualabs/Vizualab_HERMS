---
title: Phase 7 - Damage Claims and Price Escalation
date: 2026-08-17
tags:
  - herms
  - roadmap
  - claims
  - escalation
status: draft
---

# Phase 7: Damage Claims and Price Escalation

## Goal

Implement customer damage claims and the automatic six-month price escalation.

## Why Last of the Business Logic

Claims need Phase 4's responsible party and Phase 6's balances. Nothing else depends on claims, so this phase has no downstream pressure.

## Prerequisites (Inputs from Phases 4, 6, 1)

- Discrepancies with a `responsible_party` (Phase 4).
- Customer balances (Phase 6).
- Immutable `price_history` (Phase 1).

## Work Items (in order)

1. Schema: `damage_claim` (from [database-schema.md](../../architecture/database-schema.md)).
2. Claim create only where the responsible party is `Customer` (FR-9.1, BR-5).
3. Finance review/confirmation gate before the claim hits the customer balance (FR-9.6, FR-9.2).
4. Point-in-time claim pricing against `price_history` at the damage date (FR-9.5, BR-6, I-4) — never `item.current_price`.
5. Escalation: +10% per item every six months from a configurable effective date (FR-9.3); each run appends `price_history` (FR-9.4).
6. Daily idempotent scheduler job per `(item, effective_date)` (EventBridge Scheduler or equivalent).

## Schema Changes

| Table | Purpose |
|---|---|
| `damage_claim` | FR-9.1–9.6, I-5 |

## API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/discrepancies/:id/claim` | finance | Draft a claim (customer-responsible only) |
| POST | `/api/claims/:id/confirm` | finance | Confirm → add to balance (FR-9.6) |
| POST | `/api/claims/:id/reject` | finance | Reject |
| GET | `/api/claims` | finance, owner | List |

## Scheduler Design

- Run a daily job asking "is any item due for escalation today?", not a six-monthly cron — a six-monthly job that fails has a six-month blast radius and no retry surface.
- Idempotent per `(item, effective_date)`.
- Link expiry does **not** need the scheduler — check expiry at read time.

## Invariants Touched

- **I-3** — escalation appends immutable history.
- **I-4** — claim priced at damage date.
- **I-5** — customer responsibility + Finance confirmation.

## Requirements Traceability

- FR-9.1 to FR-9.7.
- BR-5, BR-6.
- EventBridge Scheduler (or equivalent) from the architecture diagram.

## Tests

- Invariant test #5: damage before an escalation date bills at the pre-escalation price after escalation runs (I-4).
- Invariant test #6: staff-responsible discrepancy cannot be raised as a claim (I-5).
- Invariant test #7: claim absent from balance until Finance confirms (I-5).
- Invariant test #9: running escalation twice in one day produces one history row (idempotency).

## Definition of Done

- Claims require customer responsibility and Finance confirmation.
- Claim values use the date-of-damage price.
- Escalation is idempotent and fully logged.

## Outputs (Handoff to Phase 8)

- Confirmed claims in customer balances; escalated price history.

## Delivery Priority

**Must have.**
