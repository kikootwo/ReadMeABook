# Authentication Service

**Status:** ❌ Design Phase

Handles authentication and authorization: Plex OAuth integration, JWT session management, role-based access control.

## Authentication: Plex OAuth

- No password management needed
- Users already have Plex accounts
- Seamless integration
- Automatic profile pictures/metadata

## Session Management: JWT Tokens

- Stateless authentication
- No server-side session storage
- Easy horizontal scaling
- Includes user claims (role, permissions)

## Access Control: RBAC

**Roles:**
1. **user** - Request audiobooks, view own requests, search
2. **admin** - Full system access (settings, users, all requests)

## OAuth Flow

1. User clicks "Login with Plex"
2. Redirect to Plex OAuth
3. User authorizes app
4. Redirect back with code
5. Exchange code for token
6. Get Plex user info
7. Create/update user in DB
8. Generate JWT
9. Return JWT to client
10. Client includes JWT in subsequent requests

## OAuth Endpoints

**GET /api/auth/plex/login** - Redirect to Plex OAuth
**GET /api/auth/plex/callback?code=...** - Exchange code, return JWT + user info
**POST /api/auth/refresh** - Get new access token (refresh token in header)
**POST /api/auth/logout** - Clear client-side token
**GET /api/auth/me** - Get current user (JWT in header)

## JWT Structure

**Access Token (1hr):**
```json
{
  "sub": "user-uuid",
  "plexId": "plex-user-id",
  "username": "john_doe",
  "role": "admin",
  "iat": 1234567890,
  "exp": 1234571490
}
```

**Refresh Token (7d):**
```json
{
  "sub": "user-uuid",
  "type": "refresh",
  "iat": 1234567890,
  "exp": 1234971490
}
```

**Storage:**
- Access: HTTP-only cookie + localStorage
- Refresh: HTTP-only secure cookie only
- SameSite=Strict (CSRF protection)

## Middleware

**requireAuth()** - Verifies JWT exists/valid, adds user to request, returns 401 if invalid
**requireAdmin()** - Checks `user.role === 'admin'`, returns 403 if not, chains after requireAuth

## First User Setup

- First user authenticating automatically promoted to admin
- Ensures someone can access admin panel after fresh install
- Subsequent users default to 'user' role

## Security

- Never log tokens
- HTTPS only in production
- Short access token expiry (1hr)
- Optional refresh token rotation
- Track valid tokens for revocation

## Tech Stack

- Custom Plex OAuth (direct API)
- jsonwebtoken (npm)
- Node.js crypto
