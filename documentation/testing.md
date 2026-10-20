# Testing

**Status:** ƒ?3 In Progress | Backend + frontend unit testing framework (Vitest)

## Overview
Backend unit tests (Node) and frontend component tests (jsdom) with isolated mocks and deterministic helpers.

## Key Details
- **Runner:** Vitest (`vitest.config.ts`)
- **Environments:** Node for `*.test.ts`, jsdom for `*.test.tsx` via `environmentMatchGlobs`
- **Setup:** `tests/setup.ts` sets `NODE_ENV=test`, `TZ=UTC`, jest-dom, DOM polyfills, Next.js `Link/Image` mocks
- **Frontend helpers:** `tests/helpers/render.tsx`, `tests/helpers/mock-auth.ts`, `tests/helpers/mock-next-navigation.ts`
- **Backend helpers:** `tests/helpers/prisma.ts`, `tests/helpers/job-queue.ts`
- **GitHub Actions (3 workflows, see [deployment/ci-workflows.md](deployment/ci-workflows.md)):**
  - `.github/workflows/pr-ci.yml` (PR Tests): every `pull_request`: `npm ci`, `npx prisma generate`, ffmpeg install, `npm test`
  - `.github/workflows/run-tests.yml` (Backend Tests): manual dispatch + `workflow_call`; runs `npm test`
  - `.github/workflows/build-unified-image.yml`: `v*` tags / manual dispatch; calls run-tests, then builds the unified image; publishes only on `v*` tags (a branch dispatch is a no-publish build)
- **E2E harness (local, not in CI):** `npm run e2e` (disposable Docker stack, Playwright in a container), `npm run e2e:unit` (offline containerized unit suite), `npm run e2e:selftest`. See [testing/e2e-harness.md](testing/e2e-harness.md)
- **Coverage:** `npm run test:coverage` (reports in `coverage/`)
- **Scope:** Unit tests only; no real network or services. End-to-end: [testing/e2e-harness.md](testing/e2e-harness.md)

## API/Interfaces
```
npm run test
npm run test:watch
npm run test:coverage
```

## Critical Issues
- Frontend coverage not yet enforced; expand component/page tests before adding coverage gates.

## Related
- [testing/e2e-harness.md](testing/e2e-harness.md)
- [frontend/components.md](frontend/components.md)
- [frontend/routing-auth.md](frontend/routing-auth.md)
- [backend/services/jobs.md](backend/services/jobs.md)
- [backend/services/scheduler.md](backend/services/scheduler.md)
