# Route Authentication and Protection

**Status:** ✅ Implemented

Authentication and authorization system protecting routes, ensuring only authenticated users can access protected pages.

## Protection Strategy

**Client-Side:** React components check auth state, redirect to login if needed, preserve original URL
**Server-Side:** API routes validate JWT tokens via middleware, return 401/403 for unauthorized

## Routes

**Public:** `/login`, `/setup`, `/api/*` (handle auth independently)
**Protected:** `/` (home), `/search`, `/requests`, `/profile`
**Admin:** `/admin/*` - requires admin role

## ProtectedRoute Component

```typescript
interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
}
```

**Behavior:**
1. Check auth state from AuthContext
2. Optionally check admin role
3. Show loading spinner while checking
4. Redirect to `/login` if unauthenticated
5. Redirect to `/` if admin required but not admin
6. Render children if authorized

## API Middleware

```typescript
// Any authenticated user
requireAuth(request, async (req) => {
  const userId = req.user?.id;
  // ... handler
});

// Admin only
requireAuth(request, async (req) => {
  return requireAdmin(req, async (adminReq) => {
    // ... admin handler
  });
});
```

## Token Management

**Access Token:** 1hr lifetime, localStorage, auto-refresh 5 mins before expiry
**Refresh Token:** 7 days, localStorage

**Auto-Refresh:**
```typescript
const expiresAt = tokenPayload.exp * 1000;
const refreshTime = expiresAt - Date.now() - (5 * 60 * 1000);
setTimeout(() => refreshToken(), refreshTime);
```

## Error Handling

**401 Unauthorized:**
- Try refresh token
- On success: retry original request
- On failure: logout, redirect to login

**403 Forbidden:**
- Valid token but insufficient permissions
- Show error, redirect to home

## Security

- Never log tokens
- HTTPS only in production
- Short access token expiry
- SameSite cookies for CSRF protection
- Validate JWT structure before parsing

## Tech Stack

- Next.js 14+ App Router
- JWT via AuthContext
- React Context API
