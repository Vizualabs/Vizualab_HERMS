# Vizualab HERMS

Documentation and implementation plan for the Hotel Equipment Rental Management System (HERMS).

## Bootstrap and run

From the repository root:

```sh
cd herms
bun run bootstrap
bun run dev
```

The frontend starts at `http://localhost:3000` and the backend at
`http://localhost:3001`. To migrate and seed a configured database, run:

```sh
cd herms
bun run bootstrap --with-db
```

See [the application README](herms/README.md) for the complete setup instructions.

## Start Here

1. [Project Initialization](PROJECT_INITIALIZATION.md)
2. [Implementation Roadmap](roadmap/README.md)
3. [System Architecture](architecture/system-architecture.md)
4. [Project Invariants](roadmap/invariants.md)
5. [Open Decisions](roadmap/open-decisions.md)

## Architecture

- [System Architecture](architecture/system-architecture.md)
- [Backend Architecture](architecture/backend.md)
- [Database Schema](architecture/database-schema.md)
- [Frontend Architecture](architecture/frontend.md)

## Roadmap Guidance

- [Implementation Roadmap](roadmap/README.md)
- [Project Invariants](roadmap/invariants.md)
- [Architecture Risks](roadmap/architecture-risks.md)
- [Open Decisions](roadmap/open-decisions.md)

## Implementation Phases

The phases must be completed in order unless a documented dependency explicitly allows parallel work.

1. [Phase 0: Walking Skeleton and Deploy Seams](roadmap/phases/phase-00-walking-skeleton.md)
2. [Phase 1: Identity, RBAC and Master Data](roadmap/phases/phase-01-identity-rbac-master-data.md)
3. [Phase 2: Quotation to Order](roadmap/phases/phase-02-quotation-order.md)
4. [Phase 3: Stock Ledger, Delivery Note and Approval Gate](roadmap/phases/phase-03-stock-ledger-delivery-approval.md)
5. [Phase 4: Retention Note, Reconciliation and Write-off](roadmap/phases/phase-04-retention-reconciliation-writeoff.md)
6. [Phase 5: Async Spine and Notifications](roadmap/phases/phase-05-async-notifications.md)
7. [Phase 6: Payments, Invoicing and Expenses](roadmap/phases/phase-06-payments-invoicing-expenses.md)
8. [Phase 7: Damage Claims and Price Escalation](roadmap/phases/phase-07-damage-claims-escalation.md)
9. [Phase 8: Dashboard and Reporting](roadmap/phases/phase-08-dashboard-reporting.md)
10. [Phase 9: Hardening and Could-haves](roadmap/phases/phase-09-hardening-could-haves.md)
11. [Phase 10: Agentic Workflow and Human Approval](roadmap/phases/phase-10-agentic-workflow.md)

Each phase document defines its prerequisites, implementation work, tests, outputs, and definition of done. Read the architecture documents and invariants before beginning a phase.
