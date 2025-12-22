# Authentication Service

**Status:** ✅ Implemented | Plex OAuth + OIDC + Plex Home + Local Admin + JWT + RBAC

Handles authentication and authorization: Multiple auth providers (Plex OAuth, OIDC, Local Admin), Plex Home profile support, JWT session management, comprehensive access control, role-based authorization.

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

## OIDC Authentication (Audiobookshelf Mode)

**Status:** ✅ Implemented | OpenID Connect support with comprehensive access control and admin role mapping

### OIDC Provider Configuration
- **Provider Name**: Display name for login button (e.g., "Authentik", "Keycloak")
- **Issuer URL**: OIDC provider's issuer URL (must support `.well-known/openid-configuration`)
- **Client ID/Secret**: OAuth2 credentials from OIDC provider
- **Required Scopes**: `openid`, `profile`, `email`, `groups`
- **Redirect URI**: `{BASE_URL}/api/auth/oidc/callback`

### Access Control Methods
Controls who can log in to the application (separate from admin role assignment):

**1. Open Access (`open`)**
- Anyone who can authenticate with OIDC provider has access
- No additional restrictions
- Default: Suitable for trusted internal providers

**2. Group/Claim Based (`group_claim`)**
- Requires specific group/claim value for access
- Config: `oidc.access_group_claim` (default: `groups`)
- Config: `oidc.access_group_value` (required group name)
- Example: Only users in "readmeabook-users" group can log in

**3. Allowed List (`allowed_list`)**
- Whitelist of specific emails and/or usernames
- Config: `oidc.allowed_emails` (JSON array)
- Config: `oidc.allowed_usernames` (JSON array)
- Example: `["user1@example.com", "user2@example.com"]`

**4. Admin Approval (`admin_approval`)**
- New users created in "pending_approval" state
- Admin must approve/reject users before they can access
- Pending users visible in admin settings

### Admin Role Mapping
Automatically grants admin permissions based on OIDC claims (e.g., group membership):

**Configuration:**
- `oidc.admin_claim_enabled` = `'true'` | `'false'` (default: `'false'`)
- `oidc.admin_claim_name` = claim field to check (default: `'groups'`)
- `oidc.admin_claim_value` = required value for admin role (e.g., `'readmeabook-admin'`)

**Behavior:**
- First OIDC user always becomes admin (regardless of claim settings)
- Subsequent users checked against admin claim if enabled
- If claim matches → granted admin role
- If claim doesn't match → granted user role
- Claim check occurs on every login (role can be updated dynamically)

**Example:**
- Authentik group: Create `readmeabook-admin` group
- Add users to group
- Configure: `oidc.admin_claim_value = 'readmeabook-admin'`
- Users in group get admin role on login

### OIDC Endpoints
- **GET /api/auth/oidc/login** - Initiate OIDC flow, redirect to provider
- **GET /api/auth/oidc/callback** - Handle OAuth callback, create/update user, return JWT
- **GET /api/auth/providers** - List enabled auth providers for login page

### Configuration Keys
```
oidc.enabled                 = 'true' | 'false'
oidc.provider_name           = 'Authentik' (display name)
oidc.issuer_url              = 'https://...'
oidc.client_id               = 'xxx'
oidc.client_secret           = (encrypted)

# Access Control
oidc.access_control_method   = 'open' | 'group_claim' | 'allowed_list' | 'admin_approval'
oidc.access_group_claim      = 'groups' (claim name)
oidc.access_group_value      = 'readmeabook-users' (required group)
oidc.allowed_emails          = '["user@example.com"]' (JSON array)
oidc.allowed_usernames       = '["username"]' (JSON array)

# Admin Role Mapping
oidc.admin_claim_enabled     = 'true' | 'false'
oidc.admin_claim_name        = 'groups'
oidc.admin_claim_value       = 'readmeabook-admin'
```

### Implementation
- **Provider:** `src/lib/services/auth/OIDCAuthProvider.ts`
- **Routes:** `src/app/api/auth/oidc/login/route.ts`, `src/app/api/auth/oidc/callback/route.ts`
- **Setup Wizard:** `src/app/setup/steps/OIDCConfigStep.tsx`
- **Admin Settings:** OIDC section in `/admin/settings` (auth tab)
- **Library:** `openid-client` (OIDC discovery, token exchange, PKCE)

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
- **OIDC PKCE**: All OIDC flows use PKCE (Proof Key for Code Exchange) for enhanced security

## Tech Stack

- Custom Plex OAuth (direct API)
- OIDC: openid-client (npm)
- jsonwebtoken (npm)
- Node.js crypto
