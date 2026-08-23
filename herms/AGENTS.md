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

## Hono CLI

When working in apps/api, use the project-local Hono CLI for focused context and testing:

- Search first with: bun run hono search <query> --limit 5 (JSON by default).
- Read only the selected page with: bun run hono docs <path>.
- Test routes in process with: bun run hono request apps/api/src/index.ts plus the required request flags.
- Do not add @hono/mcp unless an approved roadmap phase explicitly requires HERMS to host an MCP server.
