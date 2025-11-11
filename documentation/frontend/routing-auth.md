# Route Authentication and Protection

## Current State

**Status:** Implemented ✅

This document describes the authentication and authorization system for protecting routes in the ReadMeABook application, ensuring that only authenticated users can access protected pages.

## Design Architecture

### Why Route Protection?

**Security Requirements:**
- Prevent unauthenticated access to sensitive features
- Redirect unauthenticated users to login page
- Maintain intended destination after successful login
- Provide consistent authentication checking across all pages
- Support role-based access (user vs admin)

### Protection Strategy

**Client-Side Guards:**
- React components check authentication state
- Redirect to login if not authenticated
- Preserve original URL for post-login redirect
- Show loading state during auth check

**Server-Side Guards:**
- API routes validate JWT tokens
- Middleware enforces authentication
- Return 401/403 for unauthorized access

## Implementation Details

### Protected Route Component

```typescript
interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
}
```

The `ProtectedRoute` component wraps page content and:
1. Checks if user is authenticated (from AuthContext)
2. Optionally checks if user has admin role
3. Shows loading spinner while checking
4. Redirects to /login if unauthenticated
5. Redirects to / if admin required but user is not admin
6. Renders children if authorized

### Route Configuration

**Public Routes:**
```typescript
const PUBLIC_ROUTES = [
  '/login',
  '/setup',
  '/api/*', // API routes handle auth independently
];
```

**Protected Routes:**
```typescript
const PROTECTED_ROUTES = [
  '/',           // Homepage
  '/search',     // Search
  '/requests',   // User requests
  '/profile',    // User profile
];
```

**Admin Routes:**
```typescript
const ADMIN_ROUTES = [
  '/admin',          // Admin dashboard
  '/admin/users',    // User management
  '/admin/library',  // Library management
  '/admin/settings', // System settings
];
```

## Component Structure

### ProtectedRoute Component

```
src/components/auth/
└── ProtectedRoute.tsx    # Route protection wrapper
```

### Usage in Pages

```tsx
// Protected user page
export default function HomePage() {
  return (
    <ProtectedRoute>
      <Header />
      <main>
        {/* Page content */}
      </main>
    </ProtectedRoute>
  );
}

// Protected admin page
export default function AdminDashboard() {
  return (
    <ProtectedRoute requireAdmin>
      <AdminHeader />
      <main>
        {/* Admin content */}
      </main>
    </ProtectedRoute>
  );
}
```

## Tech Stack

**Framework:** Next.js 14+ App Router
**Authentication:** JWT tokens via AuthContext
**Routing:** Next.js navigation (useRouter, usePathname)
**State:** React Context API

## Dependencies

- AuthContext (src/contexts/AuthContext.tsx)
- Next.js router (next/navigation)
- Authentication middleware (src/lib/middleware/auth.ts)

## API Endpoint Protection

### Using Middleware

```typescript
import { requireAuth, requireAdmin } from '@/lib/middleware/auth';

// Protected endpoint
export async function GET(request: NextRequest) {
  return requireAuth(request, async (authenticatedRequest) => {
    // Request now has user property
    const userId = authenticatedRequest.user?.id;

    // Handle request...
    return NextResponse.json({ data: 'Protected data' });
  });
}

// Admin-only endpoint
export async function POST(request: NextRequest) {
  return requireAuth(request, async (authenticatedRequest) => {
    return requireAdmin(authenticatedRequest, async (adminRequest) => {
      // User is confirmed to be admin
      // Handle request...
      return NextResponse.json({ success: true });
    });
  });
}
```

## Authentication Flow

### Initial Page Load

```
1. Page component renders
   └─> ProtectedRoute wrapper checks authentication

2. AuthContext loading state
   └─> Show loading spinner

3. Check localStorage for tokens
   ├─> Tokens found: Verify with server
   └─> No tokens: Redirect to /login

4. Tokens valid
   ├─> Load user data
   ├─> Render page content
   └─> Set up token refresh timer
```

### Redirect After Login

```
1. User attempts to access /search while unauthenticated
   └─> Redirect to /login?redirect=/search

2. User completes login
   └─> Check for redirect parameter
   └─> Navigate to /search (or / if no redirect)

3. ProtectedRoute allows access
   └─> Render page content
```

## Token Management

### Access Token

**Lifetime:** 1 hour
**Storage:** localStorage
**Usage:** Included in all API requests
**Refresh:** Auto-refresh 5 minutes before expiration

### Refresh Token

