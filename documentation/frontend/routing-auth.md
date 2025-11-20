# Route Authentication and Protection

**Status:** ✅ Implemented | Token expiry validation, auto-refresh, 401 handling

Authentication and authorization system protecting routes, ensuring only authenticated users can access protected pages.

## Protection Strategy

**Client-Side:** React components check auth state, redirect to login if needed, preserve original URL
**Server-Side:** API routes validate JWT tokens via middleware, return 401/403 for unauthorized

## Routes

**Public:** `/login`, `/setup`, `/api/*` (handle auth independently)
**Protected:** `/` (home), `/search`, `/requests`, `/profile`
**Admin:** `/admin/*` - requires admin role

## ProtectedRoute Component

**Location:** `src/components/auth/ProtectedRoute.tsx`

**Behavior:**
1. Check auth state from AuthContext
2. Optionally check admin role
3. Show loading spinner while checking
4. Redirect to `/login` if unauthenticated
5. Redirect to `/` if admin required but not admin
6. Render children if authorized

## API Middleware

**Location:** `src/lib/middleware/auth.ts`

**Server-side validation:**
- `requireAuth()` - validates JWT, adds user to request
- `requireAdmin()` - checks admin role, chains after requireAuth
- Returns 401 for invalid/expired tokens
- Returns 403 for insufficient permissions

## Token Management

**Location:** `src/contexts/AuthContext.tsx`, `src/lib/utils/jwt-client.ts`

**Token Validation on Mount:**
- Decodes access token to check expiry
- If expired but refresh token valid → auto-refresh
- If both expired → clear storage, redirect to login
- Cross-tab logout sync via storage events

**Auto-Refresh (5 mins before expiry):**
```typescript
const refreshTimeMs = getRefreshTimeMs(token);
setTimeout(() => refreshToken(), refreshTimeMs);
```

**Schedule:**
- After login → schedule first refresh
- After token refresh → schedule next refresh
- Cleanup on logout or unmount

## API Client with 401 Handling

**Location:** `src/lib/utils/api.ts`

**fetchWithAuth():**
- Adds Authorization header automatically
- Catches 401 responses
- Attempts token refresh once
- Retries original request with new token
- Logs out if refresh fails
- Prevents duplicate refresh requests

**Usage:**
```typescript
// In hooks/components
import { fetchWithAuth, fetchJSON } from '@/lib/utils/api';

// GET request
const response = await fetchWithAuth('/api/requests');

// POST with JSON
const data = await fetchJSON('/api/requests', {
  method: 'POST',
  body: JSON.stringify({ audiobook }),
});
```

## Error Handling

**401 Unauthorized:**
1. Attempt token refresh automatically
2. Retry original request with new token
3. If still 401 or refresh fails → logout (clears storage + redirects to /login)

**403 Forbidden:**
- Valid token but insufficient permissions
- Return error, don't logout

## Logout Behavior

**Global redirect on logout:**
- `logout()` from AuthContext → clears storage + redirects to /login
- API 401 errors → `performLogout()` → clears storage + redirects to /login
- Cross-tab logout → storage event triggers redirect to /login
- Ensures user never remains on authenticated pages after logout

## Cross-Tab Sync

**Storage Events:**
- Logout in one tab → logout + redirect to login in all tabs
- Login in one tab → sync auth state to all tabs
- Prevents stale sessions across browser tabs

## Security

- Never log tokens
- HTTPS only in production
- Short access token expiry (1hr)
- Auto-refresh 5 mins before expiry
- Token expiry validation on mount
- Prevent duplicate refresh requests
- SameSite cookies for CSRF protection
- Client-side token decode (signature verified server-side only)

## Fixed Issues

- **Expired tokens not logging out:** Added token expiry validation on mount
- **No auto-refresh:** Scheduled refresh 5 mins before token expires
- **401 errors not handled:** Added global 401 interceptor with token refresh
- **Logged-out sessions persisting:** Token validation clears expired sessions immediately
- **Logout not redirecting:** Added automatic redirect to /login on all logout scenarios (manual, API 401, cross-tab)

## Tech Stack

- Next.js 14+ App Router
- JWT via AuthContext
- React Context API
- Custom fetch wrapper for 401 handling
