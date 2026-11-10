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
**GET /api/auth/me** - Get current user (JWT in header), includes `authProvider` field ('plex' | 'oidc' | 'local')

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

## JWT Signing Secrets

**Source:** `src/lib/utils/jwt.ts` — resolved lazily on first sign/verify (never at module load), memoized per process

| Token | Env var (wins if set) | Fallback if unset |
|-------|----------------------|-------------------|
| Access | `JWT_SECRET` | HKDF-SHA256(`CONFIG_ENCRYPTION_KEY`, info `readmeabook:jwt:access:v1`) |
| Refresh | `JWT_REFRESH_SECRET` | HKDF-SHA256(`CONFIG_ENCRYPTION_KEY`, info `readmeabook:jwt:refresh:v1`) |
| Download | `JWT_DOWNLOAD_SECRET` | resolved access secret + `-download` |

- **HKDF params:** salt `readmeabook:jwt-secret-derivation`, 32 bytes, base64-encoded
- **No hardcoded fallback:** neither env var nor `CONFIG_ENCRYPTION_KEY` set → sign/verify throw
- **Unified container:** entrypoint generates + persists `JWT_SECRET`/`JWT_REFRESH_SECRET` → derivation unused
- **Derivation in use:** logged once at info level (names only, no secret material)
- **Session impact:** changing HKDF params, or `CONFIG_ENCRYPTION_KEY` while derived, invalidates all sessions + download links

## Middleware

**requireAuth()** - Verifies JWT exists/valid, adds user to request, returns 401 if invalid
**requireAdmin()** - Checks `user.role === 'admin'`, returns 403 if not, chains after requireAuth
**getOptionalAuthUser()** - For routes that also answer without a session: the caller after the same account checks as requireAuth (API tokens: allowlist too), else `null`, never a 401
**requireSetupIncomplete()** - Setup-only routes; 403 once `setup_completed='true'`
**requireSetupIncompleteOrAdmin()** - Shared setup/settings routes; open during setup, admin after
- Both **fail closed**: if the `setup_completed` lookup throws → 503 `ServiceUnavailable` (handler not run; details logged only)
- `/api/*` is not covered by `src/middleware.ts`; every route must call its own guard

## First User Setup

- First user created during setup automatically promoted to admin
- Marked as "setup admin" with `isSetupAdmin=true` flag
- Setup admin role is **protected** - cannot be changed to prevent lockout
- Ensures someone always has admin access after fresh install
- Subsequent users default to 'user' role
- First-user check (`prisma.user.count()` in Plex callback, switch-profile, `LocalAuthProvider.register`, `OIDCAuthProvider`) counts soft-deleted users on purpose: a deleted account never makes the next sign-up an admin (the `LocalAuthProvider.register` site is pinned by `tests/services/auth/first-user-admin.test.ts`)
- Local admin uses username/password authentication (stored in `authToken` field as bcrypt hash)
- `plexId` format: `local-{username}` for local admin accounts

## Local Admin Authentication

**Local Admin (Setup Admin):**
- Created during setup wizard (step 2)
- Username/password authentication (separate from Plex OAuth)
- Password hashed with bcrypt (10 rounds) and stored in `authToken` field
- `bcrypt` 6.x: prebuilt native binaries ship in the package (linux x64/arm64, glibc + musl), no install-time download or compile. `$2a$`/`$2b$` hashes made by bcrypt 5 verify unchanged (`tests/services/auth/bcrypt-compat.test.ts`)
- Login: POST `/api/auth/admin/login` with username/password
- Account checks: same as the regular local login (`src/lib/services/auth/local-account-status.ts`). Pending approval: 200 `{success:false, pendingApproval:true}`; rejected: 401 `Account has been rejected`; deleted (`deletedAt` set): 401 `Invalid username or password`. Approved or null `registrationStatus` signs in. Checked after the password, before `lastLoginAt` and tokens
- Identified by: `isSetupAdmin=true` AND `plexId` starts with `local-`

