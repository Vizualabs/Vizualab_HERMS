<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@tanstack/cli#query-docs-library-metadata"
    run: "bunx @tanstack/intent@latest load @tanstack/cli#query-docs-library-metadata"
    for: "Retrieve machine-readable context with tanstack libraries, tanstack doc, tanstack search-docs, tanstack create --list-add-ons --json, and --addon-details for agent-safe discovery and preflight validation."
<!-- intent-skills:end -->

## Frontend skills

When working in `apps/web`, use the matching project skill from `.agents/skills`:

HERMS is Bun-only. Translate third-party `npm`/`npx` examples to `bun`/`bunx` and do not create another package-manager lockfile.

- `tanstack-router-best-practices` for route structure, navigation, loaders, search parameters, and route typing.
- `tanstack-query-best-practices` for query keys, caching, mutations, prefetching, and SSR hydration.
- `playwright-best-practices` for frontend end-to-end and component testing.
- `shadcn` for shadcn/ui components, forms, composition, icons, and registry usage.
- `tailwind-design-system` for Tailwind CSS v4 tokens, themes, responsive patterns, and component variants.
- `web-design-guidelines` for UI, UX, and accessibility reviews; fetch its current guideline source when performing a review.

## Backend and database skills

When working in `apps/api`, use the matching project skill from `.agents/skills`:

- `hono` for Hono routing, middleware, validation, testing, streaming, and CLI-based request checks.
- `hono-rpc` for chained route typing and the end-to-end Hono RPC client contract.
- `hono-testing` for `app.request()`, `testClient()`, middleware, validation, and integration tests.
- `api-design-patterns` for REST resources, errors, security, pagination, versioning, response formats, and OpenAPI documentation.
- `better-auth-best-practices` for authentication configuration, adapters, sessions, hooks, plugins, and security.

When working in `packages/db`, use:

- `drizzle` for schemas, typed queries, relations, transactions, and performance patterns.
- `drizzle-migrations` for migration-first, forward-only database evolution.

HERMS architecture and roadmap documents override generic skill examples. Use Neon PostgreSQL through its HTTP/serverless driver, never a per-invocation pooled `pg` connection, and run migrations only as gated steps - not during Lambda cold starts. HERMS is Bun-only: translate `npm`, `npx`, `pnpm`, or `yarn` examples to `bun` or `bunx` and never create another package-manager lockfile.

## Hono CLI

When working in apps/api, use the project-local Hono CLI for focused context and testing:

- Search first with: bun run hono search <query> --limit 5 (JSON by default).
- Read only the selected page with: bun run hono docs <path>.
- Test routes in process with: bun run hono request apps/api/src/index.ts plus the required request flags.
- Do not add @hono/mcp unless an approved roadmap phase explicitly requires HERMS to host an MCP server.
