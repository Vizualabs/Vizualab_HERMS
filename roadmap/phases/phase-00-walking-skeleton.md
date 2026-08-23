---
title: Phase 0 - Walking Skeleton and Deploy Seams
date: 2026-08-17
tags:
  - herms
  - roadmap
  - foundation
  - ci-cd
status: draft
---

# Phase 0: Walking Skeleton and Deploy Seams

## Goal

Prove that one request travels browser → Nginx → Lambda → Neon → back, in CI, on day one. The diagram has four independently deployed pieces; prove the seams before there is any business logic to debug on top of them.

## Why This Comes First

Every later phase debugs on top of these seams. If deployment, database access, or request routing is unreliable, the failure surfaces inside business logic where it is far more expensive to fix.

## Prerequisites

- Git repo and `pnpm` workspaces available.
- Accounts/projects: AWS (Lambda Function URL + SQS), Neon PostgreSQL, Hostinger VPS.
- Confirmed domain and Nginx access on the VPS.
- Architecture reviewed: [system-architecture.md](../../architecture/system-architecture.md).

## Work Items (in order)

1. Scaffold the monorepo: `apps/web`, `apps/api`, `apps/notifier`, `packages/db`, `packages/shared`.
2. `packages/db`: Drizzle config, first forward-only migration, migration runner.
3. `apps/api`: Hono app with `GET /api/health` returning `{ ok, dbRoundTripMs }`.
4. `apps/api`: deploy to Lambda Function URL via CI.
5. `apps/web`: TanStack Start static shell; Nginx serves it and proxies `/api/*` same-origin.
6. CI/CD: two pipelines (VPS rsync/deploy, Lambda deploy); migrations as a gated step, never auto-applied on cold start.
7. Observability: structured JSON logs + request-ID middleware propagated web → api → notifier.
8. Seed harness: `pnpm db:seed` command (data is added in Phase 1 once schema exists).
9. Write and test the rollback procedure once.

## Schema Changes

None beyond the migration tooling. No business tables yet — Phase 1 creates the first schema. Reference [database-schema.md](../../architecture/database-schema.md) for what comes next.

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Returns `ok` and DB round-trip time |

## Frontend Deliverables

- Static shell rendered by TanStack Start.
- Nginx config: serve static + proxy `/api/*`.
- (Optional) a health status page.

## Decisions Locked Here

- Neon driver: HTTP/serverless driver, not a pooled `pg` connection per invocation.
- `proxy_read_timeout` on Nginx must exceed the Lambda's own timeout.
- Migration strategy: forward-only, gated, never auto-applied on cold start.

## Requirements Traceability

- Sections 2.4 to 2.6, 6.1, 6.3 of `Project Overview.md`.
- `Untitled Diagram.drawio.png`: the four deployed pieces and their seams.

## Tests

- Health check returns 200 with a real DB round-trip.
- A pushed commit deploys both web and API (deploy smoke test).

## Definition of Done

- A pushed commit deploys both web and API automatically.
- Health check is green from a real browser.
- The rollback procedure is written down and tested once.
- The 3-second dashboard NFR (§6.1) is measurable from day one as a cold-start + database round-trip baseline.

## Outputs (Handoff to Phase 1)

- Working monorepo and CI/CD.
- Reachable Neon + migration runner.
- Lambda Function URL behind Nginx same-origin proxy.
- Observability middleware and seed harness.

## Delivery Priority

**Must have.** This is the foundation for every other phase.
