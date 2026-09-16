# Phase 0 deployment seams

Phase 0 keeps application code independent from account-specific values. No
database URL, AWS identifier, domain, host, or credential is committed.

## Current operating model

Staging is deferred until the team is larger and a subdomain exists. Until then
HERMS is **production-only with approval**.

AWS and the public domain are not set up yet. Until they exist:

| Can do now | Cannot do yet |
|---|---|
| Run CI on every pull request and on `main` / `develop` | Deploy to Hostinger |
| Block bad code with typecheck, tests, migration check, and build | Deploy to AWS Lambda |
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

## What to do when AWS and the domain exist

Do this in order. Do not enable auto-deploy on the first attempt.

1. Create the GitHub environments and required reviewers above.
2. Configure AWS OIDC for GitHub Actions and the Lambda stack values.
3. Configure Neon runtime and migration URLs as environment secrets.
4. Put the Hostinger VPS host, user, web root, SSH key, and known hosts in
   `production-vps`.
5. Copy `infra/nginx/herms.conf.example` to the VPS and replace
   `__HERMS_DOMAIN__` and `__LAMBDA_FUNCTION_URL_HOST__`.
6. From GitHub Actions, run **Deploy HERMS API** against `main`, approve
   migration, then confirm the Lambda Function URL.
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

`infra/aws/template.yaml` defines the Node.js 22 Lambda Function URL. Its
database URL is a no-echo deployment parameter. The API timeout defaults to
20 seconds.

After AWS details are available:

1. Configure the OIDC deployment role and GitHub environment values.
2. Run the API deployment workflow from `main`.
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
