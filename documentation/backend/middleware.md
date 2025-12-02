# Setup Middleware

**Status:** ✅ Implemented | Edge middleware enforcing setup wizard completion

## Overview
Edge runtime middleware intercepts all non-API requests to gate access until the setup wizard finishes. It uses a lightweight API check so Prisma is never invoked inside the Edge sandbox.

## Key Details
- **Location:** `src/middleware.ts`
- Skips: `/api/*`, `/_next/*`, `/static/*`, any path containing `.` (static assets)
- Fetches `/api/setup/status` with header `x-middleware-request: true`
- Redirects:
  - Setup incomplete → `/setup` (unless already there)
  - Setup complete → `/` when user visits `/setup`
- Fetch origin priority:
  1. `SETUP_CHECK_BASE_URL` env (optional override, e.g. `http://rmab-internal:3030`)
  2. Incoming request origin (`request.nextUrl.origin`)
  3. Loopback fallback `http://127.0.0.1:${PORT|3030}`
- On repeated failures the middleware logs once per request but allows traffic to avoid blocking users

## API/Interfaces
```
GET /api/setup/status
Headers: x-middleware-request: true
Response: { setupComplete: boolean }
```

## Critical Issues
- Reverse proxies that terminate TLS on a hostname unreachable from inside the container should set `SETUP_CHECK_BASE_URL` to an internal origin (or rely on the loopback fallback if port exposure allows it).
- Ensure the fallback port stays in sync with the app server port (`PORT` env, defaults to 3030 in Docker images).

## Related
- [documentation/setup-wizard.md](../setup-wizard.md)
- [documentation/deployment/unified.md](../deployment/unified.md)
