# CI Workflows (GitHub Actions)

**Status:** ✅ Implemented | Unit tests on PRs; image built and published from `v*` tags only

## Overview
Three workflows in `.github/workflows/`. No workflow builds the Docker image on `pull_request` (multi-arch build is ~40 min; runner minutes are kept for releases).

## Workflows
| File | Triggers | Does | Token |
|---|---|---|---|
| `pr-ci.yml` (PR Tests) | every `pull_request` | `npm ci`, `prisma generate`, ffmpeg, `npm test` | `contents: read` |
| `run-tests.yml` (Backend Tests) | `workflow_dispatch`, `workflow_call` | `npm test`, parses results, optional Discord post (skipped when `WEBHOOK_URL` is empty) | `contents: read` |
| `build-unified-image.yml` | `v*` tag push, `workflow_dispatch` | `test` (run-tests) → `build-and-push` | top `contents: read`; `build-and-push` adds `packages: write` |

## build-unified-image.yml
- **Publish condition:** `startsWith(github.ref, 'refs/tags/v')`, i.e. a `v*` tag push or a dispatch run on a tag.
- **Tag runs only:** ghcr login, `push`, `cache-to: type=gha,mode=max`, `DOCKER_BUILD_SUMMARY`, deployment-instructions summary, image Discord post.
- **Manual dispatch on a branch (main included):** no-publish build. Runs tests, builds linux/amd64 + linux/arm64, reads the GHA cache; pushes nothing, writes no cache, posts no image notice. Use it to check a build change before tagging.
- **Always:** `needs: test`, `cache-from: type=gha`, `DOCKER_BUILD_RECORD_UPLOAD: false`, build args `APP_VERSION`/`GIT_COMMIT`/`BUILD_DATE`, no concurrency group.
- **Image tags (metadata-action):** semver `{{version}}`/`{{major}}.{{minor}}`/`{{major}}`, `sha-<short>`, `latest` via flavor `latest=auto` on semver tags. `type=ref,event=branch|pr` rules remain but only label branch builds, which never push.
- **Secrets:** `WEBHOOK_URL` passed explicitly to run-tests and used by the image Discord step; no `secrets: inherit`.

## Action pins
- Every external action: `uses: owner/repo@<40-hex sha> # vX.Y.Z`. Dependabot (`github-actions`, weekly, minor/patch grouped) reads the version comment and bumps SHA + comment together.
- Current: checkout v7.0.1, setup-node v7.1.0, setup-buildx v4.4.1, login v4.6.0, metadata v6.2.0, build-push v7.4.0.
- Re-pinning by hand: `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`; confirm it equals the moving major tag and `commit.verification.verified` is true.
- Every checkout sets `persist-credentials: false` (no step needs git credentials).

## Related: [unified.md](unified.md), [../testing.md](../testing.md)