**Password Management:**
- POST `/api/auth/change-password` - Change password for any local user
- Requires: current password, new password (min 8 chars), confirmation
- Security: Only accessible to users with `authProvider='local'` (Plex/OIDC users cannot change passwords)
- Validates current password before allowing change
- Properly decrypts stored password hash before bcrypt comparison
- Available to all local users (setup admin, locally registered users)
- Limit: 10 current-password checks per 15 min per user id (`password-change`), refunded when correct or when the check throws. Non-string fields are a 400 before any slot is taken. Over it: 429 `{success:false, error:'Too many password attempts. Try again in N minutes.'}` + `Retry-After`. The limit counts before the check, so whoever holds a session for the account can keep its password change refused for up to 15 min at a time (planned; wait for the window, or an admin restarts the container, which clears every counter)
- On success the response sets a new known-browser cookie for the new password, so the browser that made the change stays known; every other browser's cookie for the account ends and those browsers become known again at their next password sign-in

**Sign-in attempt limits** (`src/lib/services/auth/signin-guard.ts`, `known-browser.ts`, `src/lib/utils/rateLimit.ts`, `client-address.ts`):
- Both password routes (`admin/login`, `local/login`) use one guard. Order: 403 disabled → 415 unless `Content-Type: application/json` (parameters such as `charset` allowed; `readJsonBody(..., { requireJsonContentType: true })`) → 413 body → 400 missing or non-string fields → account lookup → **reserve** (synchronous, before the password check) → password check → right password refunds this attempt's own slots → 401 / pending / rejected / tokens
  - JSON only, so sign-in requests come from the app's own pages and clients: a plain HTML form cannot send that type, and a cross-origin `fetch` with it needs a preflight the app never allows (chosen over a `Sec-Fetch-Site` check, which older browsers and non-browser clients don't send). The login page, `e2e/bootstrap.ts`, `e2e/lib/harness.ts` and the e2e specs all send JSON. 415 body: `{ error: 'UnsupportedMediaType', message: 'Content-Type must be application/json' }`
- Reserve: a browser with a valid known-browser cookie for that account reserves only its own bucket; when that namespace has no room for its bucket, it reserves the account and address buckets like any other browser (never a `full` refusal for a known browser). Any other browser reserves the account bucket and its address bucket, all or none. A refusal is a 429 with no password check
- Unknown, deleted, Plex and OIDC names have account buckets too and get a bcrypt check against a fixed cost-10 dummy hash (`DUMMY_PASSWORD_HASH`), so they answer and count like a wrong password. Local route checks pending/rejected after the password (as the admin route): a wrong password on those accounts is the generic 401
- `LocalAuthProvider.handleCallback` requires `guard` in its params; without one it refuses (no lookup, no check, error log)

| Namespace | Key | Limit / window | Max entries |
|---|---|---|---|
| `signin-account` | sha256(trimmed, lowercased username), shared by both routes | 10 / 15 min | 10,000 |
| `signin-address` | client address key | 20 / 15 min | 10,000 |
| `signin-known-browser` | sha256(user id, sha256 of stored `authToken`, slot); slot = first byte of the recomputed MAC mod 4 | 10 / 15 min | 2,000 |
| `register-address` | client address key | 5 / 1 h | 10,000 |
| `token-login` | client address key | 10 / 15 min | 10,000 |
| `password-change` | user id | 10 / 15 min | 10,000 |
| `api-token-create` / `api-token-revoke` | user id | 10 / 20 per min | 10,000 |

- Store: in memory, one per process (`processSingleton('rate-limit-store')`), fixed windows (up to 2x a limit across a window edge). **A restart clears every counter.** `reserve()` is all or nothing: the same bucket twice takes two slots, it never drops a bucket of the same request, and it makes room only after every bucket passed. A full namespace drops an expired entry or one under half its limit; never one at or past half. With nothing to drop, new keys are refused (429) and `warn Rate-limit store full; new keys refused {namespace}` logs once a minute. The counts of the last `maxEntries` dropped entries are kept per namespace; a dropped key that comes back within its window resumes its count
  - Bound where the client chooses its address (directly published port, no appending proxy): the per-account limit is 10 per 15 min plus at most 4 for each 10,000 sign-in checks on other names in that window (an entry is dropped only under half its limit, and its count comes back unless 10,000 later entries were dropped). bcrypt (cost 10) runs on Node's 4 worker threads, roughly 70,000 checks per 15 min at most, so the worst case is about 40 checks on one account per 15 min (about 150 an hour instead of 40), and only with the server at full load the whole time. Behind an appending proxy the 20-per-address limit also holds
