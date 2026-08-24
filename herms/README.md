# HERMS

Hotel Equipment Rental Management System. The repository uses Bun workspaces and
implements the roadmap one approval-gated phase at a time.

## Phase 0 commands

```sh
bun install
bun run typecheck
bun test
bun run db:check
bun run db:migrate
bun run db:seed
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
