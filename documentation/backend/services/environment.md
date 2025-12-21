# Environment Variables

**Status:** ✅ Implemented | Centralized URL handling via getBaseUrl() utility

Defines all environment variables used by ReadMeABook, configuration priority, and troubleshooting guide.

## Public URL Configuration (OAuth Callbacks)

**Critical for OAuth:** Plex OAuth and OIDC authentication require correct redirect URIs.

**Priority Order:**
1. `PUBLIC_URL` - **Primary** (documented standard)
2. `NEXTAUTH_URL` - Legacy fallback (backward compatibility)
3. `BASE_URL` - Alternative fallback
4. `http://localhost:3030` - Development default

**Format Requirements:**
- Must start with `http://` or `https://`
- No trailing slash (automatically normalized)
- Must be publicly accessible for OAuth callbacks
- Example: `https://readmeabook.example.com`

**Docker Compose:**
```yaml
environment:
  PUBLIC_URL: "https://readmeabook.example.com"
```

**Implementation:** `src/lib/utils/url.ts` → `getBaseUrl()`

**Used By:**
- OIDC OAuth redirect_uri: `{PUBLIC_URL}/api/auth/oidc/callback`
- Plex OAuth redirect_uri: `{PUBLIC_URL}/api/auth/plex/callback`
- Login error redirects: `{PUBLIC_URL}/login?error=...`

## Database Configuration

**Required:**
- `DATABASE_URL` - PostgreSQL connection string
  - **Auto-generated** by entrypoint in unified container
  - Format: `postgresql://{user}:{password}@{host}:{port}/{database}`
  - Example: `postgresql://readmeabook:password@localhost:5432/readmeabook`

**PostgreSQL Settings (Unified Container):**
- `POSTGRES_USER` - Default: `readmeabook`
- `POSTGRES_PASSWORD` - Auto-generated on first run if not set
- `POSTGRES_DB` - Default: `readmeabook`

## Security & Secrets

**Auto-generated on first run (Unified Container):**
- `JWT_SECRET` - JWT access token signing key
- `JWT_REFRESH_SECRET` - JWT refresh token signing key
- `CONFIG_ENCRYPTION_KEY` - Config field encryption key (Plex tokens, etc.)
- `POSTGRES_PASSWORD` - PostgreSQL password

**Manual Override:** Set in docker-compose.yml before first run to use custom secrets.

## File Ownership (Unified Container)

**User/Group ID Mapping:**
- `PUID` - Default: 1000 (your host user ID)
- `PGID` - Default: 1000 (your host group ID)

**How It Works:**
- PostgreSQL: UID 103, GID={PGID}
- Node/Redis: Fully remapped to PUID:PGID
- See: documentation/deployment/unified.md

## Plex Configuration

**Optional Overrides:**
- `PLEX_CLIENT_IDENTIFIER` - Default: auto-generated UUID
- `PLEX_PRODUCT_NAME` - Default: `ReadMeABook`
- `PLEX_OAUTH_CALLBACK_URL` - Custom OAuth callback (overrides PUBLIC_URL)

## Logging

**Optional:**
- `LOG_LEVEL` - Default: `info`
  - Values: `debug`, `info`, `warn`, `error`
  - `debug` logs base URL resolution source

**Debug Example:**
```
[URL Utility] Using base URL from PUBLIC_URL: https://example.com
```

## Setup Middleware

**Internal Override:**
- `SETUP_CHECK_BASE_URL` - Override base URL for setup status check
  - Use case: Reverse proxies with TLS termination
  - Default: Tries request origin, then loopback
  - See: documentation/backend/middleware.md

## Troubleshooting

### Issue: OAuth Redirects to Localhost

**Symptoms:**
- OIDC/Plex OAuth redirects to `http://localhost:3030/api/auth/...`
- Authentik/Identity Provider shows `localhost` redirect URI
- "Redirect URI Error" or "Mismatching redirection URI"

**Cause:** `PUBLIC_URL` not set (defaulting to localhost)

**Fix:**
```yaml
# docker-compose.yml
environment:
  PUBLIC_URL: "https://your-actual-domain.com"  # No trailing slash
```

**Restart container after change.**

### Issue: Invalid Redirect URI Format

**Symptoms:**
- Warning: `Invalid base URL format`
- OAuth fails with malformed URL

**Cause:** PUBLIC_URL missing protocol or has invalid format

**Fix:**
- ✅ Correct: `https://example.com`
- ❌ Wrong: `example.com` (missing protocol)
- ❌ Wrong: `https://example.com/` (trailing slash, auto-normalized but avoid)

### Issue: Production Using Localhost

**Symptoms:**
- Warning: `Using localhost URL in production`
- OAuth fails from external clients

**Cause:** NODE_ENV=production but PUBLIC_URL not set

**Fix:** Always set PUBLIC_URL in production deployments.

### Issue: checks.state argument is missing (OIDC)

**Symptoms:**
- Error in URL after OIDC login: `error=TypeError: checks.state argument is missing`
- Login redirects back to login page after Authentik authentication

**Cause:** Missing state parameter in openid-client callback checks (fixed in latest version)

**Fix:** Update to latest version with state parameter fix

### Issue: OIDC login succeeds but redirects back to login page

**Symptoms:**
- OIDC authentication completes in Authentik
- Redirect back to ReadMeABook succeeds
- URL shows `/login?redirect=%2F`
- Not actually logged in, no auth cookies visible

**Cause:** httpOnly cookies prevent JavaScript from reading tokens (fixed in latest version)

**Fix:**
- Update to latest version
- Callback now uses URL hash + accessible cookies (matches Plex OAuth pattern)
- Tokens properly stored in localStorage

**Authentik Configuration Requirements:**
1. Go to Application/Provider → Scopes
2. Add: `openid`, `profile`, `email`, `groups`
3. Redirect URI: `https://your-domain.com/api/auth/oidc/callback`
4. Save and retry login

## Environment Variable Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PUBLIC_URL` | Prod | localhost:3030 | Public URL for OAuth callbacks |
| `NEXTAUTH_URL` | No | - | Legacy fallback for PUBLIC_URL |
| `BASE_URL` | No | - | Alternative fallback for PUBLIC_URL |
| `DATABASE_URL` | Yes | Auto-generated | PostgreSQL connection string |
| `POSTGRES_USER` | No | readmeabook | PostgreSQL username |
| `POSTGRES_PASSWORD` | No | Auto-generated | PostgreSQL password |
| `POSTGRES_DB` | No | readmeabook | PostgreSQL database name |
| `JWT_SECRET` | No | Auto-generated | JWT signing secret |
| `JWT_REFRESH_SECRET` | No | Auto-generated | Refresh token secret |
| `CONFIG_ENCRYPTION_KEY` | No | Auto-generated | Config encryption key |
| `PUID` | No | 1000 | Host user ID for file ownership |
| `PGID` | No | 1000 | Host group ID for file ownership |
| `PLEX_CLIENT_IDENTIFIER` | No | Auto-generated | Plex API client ID |
| `PLEX_PRODUCT_NAME` | No | ReadMeABook | Plex product name |
| `PLEX_OAUTH_CALLBACK_URL` | No | - | Custom Plex OAuth callback |
| `LOG_LEVEL` | No | info | Logging verbosity |
| `SETUP_CHECK_BASE_URL` | No | - | Setup middleware override |
| `NODE_ENV` | No | production | Environment mode |

## Related

- OAuth Implementation: documentation/backend/services/auth.md
- OIDC Configuration: documentation/features/audiobookshelf-integration.md
- Deployment: documentation/deployment/unified.md
- Setup Middleware: documentation/backend/middleware.md
