---
title: HERMS Project Initialization
date: 2026-08-22
tags:
  - herms
  - initialization
  - bun
  - phase-00
status: draft
---

# HERMS Project Initialization

This guide is the first setup step for HERMS. It creates the initial monorepo structure using **Bun**. Existing project documentation must not be changed as part of this setup.

## Rules

- Use Bun for every package-management command.
- Do not use `npm`, `npx`, `yarn`, or `pnpm`.
- Use `bun create hono@latest` for the Hono API.
- Use the TanStack CLI through Bun for the frontend.
- Install React Query with `bun add @tanstack/react-query`.
- Do not add business features during initialization.
- Ask the user to choose the skill set before installing or creating any project skills.

## Project Names

Use these meaningful names for the generated packages:

| Area | Full name | Package name |
|---|---|---|
| Frontend | Hotel Equipment Rental Management System - Frontend | `herms-frontend` |
| Backend | Hotel Equipment Rental Management System - Backend API | `herms-backend` |

## 1. Create the Project

Run these commands from the directory where the project should be created:

```sh
mkdir herms
cd herms
bun init -y
mkdir apps packages
```

Create the Hono backend:

```sh
bun create hono@latest herms-backend
```

When the Hono CLI asks for a template, select the Bun template.

Create the TanStack Start frontend through Bun:

```sh
bunx @tanstack/cli create herms-frontend
```

When the TanStack CLI asks for options, select the React and TypeScript options required by the project.

Install the frontend data-fetching dependency with Bun:

```sh
cd herms-frontend
bun add @tanstack/react-query
cd ..
```

Place the generated applications in the monorepo workspace directories:

```sh
mv herms-backend apps/api
mv herms-frontend apps/web
```

Create the remaining workspace directories:

```sh
mkdir apps/notifier packages/db packages/shared
```

Install dependencies with Bun:

```sh
bun install
```

## 2. Initial Structure

The initialized project must contain this structure:

```text
herms/
  apps/
    web/              # TanStack Start frontend
    api/              # Hono backend
    notifier/         # Notification worker, implemented later
  packages/
    db/               # Drizzle schema and migrations, implemented later
    shared/           # Shared types and constants, implemented later
  package.json
  bun.lock
```

The generated frontend and backend files must remain normal framework starter files until the relevant roadmap phase begins.

## 3. Required Verification

Run the checks below after initialization:

```sh
bun --version
bun install
bun run --cwd apps/api dev
bun run --cwd apps/web dev
```

Confirm that:

- The API starter runs successfully.
- The frontend starter runs successfully.
- `apps/web/package.json` contains the meaningful project name and `@tanstack/react-query`.
- `apps/api/package.json` contains the meaningful backend project name.
- `bun.lock` exists at the project root.
- No `package-lock.json`, `pnpm-lock.yaml`, or `yarn.lock` is created.

Stop here and obtain the user's skill selection before continuing.

## 4. Skill Selection Checkpoint

After the project initializes, ask the user exactly one question:

> Which skills should be added to this project: **frontend**, **backend**, **both**, or **none**?

Do not assume an answer. Do not add skills before the user responds.

## 5. Add Skills After User Input

Use the selected option as follows:

| User choice | Skills to add |
|---|---|
| `frontend` | TanStack Start, React, TanStack Router, TanStack Query, responsive/mobile forms, frontend testing, and accessibility workflows |
| `backend` | Hono, Bun runtime, Zod validation, Drizzle, Neon PostgreSQL, Lambda deployment, API testing, and backend security workflows |
| `both` | All frontend and backend skills listed above |
| `none` | Add no skills and continue with the next approved roadmap task |

Skill setup must follow these rules:

1. Use the user's selected scope only.
2. If a skill source, package, or installation location is not already defined, ask the user before inventing one.
3. Keep frontend and backend skill definitions separate when the user chooses `both`.
4. Do not modify the SRS, architecture documents, roadmap phases, or unrelated files while adding skills unless the user explicitly requests it.
5. Record the selected skill scope and added skill names in the initialization work log.

## 6. Handoff to Phase 0

Only after initialization and the skill-selection checkpoint are complete may implementation continue with the existing Phase 0 work:

- Database and migration tooling
- Hono health endpoint
- TanStack Start static shell
- Nginx proxy configuration
- CI/CD deployment seams
- Request-ID logging and rollback verification

Business workflows must wait for their assigned roadmap phases. In particular, do not implement quotations, orders, stock movement, approval, payments, or dashboard features during this initialization step.

## 7. Continue Development

After project initialization, read the architecture documents to understand the system design:

