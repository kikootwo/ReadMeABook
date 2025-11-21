# Authentication Service

**Status:** ✅ Implemented | Plex OAuth + Plex Home profile support + JWT sessions + RBAC

Handles authentication and authorization: Plex OAuth integration with Plex Home profile support, JWT session management, role-based access control.

## Authentication: Plex OAuth

- No password management needed
- Users already have Plex accounts
- Seamless integration
- Automatic profile pictures/metadata
- **Plex Home support:** Each profile = separate user

## Session Management: JWT Tokens

- Stateless authentication
- No server-side session storage
- Easy horizontal scaling
- Includes user claims (role, permissions)

## Access Control: RBAC

**Roles:**
1. **user** - Request audiobooks, view own requests, search
2. **admin** - Full system access (settings, users, all requests)

## OAuth Flow (with Plex Home Support)

1. User clicks "Login with Plex"
2. Redirect to Plex OAuth
3. User authorizes app
4. Redirect back with PIN code
5. Exchange code for main account token
6. Get main account user info
7. **Verify user has access to configured Plex server** (uses stored machineIdentifier from config)
8. **Check for Plex Home profiles:**
   - If profiles exist → Redirect to profile selection page
   - If no profiles → Continue with main account
9. **Profile Selection (if applicable):**
   - User selects profile from grid
   - Enter PIN if profile is protected
   - Switch to profile, get profile's auth token
10. Create/update user in DB (with profile details)
11. Generate JWT
12. Return JWT to client
13. Client includes JWT in subsequent requests

## OAuth Endpoints

**GET /api/auth/plex/login** - Redirect to Plex OAuth
**GET /api/auth/plex/callback?pinId=...** - Exchange PIN, check for profiles, return JWT or redirect to profile selection
**GET /api/auth/plex/home-users** - Get list of Plex Home profiles (requires X-Plex-Token header)
**POST /api/auth/plex/switch-profile** - Switch to selected profile and complete authentication
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

## Plex Home Profile Support

**Overview:**
- Plex Home accounts can have multiple profiles (managed users, family members)
- Each profile has its own library ratings, watch history, restrictions
- **Architecture:** Each profile = separate user in ReadMeABook system

**Profile Selection Flow:**
1. User authenticates with main Plex account
2. System fetches list of profiles via `GET https://plex.tv/api/home/users`
3. If profiles exist → Show profile selection page (`/auth/select-profile`)
4. User selects their profile (enters PIN if protected)
5. System switches to profile via `POST https://plex.tv/api/home/users/{id}/switch`
6. Profile's auth token is stored (encrypted)
7. User record created with profile's details

**Profile Data Storage:**
- `plexId`: Profile's unique ID (not main account ID)
- `plexUsername`: Profile's friendlyName
- `authToken`: Profile's auth token (encrypted)
- `avatarUrl`: Profile's avatar
- `plexHomeUserId`: Profile ID for reference (null = main account, set = home profile)

**User Isolation:**
- Each profile is a completely separate user
- Separate requests, separate BookDate recommendations, separate ratings
- Admin sees all profiles as independent users (no grouping)
- Profile switching = logout and login again

**Profile Protection:**
- Protected profiles require PIN on login
- PIN validated by Plex API during switch
- PIN not stored (only needed at login)

**Benefits:**
- Accurate request attribution ("Requested by Dad" vs "Requested by Kids")
- Personalized BookDate recommendations based on each profile's ratings
- Separate "My Requests" per family member
- Accurate logs and analytics

## Security

- Never log tokens
- HTTPS only in production
- Short access token expiry (1hr)
- Optional refresh token rotation
- Track valid tokens for revocation
- **Server access verification**: Uses stored `machineIdentifier` from config (no API call needed)
  - Only users with access to the configured Plex server can authenticate
  - Prevents any Plex user from accessing the instance
  - machineIdentifier stored during setup/settings configuration (architectural optimization)

## Tech Stack

- Custom Plex OAuth (direct API)
- jsonwebtoken (npm)
- Node.js crypto
