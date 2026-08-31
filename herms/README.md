# HERMS

Hotel Equipment Rental Management System. The repository uses Bun workspaces and
implements the roadmap one approval-gated phase at a time.

## Quick start

From the `herms` directory, bootstrap a fresh checkout:

```sh
.\herms.bat bootstrap
```

This installs the locked dependencies and creates `.env` from `.env.example` when
needed. Existing `.env` files are preserved. Open `.env` and set valid
`DATABASE_URL` and `MIGRATION_DATABASE_URL` values, then initialize the database:

```sh
.\herms.bat bootstrap-db
```

Database initialization is opt-in because it runs the migration and seed commands
against the database configured in `.env`.

Start the backend and frontend together:

```sh
.\herms.bat dev
```

The batch file is the Windows entry point. On non-Windows systems, use the
equivalent `bun run bootstrap`, `bun run bootstrap --with-db`, and `bun run dev` commands.

The web app is available at `http://localhost:3000`, and the API listens at
`http://localhost:3001`. Press `Ctrl+C` to stop both services.

To run them in separate terminals instead:

```sh
# Terminal 1: backend
.\herms.bat dev-api

# Terminal 2: frontend
.\herms.bat dev-web
```

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
