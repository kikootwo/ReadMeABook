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
7. **Verify user has access to configured Plex server** (security check)
8. Create/update user in DB
9. Generate JWT
10. Return JWT to client
11. Client includes JWT in subsequent requests

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

- First user created during setup automatically promoted to admin
- Marked as "setup admin" with `isSetupAdmin=true` flag
- Setup admin role is **protected** - cannot be changed to prevent lockout
- Ensures someone always has admin access after fresh install
- Subsequent users default to 'user' role
- Local admin uses username/password authentication (stored in `authToken` field as bcrypt hash)
- `plexId` format: `local-{username}` for local admin accounts

## Local Admin Authentication

**Local Admin (Setup Admin):**
- Created during setup wizard (step 2)
- Username/password authentication (separate from Plex OAuth)
- Password hashed with bcrypt (10 rounds) and stored in `authToken` field
- Login: POST `/api/auth/admin/login` with username/password
- Identified by: `isSetupAdmin=true` AND `plexId` starts with `local-`

**Password Management:**
- POST `/api/admin/settings/change-password` - Change local admin password
- Requires: current password, new password (min 8 chars), confirmation
- Security: Only accessible to local admin (verified via `requireLocalAdmin` middleware)
- Validates current password before allowing change

## Security

- Never log tokens
- HTTPS only in production
- Short access token expiry (1hr)
- Optional refresh token rotation
- Track valid tokens for revocation
- **Server access verification**: Only users with access to the configured Plex server can authenticate (prevents any Plex user from accessing the instance)

## Tech Stack

- Custom Plex OAuth (direct API)
- jsonwebtoken (npm)
- Node.js crypto