- Client address key (`clientAddressKey`): last 1,024 chars of `X-Forwarded-For`, at most 16 entries walked from the right, entries over 64 chars or with `%` skipped before parsing, port stripped only from `[v6]:port` and `v4:port`, `::ffff:a.b.c.d` → IPv4, IPv6 keyed by /64. First public entry wins; else the rightmost valid one; else `none`. Non-public: `0/8 10/8 127/8 169.254/16 172.16/12 192.168/16`, `::`, `::1`, `fe80::/10`, `fc00::/7` (CGNAT `100.64/10` counts as a client). Proxy setup: [deployment/unified.md](../../deployment/unified.md) Security Notes
- Known-browser cookie `rmab_known_browser`: `v1.<userId>.<issuedAt>.<mac>`, HMAC-SHA256 over user id, issue time and sha256 of the stored `authToken`, key `derivePurposeKey('known-browser:v1')` (HKDF of the access JWT secret). httpOnly, SameSite=Strict, Path=/api/auth, Max-Age 90 days, `Secure` only when the first `X-Forwarded-Proto` is `https` (session cookies' `NODE_ENV` rule would drop it on plain-http installs)
  - Set or renewed on a full password sign-in (tokens issued) on either route, and on a successful password change (`renewKnownBrowser`, for the new password); never on a wrong password, pending, rejected, 415 or 429; not at setup, registration, token or OIDC/Plex sign-in. One account per browser (last sign-in wins). After updating, a browser becomes known at its first password sign-in; sessions from before the update set nothing (sign in once with the password after updating)
  - At most 4 buckets per account (`SLOTS_PER_ACCOUNT`): a fifth browser shares a slot, and its count, with one of the others; no cookie is ended to make room. A password change gives the account fresh buckets
  - Valid only for its own account, with the MAC decoding to exactly 32 bytes, issued within 90 days and not over 5 min ahead. Ends when the password changes (`authToken` is re-encrypted with a new IV), the account is deleted, or the secret changes. Sign-out leaves it (it grants no session)
- Refusal texts (`error`, plus `Retry-After` seconds; N = minutes rounded up, at least 1):
  - account: `Too many sign-in attempts for this account. Try again in N minutes, or sign in from a browser you've used with this account before.`
  - address: `Too many sign-in attempts from your network. Try again in N minutes.`
  - known browser: `Too many sign-in attempts from this browser. Try again in N minutes.`
  - no room for a new entry (`reason: 'full'`, account or address namespace): `Sign-in is busy. Try again in N minutes.` (no guard log; the limiter's once-a-minute line covers it)
  - register and token login keep their texts (`Too many registration attempts. Please try again later.`, `Too many login attempts. Please try again later.`)
- Admin refused on a new browser: sign in from a browser that has signed in to that account with the password since the update (or changed its password there); or wait for the window (15 min from its first attempt; new attempts keep refilling it); or restart the container (`docker restart readmeabook`, clears all counters); an existing session keeps working. **A known browser can still be refused at its own limit** (10 wrong passwords from that browser in 15 min): then wait, use another known browser, or restart
- Logs (never the password or cookie; usernames cut to 64 chars): `warn Sign-in attempts paused for an account {username, minutes}` / `for an address {address}` / `for a known browser {userId}`, once per bucket per window; `warn Password change attempts paused {userId}`

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

**Profile Identity (`POST /api/auth/plex/switch-profile`):**
- The chosen profile must be one of the account's Plex Home users (`getHomeUsers` with the cached account token) → else 403 `AccessDenied`
- Identity fields (plexId, name, email, avatar) come from Plex: the Home user entry's `uuid`, or `getUserInfo(<profile token>)` when the client sends no profile details or the entry has no uuid
- Plex sign-ins (switch-profile and the single-profile callback) set `authProvider: 'plex'` and never change `role`; `src/lib/services/auth/plex-identity.ts` checks the row before it is written

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

### OIDC Accounts
- The user row is keyed on the IdP subject (`plexId` = `oidcSubject`); OIDC sign-in only uses an OIDC account's row (`authProvider: 'oidc'`) → otherwise sign-in is refused with a generic message
- Create and update set `authProvider: 'oidc'`
- `PlexAuthProvider.handleCallback` is not used (Plex sign-in completes in `/api/auth/plex/callback` and `/api/auth/plex/switch-profile`) and always refuses

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
  - Returns: `backendMode`, `providers[]`, `registrationEnabled`, `hasLocalUsers`, `oidcProviderName`, `localLoginDisabled`, `automationEnabled`
  - `hasLocalUsers`: non-deleted users only (ABS: `authProvider='local'`; Plex: `local-` setup admin). Same filter for `hasLocalUsers`/`hasLocalAdmins` in GET `/api/admin/settings` (feeds the Auth tab lockout warnings, client-side only)
  - `automationEnabled`: true if Prowlarr/indexer configured (used for dynamic login page description)

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

## Local Accounts (registration and admin-added)

- One creator: `createLocalAccount(input, state)` (`src/lib/services/auth/local-account.ts`), called by `LocalAuthProvider.register` (POST `/api/auth/register`) and POST `/api/admin/users` (#77)
- Rules (`checkLocalCredentials`): username trimmed + lowercased, min 3 (`Username must be at least 3 characters`); password a non-empty string (`Password is required`), min 8 unless `ALLOW_WEAK_PASSWORD=true` (`Password must be at least 8 characters`); username checked first
- Taken: a non-deleted `authProvider='local'` row with that `plexUsername` (deleted accounts' names are free), or a P2002 on write (concurrent sign-up, or a name equal to a deleted account's freed key `local-<name>-deleted-<ms>`) → `That username is already taken` (never the database text)
- Row: `plexId` `local-<username>`, bcrypt (10) hash encrypted into `authToken`, `authProvider` local; `role`/`isSetupAdmin`/`registrationStatus`/`lastLoginAt` from the caller
- Self-registration state: first user ever (deleted rows count) → admin + setup admin + approved; else user, `pending_approval` when `auth.require_admin_approval`; `lastLoginAt` now. Order: rules → `auth.registration_enabled` (`Registration is disabled`) → create
- Admin-added state: user, not setup admin, approved, `lastLoginAt` null (Users page: Never), regardless of `auth.registration_enabled` and `auth.require_admin_approval`
- Local login enabled (`isLocalLoginEnabled(backendMode?)`): Audiobookshelf mode and `DISABLE_LOCAL_LOGIN` not `'true'`. The one rule for `/api/auth/providers` (`local` provider and `registrationEnabled`; the route passes the mode it already read, and also hides the form while no local account exists and registration is off), POST `/api/admin/users` and the Users page Add User button. API: [admin-dashboard.md](../../admin-dashboard.md)

## Deleting Users

- `DELETE /api/admin/users/[id]` (admin): soft delete for any provider; row kept with its requests. Guards: [admin-dashboard.md](../../admin-dashboard.md)
- Freed keys (`freedAccountKeys`, `src/lib/services/auth/deleted-account-keys.ts`):
  - local: `plexId` = `local-<username>-deleted-<ms>` (stays in the `local-` space; admin login looks up `local-<username>`, Plex and OIDC sign-in refuse `local-` keys)
  - Plex, OIDC, null provider: `plexId` = `<plexId>-deleted-<uuid v4>`; `oidcSubject` (when set) = `<oidcSubject>-deleted-<same uuid>`. Random part: no Plex id or IdP subject can equal it
  - `loginTokenHash` and `authToken` (the Plex account token or the local password hash) cleared
- `OIDCAuthProvider.findUserByOIDCSubject` skips deleted rows (`deletedAt: null`)
- Returning user (new row, role from the new-account rule: `user`, or `admin` from the OIDC admin claim; permissions reset to defaults):

| Path | Returning user gets |
|------|---------------------|
| Plex callback, Plex Home `switch-profile` | New row, `registrationStatus` approved (Plex sign-in has no approval step, same as any new Plex user) |
| OIDC callback | New row; `admin_approval`: `pending_approval` (`/login?pending=approval`); other methods: approved. Lookup is by subject only (no email/username match) |
| Login token (`/api/auth/token/login`) | Old link 401 `Invalid token`; the new account has no token until an admin issues one |
| Admin login / local | Deleted row 401 `Invalid username or password`; registering again gives a new row (pending when `auth.require_admin_approval`) |

- Deleted account's access token, refresh token, API tokens and download links: refused by the existing `deletedAt` checks (`getSessionRefusal`, `requireAuth`, `/api/auth/refresh`)
- Shelves and watched lists: a deleted user's Goodreads/Hardcover shelves and watched authors/series stay configured but are skipped by the scheduled and manual runs (#504, [goodreads-sync.md](goodreads-sync.md#deleted-users-504), [watched-lists.md](../../features/watched-lists.md))

## Admin-Generated Login Token

- Login token stored as SHA-256 hash in `User.loginTokenHash`
- Admin generates/revokes via user permissions modal
- User navigates to `/auth/token/login?token=rmab_...` → page POSTs token to API in request body
- API: `POST /api/auth/token/login` with `{ token }` in JSON body
- Account checks (after the token matches, before `lastLoginAt` and tokens): pending approval: 200 `{success:false, pendingApproval:true, message}` (page sends it to `/login?error=`); rejected: 401 `Account has been rejected`. Approved or null signs in
- Generating a token (`POST /api/admin/users/[id]/login-token`) for a pending or rejected account: 403
- Invalid token redirects to `/login`

## Request File Download Link

- `GET /api/requests/:id/download?token=` (`src/app/api/requests/[id]/download/route.ts`): token-authenticated, no session cookie; account checks in Fixed Issues
- **One matching file:** sent as-is (`application/octet-stream`, `Content-Length`, `attachment; filename="<title><ext>"`) by `streamFile`
- **Several matching files:** one zip built as the client reads it (`application/zip`, no `Content-Length`) by `streamZip`
- **Both stream with backpressure:** `pullFrom` reads the next chunk only when the client takes the last one, so a paused client holds the disk read back (a few 64 KiB chunks buffered, not the file). A cancel destroys the source and closes the file, with no error logged; a read error is logged once with the request id and ends the response with that error

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

## Fixed Issues

- **OIDC accounts:** OIDC sign-in is kept to OIDC accounts.
- **Plex profile identity:** profile sign-in takes the profile's identity from Plex and requires a profile from the account's Home list.
- **Admin sign-in account checks:** `/api/auth/admin/login` now applies the same account checks as the regular local sign-in (pending approval, rejected) and also refuses deleted accounts.
- **#297 Hardcoded JWT fallback secrets:** `jwt.ts` fell back to built-in default strings when `JWT_SECRET`/`JWT_REFRESH_SECRET` were unset (installs that bypass the unified entrypoint). Fix: fallbacks removed; secrets derived from `CONFIG_ENCRYPTION_KEY` via HKDF. Affected installs: all sessions + download links invalidated on upgrade (re-login required).
- **Sessions follow approval status:** `requireAuth` (access tokens and API tokens) and `/api/auth/refresh` now read `registrationStatus` in their existing user lookup and refuse `pending_approval`/`rejected` accounts like a deleted one (401); null counts as approved. Token login refuses them like the regular sign-in, and login and API tokens can no longer be created for them. One rule for every check: `getRegistrationRefusal` (`src/lib/services/auth/local-account-status.ts`).
- **Download links check the account:** `GET /api/requests/:id/download?token=` now checks the link's account like a sign-in does (one `getSessionRefusal` rule shared with `requireAuth`): missing, deleted, pending or rejected accounts, and links made before the account's sessions were revoked, get 401 (`Invalid or expired download token`); an account without download access now (`resolveDownloadAccess`, same rule as `POST /api/requests/:id/download-token`) gets 403. Live accounts with access: unchanged, no session cookie needed.
- **Multi-file download zip entry names:** a request with several files streams one zip (`archiver` 8, `ZipArchive`). Each entry is the file's base name with any `/`, `\` or `:` replaced by `_`, so every file sits at the zip root under its full name. Before, a `\` in a Linux file name became a folder separator in the entry name, and archiver dropped a leading `word:` (`Prologue: The Start.mp3` downloaded as ` The Start.mp3`).
- **#490 Multi-file download cancel, read error, slow reader:** the zip is pull-based (`streamZip`, `src/app/api/requests/[id]/download/route.ts`): files are added one at a time, so only the file being zipped is open, and the next bytes are made only when the client reads. A cancel closes that file. A read error (or an archiver warning) is logged once with the request id and ends the response with an error. Before, a cancel left the file open and threw `ERR_INVALID_STATE: Controller is already closed`, a read error was uncaught and the download never ended, and a paused client made the server queue most of the zip in memory. Single-file downloads, entry names and compression level unchanged.
- **#500 Single-file download slow reader:** a single-file download is pull-based too (`streamFile`, same `pullFrom` helper as the zip): the file is read only as fast as the client reads. Before, every chunk read from disk was queued for the client, so a paused or slow client made the server read the whole file into memory (64 MiB file, client paused after one chunk: 64 MiB read before, 192 KiB after). A cancel still closes the file; a read error is still logged, now with the request id, and ends the response with an error. Headers unchanged.
- **#215 Soft-deleted users counted as local users/admins:** `hasLocalUsers`/`hasLocalAdmins` (providers + admin settings) had no `deletedAt: null`, so a deleted local admin kept the login form shown and the Auth tab lockout warnings quiet. Fix: count non-deleted users only. First-user checks unchanged (deleted users still count).
- **Admin job routes:** `/api/admin/jobs`, `/api/admin/jobs/:id`, `/api/admin/jobs/:id/trigger` and `/api/admin/job-status/:id` use `requireAuth` + `requireAdmin` like the other admin routes: the account must still exist, its sessions must not be revoked, and the session must be an admin session. API tokens are refused (not on the allowlist).
- **Author and series catalog routes:** `/api/authors/:asin`, `/api/authors/:asin/books`, `/api/authors/search`, `/api/series/:asin` and `/api/series/search` use `requireAuth` like the other signed-in routes: the account must still exist, be approved, and its sessions must not be revoked. API tokens get 403 (not on the allowlist; previously 401). Popular, new releases, category and audiobook search are unchanged.
- **Admin checks use the current role:** `requireAuth` selects `role` in its existing user lookup and sets `request.user.role` from the account, not the access token, so `requireAdmin`/`requireLocalAdmin` and route role checks follow a role change (either way) on the next request. API tokens: effective role = token role capped by the owner's current role (never raised on promotion). `/api/auth/refresh` already issued the current role.
- **Discovery routes check the account before adding request details:** `/api/audiobooks/popular`, `/new-releases`, `/category/:categoryId` and `/search` take the caller from `getOptionalAuthUser` (same account checks as `requireAuth`). Request details (`isRequested`, `requestStatus`, `requestId`, `requestedByUserId`, `requestedByUsername`) and ignore flags are added only for a checked account; any other caller gets the same books with none of them. Signed-in responses unchanged. The unchecked `getCurrentUser`, `getCurrentUserAsync` and `isAdmin` helpers were removed.

## Tech Stack

- Custom Plex OAuth (direct API)
- OIDC: openid-client (npm)
- jsonwebtoken (npm)
- Node.js crypto