- [System Architecture](architecture/system-architecture.md)
- [Backend Architecture](architecture/backend.md)
- [Database Schema](architecture/database-schema.md)
- [Frontend Architecture](architecture/frontend.md)

Then implement the project according to the roadmap phases, in order:

1. [Phase 0 - Walking Skeleton](roadmap/phases/phase-00-walking-skeleton.md)
2. [Phase 1 - Identity, RBAC and Master Data](roadmap/phases/phase-01-identity-rbac-master-data.md)
3. [Phase 2 - Quotation and Order](roadmap/phases/phase-02-quotation-order.md)
4. [Phase 3 - Stock Ledger, Delivery Note and Approval](roadmap/phases/phase-03-stock-ledger-delivery-approval.md)
5. [Phase 4 - Retention, Reconciliation and Write-off](roadmap/phases/phase-04-retention-reconciliation-writeoff.md)
6. [Phase 5 - Async Spine and Notifications](roadmap/phases/phase-05-async-notifications.md)
7. [Phase 6 - Payments, Invoicing and Expenses](roadmap/phases/phase-06-payments-invoicing-expenses.md)
8. [Phase 7 - Damage Claims and Price Escalation](roadmap/phases/phase-07-damage-claims-escalation.md)
9. [Phase 8 - Dashboard and Reporting](roadmap/phases/phase-08-dashboard-reporting.md)
10. [Phase 9 - Hardening and Could-haves](roadmap/phases/phase-09-hardening-could-haves.md)
11. [Phase 10 - Agentic Workflow](roadmap/phases/phase-10-agentic-workflow.md)

Before starting each phase:

- Read [Invariants](roadmap/invariants.md).
- Read the phase's prerequisites, work items, tests, and definition of done.
- Read the relevant requirements in [Project Overview](../Project%20Overview.md).
- Implement only the current phase unless the user explicitly approves pulling work forward.
- Complete and verify the current phase before moving to the next phase.

## 8. Approval-Gated Phase Workflow

Development must be human-in-the-loop. The agent must not silently move from one phase to the next. Every phase follows this sequence:

1. **Explain the phase.** State the phase number, goal, requirements, files expected to change, and any risks.
2. **List configuration.** Tell the user exactly which accounts, URLs, environment variables, provider settings, or client decisions are needed.
3. **Wait for input.** Ask the user to provide non-secret values or confirm that secrets have been configured locally. Never ask the user to paste passwords, API keys, private keys, or database credentials into chat.
4. **Give setup steps.** Explain how to create or update `.env.example`, the local `.env` file, cloud settings, and any required provider configuration.
5. **Ask to start.** Do not edit implementation files until the user explicitly approves the phase.
6. **Implement the approved phase.** Change only the files required by that phase.
7. **Test the phase.** Run the documented unit, integration, typecheck, build, migration, and smoke tests that apply to the phase.
8. **Report the result.** State what works, what failed, what configuration remains, and which requirements and invariants are satisfied.
9. **Ask for completion approval.** Show the user the test results and ask whether the phase is approved as complete.
10. **Wait before continuing.** Start the next phase only after explicit approval such as `Approved: Phase 0 complete`.

### Configuration Safety

- Commit `.env.example` with variable names and safe placeholder values.
- Keep `.env`, `.env.local`, and provider credential files out of Git.
- Do not print secret values in logs, screenshots, test output, or chat.
- Use separate development, test, staging, and production values.
- Ask the user to confirm a secret is configured; do not request the secret value.
- If a required client decision is unresolved, stop and identify it instead of guessing.
- Validate required environment variables at application startup with a shared schema.

### Phase Configuration and Test Guide

The agent must use the applicable row before starting each phase. The exact values are supplied by the user or confirmed from the project documents; defaults must not be silently invented.

