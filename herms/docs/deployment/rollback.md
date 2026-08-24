# Phase 0 rollback procedure

Rollback never runs a down migration. HERMS migrations are forward-only; a
schema correction is a new migration.

## Web rollback

Each deployment uploads an immutable directory under
`/var/www/herms/releases/<commit>` and switches the `current` symlink.

1. List the release directories and identify the last known-good commit.
2. Point `/var/www/herms/current` to that release with `ln -sfn`.
3. Open the site and verify `/api/health`.
4. Preserve the failed release for diagnosis.

## API rollback

1. Identify the last known-good Git commit and its successful workflow run.
2. Re-run the API deployment workflow from that commit, or revert the faulty
   commit with a new commit and deploy it.
3. Do not attempt to reverse an already-applied migration.
4. If the older API is incompatible with a forward migration, deploy a
   compatibility fix instead of rolling the schema backward.
5. Verify the Lambda Function URL health endpoint directly.
6. Verify the same endpoint through Nginx and the browser health card.

## Evidence required before Phase 0 completion

- Previous and replacement commit identifiers.
- Web symlink target before and after rollback.
- Lambda deployment workflow run.
- Direct and same-origin health responses.
- Cold and warm database round-trip measurements.

The procedure is written and locally reviewable. Its production rehearsal is
pending until AWS and VPS access are provided.
