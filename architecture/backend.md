---
title: HERMS Backend Architecture
date: 2026-08-17
tags:
  - herms
  - architecture
  - backend
status: draft
---

# HERMS Backend Architecture

The backend is a **Hono.js monolith** running on an **AWS Lambda Function URL**, backed by **Neon PostgreSQL**. All business logic, authorization, validation, transactions, and outbox writes happen here.

## Monorepo Layout

```
apps/
  web/        TanStack Start (frontend)
  api/        Hono (this backend)
  notifier/   Notification Lambda
packages/
  db/         Drizzle schema + migrations
  shared/     Shared types and constants
```

## Responsibilities

The API owns:

- Authentication and route-level RBAC for all six roles.
- Customer, pricing, quotation, and order workflows.
- Delivery Note and Retention Note submission via scoped tokens.
- The Store Admin approval gate — the **only** code path that writes stock ledger rows.
- Discrepancy, damage claim, payment, and expense logic.
- Six-month price escalation.
- Audit-log and outbox writes in the same transaction as each business change.

## Domain Services

Business rules are implemented once as deterministic domain services, reused across routes:

| Service | Enforces |
|---|---|
| Pricing resolver | BR-1 / I-7: recurring → fixed list, new → manual price. One function used by quotation, order, invoice, and claim paths. |
| Approval gate | BR-4 / I-1, I-2: physical count, flag difference, atomic stock posting. |
| Stock ledger | FR-6.1 / I-1: append-only rows citing an approved source note. |
| Reconciliation | BR-3 / I-6: cumulative `returned + balance + missing_damaged = delivered` at close. |
| Claim service | BR-5, FR-9.6 / I-5: customer responsibility + Finance confirmation. |
| Price history | FR-9.7 / I-3: append-only, trigger-enforced. |
| Escalation | FR-9.3 / I-4: +10% every six months, idempotent per `(item, effective_date)`. |
| Notification intent | I-12: write `outbox` row, never call a provider directly. |

## Authentication and Authorization

- Six roles: Business Owner, Sales, Field Staff, Store Admin, Finance, System Admin (FR-12.1).
- RBAC enforced at the route/domain layer, not just in the UI.
- Field staff submit notes via a scoped, expiring link token with no full login (FR-12.2). The token is the attribution identity (FR-12.3).
- Every stock, price, discrepancy, payment, and claim action writes an audit row (I-8).

## Transactions and Idempotency

- Business mutation and its outbox/audit rows commit atomically.
- Idempotency keys prevent duplicate effects from retries.
- No direct SQS `PutMessage` in the request path — a post-commit failure would silently lose the notification (I-12).

## Notification Pipeline

```
outbox row (same tx) → publisher drains → SQS → Notification Lambda → provider
                                                        ↓ (both fail)
                                                       DLQ + alarm
```

- WhatsApp Business API primary, SMS fallback, email for back-office (SRS §4.3).
- Idempotency key per notification — SQS is at-least-once and a customer must never receive the same quotation twice (I-12).

## Scheduler

- Daily EventBridge Scheduler (or equivalent) job asks "is any item due for escalation today?".
- Idempotent per `(item, effective_date)` so a retry never double-applies escalation.
- Link expiry is checked at read time and does **not** require the scheduler.

## API Conventions

- `GET /api/health` returns database round-trip time.
- Structured JSON logs with a request ID propagated web → api → notifier.
- Direct Lambda Function URL access is authenticated, rate-limited, validated, and monitored — not assumed safe just because Nginx normally proxies it.

## Open Decisions

Provider choice, escalation confirmation semantics, and the cold-start trade-off are tracked in [Open Decisions](../roadmap/open-decisions.md) and [Architecture Risks](../roadmap/architecture-risks.md).