| Phase | Configuration to explain to the user | Required verification before approval |
|---|---|---|
| 0 - Walking Skeleton | Neon database URL; AWS region and Lambda deployment settings; Hostinger/VPS host and SSH or deployment credentials; domain; Nginx API proxy target and timeout; CI secret names; request-ID settings. | Run `bun install`, migration-tool smoke test, API health check with a real database round-trip, frontend build, browser-to-Nginx-to-Lambda smoke test, and deployment rollback check. |
| 1 - Identity, RBAC and Master Data | Session or authentication secret; initial owner/admin bootstrap process; user roles; store record; seed policy; database migration URL. | Test login and logout, each role's authorization boundary, field-staff access denial to back-office routes, customer/item CRUD, price-history append-only rejection, and audit-row creation. |
| 2 - Quotation and Order | Quotation numbering format; quotation expiry period; business timezone; recurring-customer price-list policy; new-customer custom-price policy; copy-link/PDF fallback until notifications are available. | Test fixed versus custom pricing, frozen quotation prices, quotation status transitions, expiry handling, accepted-quotation-to-order conversion, duplicate-conversion prevention, and audit records. |
| 3 - Stock Ledger, Delivery Note and Approval | Store assignment; note-link expiry; token generation and hashing settings; delivery-note numbering; opening-balance procedure; assigned Store Admins and deputies. | Test note submission leaves stock unchanged, valid and expired token access, note scoping, mismatch validation, pending-approval queue, required physical count, approval-only stock posting, idempotent approval, and audit records. |
| 4 - Retention, Reconciliation and Write-off | Retention-note numbering; partial-return policy; correction/reversal window; missing/damaged reason policy; responsible-party values; order close policy. | Test multiple partial retention notes, cumulative reconciliation at `Fully Returned`, rejection of unbalanced closure, returned stock-in, missing/damaged write-off, reversal rules, and append-only audit entries. |
| 5 - Async Spine and Notifications | SQS queue and DLQ; publisher schedule or trigger; notification provider and sender identity; WhatsApp credentials; SMS fallback; email settings; retry and alarm thresholds. | Test transactional outbox creation, publisher retry, SQS delivery, notification idempotency, provider failure and DLQ routing, fallback behavior, link delivery, and request-ID correlation. |
| 6 - Payments, Invoicing and Expenses | Currency and minor-unit rule; business timezone; invoice numbering; accepted payment methods; payment correction policy; expense categories; finance user access. | Test invoice values use frozen order prices, partial payments, outstanding balances, duplicate-payment protection, append-only payment corrections, expense records, monthly totals, and audit records. |
| 7 - Damage Claims and Price Escalation | Escalation effective date; six-month interval; 10% rate; daily scheduler; Business Owner confirmation policy; Finance confirmation policy; claim numbering. | Test point-in-time claim pricing, staff-responsible claim rejection, Finance confirmation gate, balance update only after confirmation, immutable price history, escalation idempotency, and no duplicate scheduled escalation. |
| 8 - Dashboard and Reporting | Dashboard timezone and date ranges; reporting filters; export format and storage policy; management access; aggregation refresh strategy. | Test stock quantity/value, open discrepancies, rankings, payment trends, income versus expenses, filters, exports, authorization, and performance against the dashboard response target. |
| 9 - Hardening and Could-haves | Reorder thresholds; PDF/print layouts approved by the client; backup provider; backup schedule; restore location; RPO/RTO targets; monitoring and alert destinations. | Run security checks, typecheck, tests, build, load/performance checks, backup and restore rehearsal, link-expiry checks, audit review, NFR verification, and production-readiness checklist. |
| 10 - Agentic Workflow | Approved skill scope; allowed tools; feature flags; human approval points; agent audit-log destination; rollback and kill-switch settings. | Test that agents cannot bypass authorization, approval gates, audit logging, pricing, reconciliation, notification, or stock invariants; verify human approval is required for every agent-proposed mutation. |

### Required Agent Message Before a Phase

Before implementation, the agent must use a message with this structure:

```text
Phase <number>: <name>

Goal: <what this phase will deliver>
Requirements/invariants: <FR and BR IDs, plus I-numbers>
Files expected to change: <file list or directories>

Configuration required:
1. <parameter or account>
2. <parameter or account>

Configure it step by step:
1. Open `.env.example` and confirm the listed variable names.
2. Create or update the local `.env` file with the values.
3. Configure the matching cloud/provider setting if applicable.
4. Do not paste secret values into chat.
5. Reply `configured` when the values are ready, or tell me which item is blocked.

Tests I will run:
1. <test command or smoke test>
2. <test command or smoke test>

Reply `Approve Phase <number>` to allow implementation to start.
```

### Required Agent Message After a Phase

After implementation and tests, the agent must report:

```text
Phase <number>: <name>

Implemented: <short summary>
Configuration used: <variable names and non-secret values only>
Tests run: <commands and results>
Requirements satisfied: <FR IDs>
Invariants verified: <I-numbers and how>
Open items or failures: <items, or `none`>

The phase will not continue automatically.
Reply `Approve Phase <number> complete` to move to the next phase.
```

## Definition of Done

- The project is initialized with Bun.
- `apps/api` is generated from `herms-backend` with `bun create hono@latest`.
- `apps/web` is generated from `herms-frontend` through the TanStack CLI using Bun.
- `@tanstack/react-query` is installed with `bun add`.
- The required monorepo directories exist.
- The frontend and backend starters run.
- The user has explicitly selected `frontend`, `backend`, `both`, or `none` for skills.
- Existing project documentation remains unchanged.
