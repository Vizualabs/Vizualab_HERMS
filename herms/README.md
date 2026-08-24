# HERMS

Hotel Equipment Rental Management System. The repository uses Bun workspaces and
implements the roadmap one approval-gated phase at a time.

## Phase 1 commands

```sh
bun install
bun run typecheck
bun test
bun run db:check
bun run db:migrate
bun run db:seed
bun run verify:phase1
bun run build
```

Run the API and frontend in separate terminals:

```sh
bun run dev:api
bun run dev:web
```

The web shell is available at `http://localhost:3000`. Vite proxies
`/api/*` to the local Hono API at `http://localhost:3001`.

## Environment

Copy `.env.example` to `.env` and configure values locally. The runtime and
migration database URLs are deliberately separate. Never commit `.env`.

Deployment setup and required CI values are documented in
`docs/deployment/phase-0.md`.

Run `bun run config:phase1` once to generate missing local authentication and
seed secrets without printing their values. Production must use its own
`AUTH_SECRET`, set `SESSION_COOKIE_SECURE=true`, and must not reuse the
development seed password.

The development seed creates these login names:

- `owner@herms.local`
- `sales@herms.local`
- `field@herms.local`
- `store-admin@herms.local`
- `finance@herms.local`
- `system-admin@herms.local`

Their local password is the ignored `SEED_USER_PASSWORD` value in `.env`.
Passwords are stored in PostgreSQL only as Argon2id hashes.

Phase 1 uses an eight-hour signed HttpOnly, SameSite=Strict cookie. Every
protected request reloads the active user from PostgreSQL before applying
route-level RBAC. Customer and equipment mutations write audit rows atomically;
equipment price changes also append immutable price history in the same Neon
HTTP batch transaction.
