# Phase 0 deployment seams

Phase 0 keeps application code independent from account-specific values. No
database URL, AWS identifier, domain, host, or credential is committed.

## Local verification

1. Copy `.env.example` to `.env`.
2. Configure `DATABASE_URL` with the Neon pooled runtime URL.
3. Configure `MIGRATION_DATABASE_URL` with the direct Neon migration URL.
4. Run `bun install`.
5. Run `bun run db:migrate`.
6. Run `bun run db:seed`.
7. Run `bun run typecheck && bun test && bun run build`.
8. Start the API with `bun run dev:api`.
9. Start the frontend with `bun run dev:web`.
10. Open `http://localhost:3000` and confirm the health card is green.

The migration command is an explicit gated operation. Neither the API entrypoint
nor a Lambda cold start runs migrations.

## GitHub environments

Create these protected GitHub environments before enabling deployments:

### `phase-0-migrations`

- Secret: `MIGRATION_DATABASE_URL`
- Configure required reviewers so migration execution is a human gate.

### `production-api`

- Variable: `AWS_REGION`
- Variable: `AWS_STACK_NAME`
- Secret: `AWS_DEPLOY_ROLE_ARN`
- Secret: `DATABASE_URL`

The AWS role should be assumed through GitHub OIDC. Do not create permanent AWS
access-key secrets for this workflow.

### `production-vps`

- Variable: `VPS_HOST`
- Variable: `VPS_USER`
- Variable: `VPS_WEB_ROOT` (recommended: `/var/www/herms`)
- Secret: `VPS_SSH_PRIVATE_KEY`
- Secret: `VPS_KNOWN_HOSTS`

## AWS

`infra/aws/template.yaml` defines the Node.js 22 Lambda Function URL. Its
database URL is a no-echo deployment parameter. The API timeout defaults to
20 seconds.

After AWS details are available:

1. Configure the OIDC deployment role and GitHub environment values.
2. Run the API deployment workflow.
3. Record the Function URL host without the `https://` prefix.
4. Use that host when preparing the Nginx configuration.
5. Confirm the public Function URL boundary is monitored. Authentication and
   business-route authorization arrive in their roadmap phases.

## Nginx

Copy `infra/nginx/herms.conf.example` to the VPS and replace:

- `__HERMS_DOMAIN__`
- `__LAMBDA_FUNCTION_URL_HOST__`

The template serves `apps/web/dist/client` through the workflow's
`/var/www/herms/current` symlink, proxies `/api/*` to Lambda, forwards
`X-Request-ID`, and uses a 25-second proxy timeout so it exceeds the Lambda
timeout.

Validate before reload:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

## Deployment smoke test

Once AWS, VPS, and domain values are configured:

1. Push an approved commit to `main`.
2. Approve the migration environment.
3. Confirm the API and web workflows succeed.
4. Open `https://<domain>` in a real browser.
5. Confirm the health card is green and shows a database round-trip duration.
6. Confirm the response includes `X-Request-ID`.
7. Record cold and warm request durations against the three-second baseline.

The browser-to-Nginx-to-Lambda smoke test remains pending until the hosting
values are supplied.
