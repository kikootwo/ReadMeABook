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
- **GitHub Actions:** `.github/workflows/run-tests.yml` (manual dispatch, also called by the release image build) runs `npm test`; `.github/workflows/pr-ci.yml` runs on every `pull_request` (`npm ci`, `npx prisma generate`, ffmpeg install, `npm test`)
- **Coverage:** `npm run test:coverage` (reports in `coverage/`)
- **Scope:** Unit tests only; no real network or services

## API/Interfaces
```
npm run test
npm run test:watch
npm run test:coverage
```

## Critical Issues
- Frontend coverage not yet enforced; expand component/page tests before adding coverage gates.

## Related
- [frontend/components.md](frontend/components.md)
- [frontend/routing-auth.md](frontend/routing-auth.md)
- [backend/services/jobs.md](backend/services/jobs.md)
- [backend/services/scheduler.md](backend/services/scheduler.md)