**Lifetime:** 7 days
**Storage:** localStorage
**Usage:** Obtain new access token
**Rotation:** Optional (security enhancement)

### Auto-Refresh Logic

```typescript
useEffect(() => {
  if (!user) return;

  // Decode token to get expiration
  const tokenPayload = decodeToken(accessToken);
  const expiresAt = tokenPayload.exp * 1000; // Convert to ms
  const now = Date.now();
  const timeUntilExpiry = expiresAt - now;

  // Refresh 5 minutes before expiration
  const refreshTime = timeUntilExpiry - (5 * 60 * 1000);

  if (refreshTime > 0) {
    const timer = setTimeout(() => {
      refreshToken();
    }, refreshTime);

    return () => clearTimeout(timer);
  } else {
    // Token already expired or expires soon
    refreshToken();
  }
}, [accessToken, user]);
```

## Error Handling

### 401 Unauthorized

**Client Side:**
```typescript
// Interceptor for API calls
axios.interceptors.response.use(
  response => response,
  async error => {
    if (error.response?.status === 401) {
      // Try to refresh token
      try {
        await refreshToken();
        // Retry original request
        return axios(error.config);
      } catch {
        // Refresh failed, redirect to login
        logout();
        router.push('/login');
      }
    }
    return Promise.reject(error);
  }
);
```

### 403 Forbidden

**Insufficient Permissions:**
```typescript
if (requireAdmin && user?.role !== 'admin') {
  toast.error('Admin access required');
  router.push('/');
  return null;
}
```

## Security Considerations

### Token Security

- **Never log tokens** in console or error messages
- **HTTPS only** in production for all requests
- **HTTP-only cookies** for refresh tokens (future enhancement)
- **Short expiration** for access tokens (1 hour)
- **Token rotation** to prevent replay attacks

### XSS Protection

- Sanitize all user input
- Use Content Security Policy headers
- No `dangerouslySetInnerHTML` usage
- Validate and sanitize data from localStorage

### CSRF Protection

- SameSite cookie attributes
- CSRF tokens for state-changing operations
- Origin checking on server

## Performance

### Optimizations

- **Cache user data** in AuthContext (avoid repeated API calls)
- **Lazy loading** for admin routes
- **Prefetch** protected routes after login
- **Memoization** for expensive auth checks

## Accessibility

**Requirements:**
- Loading state announcements for screen readers
- Error messages clearly communicated
- Focus management during redirects
- Keyboard navigation support

**Implementation:**
```tsx
<div role="status" aria-live="polite">
  {isLoading && <span>Checking authentication...</span>}
  {error && <span>Authentication error: {error}</span>}
</div>
```

## Usage Examples

### Basic Protected Page

```tsx
'use client';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { Header } from '@/components/layout/Header';

export default function SearchPage() {
  return (
    <ProtectedRoute>
      <div>
        <Header />
        <main>
          <h1>Search Audiobooks</h1>
          {/* Page content */}
        </main>
      </div>
    </ProtectedRoute>
  );
}
```

### Admin Protected Page

```tsx
'use client';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AdminSidebar } from '@/components/admin/AdminSidebar';

export default function AdminDashboard() {
  return (
    <ProtectedRoute requireAdmin>
      <div className="flex">
        <AdminSidebar />
        <main>
          <h1>Admin Dashboard</h1>
          {/* Admin content */}
        </main>
      </div>
    </ProtectedRoute>
  );
}
```

### Protected API Route

```typescript
import { requireAuth } from '@/lib/middleware/auth';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req) => {
    const userId = req.user?.id;

    // Fetch user-specific data
    const data = await getUserData(userId);

    return NextResponse.json({ data });
  });
}
```

## Testing Strategy

### Unit Tests

- ProtectedRoute rendering logic
- Auth state checking
- Redirect behavior
- Admin role verification

### Integration Tests

- Full authentication flow
- Protected route access
- Unauthorized access attempts
- Token refresh behavior
- Logout and re-authentication

### E2E Tests

- Login → Access protected page
- Access protected page → Redirect to login → Login → Redirect back
- Admin access control
- Token expiration handling

## Known Issues

None currently.

## Future Enhancements

- **HTTP-only cookies**: Move refresh tokens to HTTP-only cookies for enhanced security
- **Token revocation**: Implement token blacklist for immediate invalidation
- **Session management**: View and revoke active sessions
- **Rate limiting**: Prevent brute force attacks on auth endpoints
- **2FA support**: Optional two-factor authentication for admin users
- **Remember me**: Extended sessions for trusted devices
- **Single sign-on**: Support for SSO providers
