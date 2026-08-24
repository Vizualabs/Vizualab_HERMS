# HERMS Initialization Work Log

## Skill selection

- Frontend selected: `tanstack-router-best-practices`, `tanstack-query-best-practices`, `playwright-best-practices`, `shadcn`, `tailwind-design-system`, `web-design-guidelines`.
- Backend/database selected: `hono`, `hono-rpc`, `hono-testing`, `api-design-patterns`, `drizzle`, `drizzle-migrations`, `better-auth-best-practices`.
- Package manager: Bun only. Third-party npm, npx, pnpm, and yarn examples must be translated to Bun equivalents.
- Source-name note: `bobmatnyc/claude-mpm-skills` exposes the ORM skill as `drizzle`; no `drizzle-orm` skill exists in that source.

## Scope boundary

This checkpoint installs agent guidance only. Runtime database, authentication, and migration implementation remains assigned to the approved roadmap phases.

## Phase 1 implementation

- Added the authoritative store, user, customer, customer_price, equipment_item,
  price_history, and audit_log schema.
- Added database triggers that reject all UPDATE and DELETE operations on
  price_history and audit_log.
- Added Argon2id password verification, signed HttpOnly sessions, CSRF
  protection, active-user checks, and server-side RBAC for all six roles.
- Added audited customer and equipment create/read/update flows, recurring
  customer price lists, and atomic equipment price changes.
- Used Drizzle's Neon HTTP batch API for non-interactive atomic mutations; the
  HTTP adapter intentionally does not support interactive transactions.
- Added login, role-gated navigation, customer detail/fixed-price-list, equipment
  detail/edit, and immutable price-history screens.
- Added a local-only secret configurator plus idempotent development seed data:
  one store, one user per role, three customers, and eight equipment items.
- Applied migration 0001_identity_rbac_master_data.sql to the configured Neon
  database and completed real-database verification for login/logout, RBAC,
  audit creation, atomic price changes, and both append-only triggers.

Deployment and Nginx changes remain deferred until hosting configuration is
provided, as requested.
