# Phase 0 deployment seams

Phase 0 keeps application code independent from account-specific values. No
database URL, AWS identifier, domain, host, or credential is committed.

## Current operating model

Staging is deferred until the team is larger and a subdomain exists. Until then
HERMS is **production-only with approval**.

The base Lambda, execution role, CloudWatch log group, budget, and IAM access
are managed manually. Deployment remains blocked until GitHub OIDC, production
environment values, the Function URL, and the Hostinger domain are verified.

| Can do now | Cannot do yet |
|---|---|
| Run CI on every pull request and on `main` / `develop` | Deploy to Hostinger |
| Block bad code with typecheck, tests, migration check, and build | Deploy code to the existing AWS Lambda |
| Keep production deploy workflows ready, manual, `main`-only | Browser smoke test against a live URL |
| Work and verify on `localhost` | Automatic deploy on merge to `main` |

Do not run the deploy workflows from `test-scenarios` or other feature
branches. They will fail on purpose.

When AWS and the domain exist, keep this same production-only model. Add
staging later; do not invent a staging subdomain now.

## Branch rules

```
feature branch (test-scenarios, loginprivilage, fix/...)
    → pull request
    → CI must pass
    → merge to develop or main
```

| Branch | Purpose | Deploy |
|---|---|---|
| Feature branches | Daily work | Never |
| `develop` | Integration | Never, until staging exists |
| `main` | Production | Manual deploy after CI, then GitHub environment approval |

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

## CI (available now)

`.github/workflows/quality.yml` runs on:

- every pull request that touches `herms/` or workflows
- every push to `main` or `develop`

It runs `bun run typecheck`, `bun test`, `bun run db:check`, and `bun run build`.
Pushes to `main` also store web and API build artifacts for 14 days.

Turn this into a merge gate in GitHub:

1. Repo **Settings → Rules → Rulesets** (or **Settings → Branches**).
2. Protect `main`.
3. Require a pull request before merging.
4. Require the status check `HERMS quality / verify`.
5. Repeat for `develop` if that branch should also stay green.

Until those rules are enabled, CI still runs, but GitHub will allow a red PR
to merge.

## GitHub environments

Create these protected GitHub environments before the first real deploy. They
are the production approval gate.

### `phase-0-migrations`

- Secret: `MIGRATION_DATABASE_URL`
- Configure required reviewers so migration execution is a human gate.

### `production-api`

- Variable: `AWS_REGION`
- Variable: `API_FUNCTION_NAME`
- Variable: `API_HEALTH_URL`
- Secret: `AWS_DEPLOY_ROLE_ARN`

The AWS role should be assumed through GitHub OIDC. Do not create permanent AWS
access-key secrets for this workflow. Runtime secrets stay in the manually
configured Lambda environment and are not copied into GitHub.

### `production-vps`

- Variable: `VPS_HOST`
- Variable: `VPS_USER`
- Variable: `VPS_WEB_ROOT` (recommended: `/var/www/herms`)
- Secret: `VPS_SSH_PRIVATE_KEY`
- Secret: `VPS_KNOWN_HOSTS`

## What to do when AWS and the domain exist

Do this in order. Do not enable auto-deploy on the first attempt.

1. Create the GitHub environments and required reviewers above.
2. Configure AWS OIDC for GitHub Actions with code-update permission on only
   the existing `herms-api` Lambda.
3. Configure the Neon migration URL in GitHub. Keep the pooled runtime URL and
   application secrets in the manually configured Lambda environment.
4. Put the Hostinger VPS host, user, web root, SSH key, and known hosts in
   `production-vps`.
5. Copy `infra/nginx/herms.conf.example` to the VPS and replace
   `__HERMS_DOMAIN__` and `__LAMBDA_FUNCTION_URL_HOST__`.
6. From GitHub Actions, run **Deploy HERMS API** against `main`, approve the
   migration, and confirm the existing Lambda Function URL health check.
7. From GitHub Actions, run **Deploy HERMS web** against `main`.
8. Open `https://<domain>`, confirm the health card is green, and confirm
   `X-Request-ID`.
9. Record cold and warm request durations against the three-second baseline.
10. Only after that smoke test passes, add `push: branches: [main]` to the two
    deploy workflows if automatic production deploys are wanted.

The deploy workflows stay `workflow_dispatch` until that last step. If they are
run before AWS or the VPS values exist, they fail with a clear configuration
error instead of a cryptic cloud error.

## AWS

AWS resources are manually managed. See `infra/aws/README.md` for the required
Lambda configuration and GitHub deployment contract. The API workflow builds
`apps/api/dist/lambda.js` and updates only the code of the existing `herms-api`
function; it does not create or change AWS resources.

Before the first API deployment:

1. Confirm the handler is `lambda.handler`, the runtime is Node.js 22, and the
   architecture is ARM64.
2. Configure Lambda environment variables and the Function URL manually.
3. Configure the least-privilege GitHub OIDC role and environment values.
4. Run the API deployment workflow from `main`.
5. Record the Function URL host without the `https://` prefix.
6. Use that host when preparing the Nginx configuration.
7. Confirm the public Function URL boundary is monitored and concurrency is
   capped.

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

1. Merge an approved commit to `main`.
2. Manually run the API workflow from `main` and approve the migration
   environment.
3. Manually run the web workflow from `main` and confirm both workflows succeed.
4. Open `https://<domain>` in a real browser.
5. Confirm the health card is green and shows a database round-trip duration.
6. Confirm the response includes `X-Request-ID`.
7. Record cold and warm request durations against the three-second baseline.

The browser-to-Nginx-to-Lambda smoke test remains pending until the hosting
values are supplied.
