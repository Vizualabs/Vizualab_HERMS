---
title: Phase 1 - Identity, RBAC and Master Data
date: 2026-08-17
tags:
  - herms
  - roadmap
  - identity
  - rbac
  - master-data
status: draft
---

# Phase 1: Identity, RBAC and Master Data

## Goal

Establish users, roles, customers, equipment items, append-only price history, and the audit-log foundation.

## Why This Comes First (After the Skeleton)

Nothing can be attributed to a user until users exist, and nothing can be priced until items and price lists exist. The append-only price-history and audit-log tables are retroactive invariants that later phases depend on, so they must be correct from day one.

## Prerequisites (Inputs from Phase 0)

- Working monorepo, CI/CD, Neon + migration runner, observability middleware, seed harness.

## Work Items (in order)

1. Schema + enums: `store`, `user`, `customer`, `customer_price`, `equipment_item`, `price_history`, `audit_log` — column-for-column from [database-schema.md](../../architecture/database-schema.md).
2. Database trigger: reject `UPDATE`/`DELETE` on `price_history` (I-3) and `audit_log` (I-8).
3. Auth: login endpoint, password hashing, session/token, and an RBAC middleware enforcing the six roles at the route layer (FR-12.1).
4. Audit service/middleware: every mutating route writes an audit row with actor, action, entity, before/after (I-8, FR-7.5).
5. Seed: `pnpm db:seed` — 1 store, 3 customers, 8 equipment items, 1 user per role.
6. Equipment item CRUD.
7. Price set/edit: writes an offsetting `price_history` row and updates `current_unit_price_cents` atomically (FR-1.5, I-3).
8. Customer CRUD with `type = Recurring | New` (FR-1.1).
9. Fixed price list per recurring customer via `customer_price` (FR-1.2).
10. New → Recurring transition (FR-1.4).
11. Frontend: login, role-gated navigation, customers list/detail, items list/detail, price-history view.

## Schema Changes

| Table | Invariant / Requirement |
|---|---|
| `store` | multi-store-ready (§6.5) |
| `user` | FR-12.1 roles; `is_deputy_admin` for deputy store admins |
| `customer` | FR-1.1 |
| `customer_price` | FR-1.2, BR-1, I-7 |
| `equipment_item` | FR-1.x master data |
| `price_history` | FR-1.5, FR-9.7, I-3 (append-only) |
| `audit_log` | FR-7.5, I-8 (append-only) |

## API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | public | Issue session/token |
| GET | `/api/me` | any user | Current user + role |
| GET/POST/PUT | `/api/customers` | sales, owner | Customer CRUD |
| PUT | `/api/customers/:id/recurring` | sales | New → Recurring with fixed price list (FR-1.4) |
| GET/POST/PUT | `/api/items` | sales, owner, system | Item CRUD |
| POST | `/api/items/:id/price` | sales, owner | New price (offsetting history row) |
| GET | `/api/items/:id/price-history` | sales, owner | Immutable history |

## Frontend Deliverables

- Login screen.
- Navigation filtered by role.
- Customers list + detail (with fixed price list for recurring).
- Items list + detail with price-history view.

## Invariants Touched

- **I-3** — price history immutable (trigger).
- **I-8** — every change attributable (audit rows).

## Requirements Traceability

- FR-12.1, FR-12.3: role-based access and attributable actions.
- FR-1.1 to FR-1.5: customer and pricing master data.
- FR-9.7: immutable price history.
- FR-7.5 and NFR §6.2, §6.6: audit trail.

## Tests

- Invariant test #4: `UPDATE` on `price_history` is rejected (I-3).
- A Sales user can see customers but not the audit log; a Field Staff user can reach neither (FR-12.1).

## Definition of Done

- Login + RBAC work for all six roles; enforcement is at the route, not only the UI.
- Price edits append `price_history` rows and cannot be edited or deleted.
- `pnpm db:seed` populates a usable dev database.
- All mutating routes write audit rows.

## Outputs (Handoff to Phase 2)

- Users/RBAC, customers, items, immutable price history, audit-log foundation, seed data.

## Delivery Priority

**Must have.**
