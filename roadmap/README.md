---
title: HERMS Implementation Roadmap
date: 2026-08-17
tags:
  - herms
  - roadmap
  - implementation
  - agentic-workflow
status: draft
---

# HERMS Implementation Roadmap

This roadmap translates the requirements in [`Project Overview.md`](../../Project%20Overview.md) (SRS v1.0, 11 Aug 2026), the supplementary client notes in `IMPORTANT .docx`, and the supplied `Untitled Diagram.drawio.png` architecture diagram into a delivery sequence.

Read this before starting any work. Phases are ordered by dependency, not by how interesting the feature is.

## Implementing a Phase (Reading Order)

Before writing code for a phase, read in this order:

1. [Invariants](invariants.md) — the 12 rules that hold in every phase.
2. [Architecture docs](../architecture/) — system, backend, database-schema, frontend (the "how").
3. The phase file under `phases/` (the "what, in what order"): prerequisites, work items, schema changes, API endpoints, frontend, tests, definition of done, outputs.
4. The relevant FR-/BR- sections verbatim in `Project Overview.md`.

Each phase file lists its **Prerequisites** (inputs) and **Outputs** (handoff), so phases chain together. Confirm the previous phase's outputs exist before starting the next.

## Ordering Rationale

> Data integrity before money, money before dashboards, dashboards before nice-to-haves.

1. **The Store Admin approval gate (BR-4) is the spine of the system.** Stock, discrepancies, damage claims, and every financial number ultimately derive from an approved note. Build the gate before anything that reads from it.
2. **Finance is downstream of discrepancies.** A damage claim (FR-9.1) cannot exist until a discrepancy has a confirmed responsible party (FR-4.3).
3. **The dashboard is downstream of everything.** Building it early means building it three times.
4. **WhatsApp is a long-lead external dependency, not a phase.** Business API / BSP onboarding takes weeks and is still an open client item (SRS §10.2). Start the application in Phase 0, ship Phases 1–4 behind a copy-link fallback, and land the channel in Phase 5.

## Invariants

Twelve non-negotiable rules govern every phase. An agent may not weaken one to make a task pass — if a task appears to require breaking one, stop and raise it. They are the single source of truth for stock, price history, claims, reconciliation, attribution, links, money, and notification ordering. See [Invariants](invariants.md).

## Architecture

Component-level design lives in the [architecture docs](../architecture/):

- [System Architecture](../architecture/system-architecture.md) — topology, flows, decisions.
- [Backend](../architecture/backend.md) — Hono monolith, domain services, outbox.
- [Database Schema](../architecture/database-schema.md) — Neon PostgreSQL, tables, invariants.
- [Frontend](../architecture/frontend.md) — TanStack Start, back-office and mobile forms.

## Delivery Order

| Order | Phase | Outcome | Priority |
|---|---|---|---|
| 0 | [Walking Skeleton](phases/phase-00-walking-skeleton.md) | One request travels browser → Nginx → Lambda → Neon → back, in CI | Must have |
| 1 | [Identity, RBAC and Master Data](phases/phase-01-identity-rbac-master-data.md) | Users, roles, customers, items, append-only price history, audit log | Must have |
| 2 | [Quotation → Order](phases/phase-02-quotation-order.md) | Correct pricing, quotation status machine, order conversion | Must have |
| 3 | [Stock Ledger, Delivery Note and Approval Gate ⭐](phases/phase-03-stock-ledger-delivery-approval.md) | Append-only stock ledger, link submission, approval gate | Must have |
| 4 | [Retention Note, Reconciliation and Write-off](phases/phase-04-retention-reconciliation-writeoff.md) | Returns, cumulative reconciliation, write-offs | Must have |
| 5 | [Async Spine and Notifications](phases/phase-05-async-notifications.md) | SQS + DLQ + notification Lambda, WhatsApp/SMS | Production gate |
| 6 | [Payments, Invoicing and Expenses](phases/phase-06-payments-invoicing-expenses.md) | Invoice values, partial payments, balances, expenses | Must have |
| 7 | [Damage Claims and Price Escalation](phases/phase-07-damage-claims-escalation.md) | Claims with Finance review, point-in-time pricing, +10% escalation | Must have |
| 8 | [Dashboard and Reporting](phases/phase-08-dashboard-reporting.md) | Real reconciled management views and export | Must have |
| 9 | [Hardening and Could-haves](phases/phase-09-hardening-could-haves.md) | NFR verification, printed layouts, backups | Should have |
| 10 | [Agentic Workflow](phases/phase-10-agentic-workflow.md) | Safe human-in-the-loop assistance | Later / optional |

## Requirement ID → Phase Map

Use this to answer "where does this belong?" without re-reading the roadmap.

| Phase | Requirements |
|---|---|
| 0 Skeleton | infra only; start WhatsApp BSP application |
| 1 Identity & master data | FR-12.1, FR-12.3, FR-1.1→1.5, FR-9.7 |
| 2 Quotation → Order | FR-2.1, FR-2.3, FR-2.4 (FR-2.2 to outbox only) |
| 3 Ledger, DN, links, approval | FR-6.1, FR-6.2, FR-3.1→3.5, FR-11.1→11.3, FR-11.5, FR-7.1→7.5, FR-12.2, FR-5.1 |
| 4 RN & reconciliation | FR-4.1→4.7, FR-6.3, FR-6.5, FR-5.5 |
| 5 Async & notifications | FR-2.2, FR-11.4, FR-11.5 dispatch |
| 6 Finance | FR-8.1→8.5 |
| 7 Claims & escalation | FR-9.1→9.6 |
| 8 Dashboard | FR-10.1→10.7, FR-5.2→5.4 |
| 9 Hardening | FR-6.4, NFR §6.1–§6.6 |

