<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@tanstack/cli#query-docs-library-metadata"
    run: "bunx @tanstack/intent@latest load @tanstack/cli#query-docs-library-metadata"
    for: "Retrieve machine-readable context with tanstack libraries, tanstack doc, tanstack search-docs, tanstack create --list-add-ons --json, and --addon-details for agent-safe discovery and preflight validation."
<!-- intent-skills:end -->

## Hono CLI

When working in apps/api, use the project-local Hono CLI for focused context and testing:

- Search first with: bun run hono search <query> --limit 5 (JSON by default).
- Read only the selected page with: bun run hono docs <path>.
- Test routes in process with: bun run hono request apps/api/src/index.ts plus the required request flags.
- Do not add @hono/mcp unless an approved roadmap phase explicitly requires HERMS to host an MCP server.
