# Vizualab HERMS

Documentation and implementation plan for the Hotel Equipment Rental Management System (HERMS).

## Bootstrap and run

From the repository root:

```sh
cd herms
.\herms.bat bootstrap
.\herms.bat dev
```

The frontend starts at `http://localhost:3000` and the backend at
`http://localhost:3001`. To migrate and seed a configured database, run:

```sh
cd herms
.\herms.bat bootstrap-db
```

The batch file is the Windows entry point. The equivalent Bun commands remain
available for non-Windows environments.

## Super-user test account

After running `.\herms.bat bootstrap-db`, provision a test super user:

```powershell
$env:SUPER_USER_EMAIL = "admin@herms.local"
$env:SUPER_USER_PASSWORD = "ReplaceWithAStrongPassword123!"
$env:SUPER_USER_NAME = "HERMS Super User"

bun run db:create-super-user
```

`SUPER_USER_PASSWORD` must contain at least 16 characters. The command creates
or updates the account identified by the email, activates it, assigns the
`super_user` role, uses the first seeded store, and records an audit event.

To use a specific existing store, set this optional value before provisioning:

```powershell
$env:SUPER_USER_STORE_ID = "<existing-store-uuid>"
```

Remove the temporary variables after provisioning:

```powershell
Remove-Item Env:SUPER_USER_EMAIL -ErrorAction SilentlyContinue
Remove-Item Env:SUPER_USER_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:SUPER_USER_NAME -ErrorAction SilentlyContinue
Remove-Item Env:SUPER_USER_STORE_ID -ErrorAction SilentlyContinue
```

Start the application with `.\herms.bat dev`, then sign in at
`http://localhost:3000/login` using the selected email and password. Never
commit real super-user credentials to the repository.

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