## Dependency Graph

```mermaid
flowchart TD
    P0["Phase 0: Walking skeleton"]
    P1["Phase 1: Identity + master data"]
    P2["Phase 2: Quotation → Order"]
    P3["Phase 3: Ledger + DN + link + APPROVAL GATE ⭐"]
    P4["Phase 4: RN + reconciliation + write-off"]
    P5["Phase 5: SQS + notifications"]
    P6["Phase 6: Payments + expenses"]
    P7["Phase 7: Damage claims + escalation"]
    P8["Phase 8: Dashboard"]
    P9["Phase 9: Hardening"]
    P10["Phase 10: Agentic workflow"]

    P0 --> P1 --> P2 --> P3 --> P4
    P4 --> P5
    P4 --> P6 --> P7
    P5 --> P8
    P7 --> P8 --> P9
    P9 --> P10
```

- **Phases 5 and 6 are parallelisable once Phase 4 lands.** Nothing else is.
- Phase 5 (notifications) and Phase 6 (payments) both read Phase 4 output but do not depend on each other.

## Long-lead Items to Start Immediately

These do not block Phase 0 and must be started in parallel:

- WhatsApp Business API / BSP account application (SRS §4.3, §10.2).
- Client confirmation of the printed/PDF Delivery Note and Retention Note layouts (SRS §10.2, §11.1, §11.2).

## MVP Boundary

The MVP includes Phases 0 through 8. Phase 9 is hardening; Phase 10 is excluded from the first production release until deterministic workflows, authorization, audit, and operational recovery paths have been proven.

The MVP is not complete unless it can enforce these controls:

- No stock quantity changes before Store Admin physical count and approval (BR-4).
- Stock is an append-only ledger; current quantity is derived, never mutated in place.
- Every stock, payment, discrepancy, price, and claim action has an accountable actor.
- Note links are scoped, time-bound or single-use, and revocable.
- Quotations and orders retain the exact price agreed at the time.
- Notifications are idempotent and recoverable through a dead-letter queue.
- Customer claims use the approved responsibility and point-in-time historical price rules.

## Domain Vocabulary

Use the client's exact words in code, UI copy, and commit messages. The client is replacing paper documents and must recognise the digital ones.

- **Delivery Note (DN)** — stock issued and handed over. Fields `issued_qty`, `handed_over_qty`.
- **Retention Note (RN)** — equipment returned. Fields `returned_qty`, `balance_qty`, `missing_damaged_qty`. Not "return note".
- **Discrepancy** — a mismatch with type, reason, and responsible party.
- **Responsible Party** — `Customer` or `Staff Member`. Determines billability.
- **Recurring / New customer** — determines the pricing model, nothing else.
- **Store Admin** — the approver; the only role that can move stock.

## Working Conventions

### Workflow for any task

1. Locate the task in a phase. If it belongs to a later phase, say so and ask before pulling work forward.
2. Collect the FR-/BR- IDs and read them verbatim in the SRS; note the MoSCoW priority.
3. Name which invariants (I-1 … I-12) the task touches; raise a conflict before writing code.
4. State the plan in a few lines, including the schema change, before editing files.
5. Schema first: Drizzle migration, then API, then UI. Never let the UI shape the schema.
6. Write the invariant test with the feature, not after it.
7. Close the loop: typecheck, tests, migration applied against a scratch branch. Report satisfied vs open FR IDs.

### Stack rules

- **Validate once, shared** — Zod schemas live in `packages/shared` and are used by both the Hono route and the TanStack form.
- **Neon driver** — HTTP/serverless driver; never a pooled TCP connection per Lambda invocation.
- **Migrations** — forward-only, checked in, run as a gated deploy step, never on cold start.
- **Money** — integer cents (I-10). Money and stock arithmetic never happens in the frontend; the API returns computed values and the UI formats them.
- **Audit** — every mutating route writes an audit row (I-8).
- **No direct provider calls** — notification intent goes to `outbox` (I-12).

### Do not

- Build a manual stock-adjustment feature (I-1).
- Add multi-currency, a customer self-service portal, barcode/RFID counting, multi-branch consolidation, or accounting integration (SRS §10.1). Keep the schema multi-store-ready without building it.
- Use EventBridge for link expiry — check expiry at read time.
- Implement the six-month escalation as a six-monthly cron — run a daily idempotent "is anything due today?" job.
- Enforce reconciliation on individual partial retention notes (I-6).
- Read `items.current_price` when pricing a claim or rendering a historical document (I-4, I-11).
- Build dashboard tiles before Phase 8.

## Task Reporting Format

End every task with:

```
Phase:        <n> — <name>
Satisfied:    FR-x.y, FR-x.z
Invariants:   I-n (how upheld)
Tests added:  <names>
Open items:   <client decisions or deferred S/C items>
Next:         <the next task in this phase, or "phase complete">
```

## Architecture Risks

Cold-start behaviour, Neon connection handling, the two-runtime trade-off, proxy timeouts, and token leakage are decisions to make early. See [Architecture Risks](architecture-risks.md).

## Open Decisions

Client confirmations and requirement ambiguities that must be resolved before their phase closes are tracked in [Open Decisions](open-decisions.md).

## Source Documents

- [`Project Overview.md`](../../Project%20Overview.md), SRS v1.0.
- `IMPORTANT .docx`, supplementary client notes used during planning.
- `Untitled Diagram.drawio.png`, proposed deployment architecture used during planning.
