# Authentication Service

## Current State

**Status:** Design Phase - Not yet implemented

This service handles all authentication and authorization logic for the ReadMeABook application, including Plex OAuth integration, JWT session management, and role-based access control.

## Design Architecture

### Authentication Flow: Plex OAuth

**Why Plex OAuth:**
- No need to manage passwords
- Users already have Plex accounts
- Seamless integration with Plex ecosystem
- Inherits Plex's security model
- Automatic profile pictures and metadata

### Session Management: JWT Tokens

**Why JWT:**
- Stateless authentication
- No server-side session storage required
- Easy to scale horizontally
- Can include user claims (role, permissions)
- Industry standard

### Access Control: Role-Based (RBAC)

**Two Roles:**
1. **user** - Can request audiobooks, view own requests, search library
2. **admin** - Full system access including settings, user management, all requests

## Implementation Details

### Plex OAuth Flow

```
┌──────────┐                                   ┌──────────┐
│  User    │                                   │  Plex    │
│ Browser  │                                   │  Server  │
└────┬─────┘                                   └─────┬────┘
     │                                               │
     │  1. Click "Login with Plex"                  │
     │────────────────────────────────►             │
     │                                 │             │
     │  2. Redirect to Plex OAuth     │             │
     │────────────────────────────────┼────────────►│
     │                                 │             │
     │  3. User authorizes app         │             │
     │◄────────────────────────────────┼─────────────│
     │                                 │             │
     │  4. Redirect back with code     │             │
     │◄────────────────────────────────│             │
     │                                               │
     │  5. Exchange code for token                   │
     │────────────────────────────────────────────► │
     │                                               │
     │  6. Plex token + user info                    │
     │◄──────────────────────────────────────────────│
     │                                               │
     │  7. Create/update user in DB                  │
     │  8. Generate JWT                              │
     │  9. Return JWT to client                      │
     │◄────────────────────────────────              │
     │                                               │
     │  10. Subsequent requests with JWT             │
     │────────────────────────────────►             │
```

### OAuth Endpoints

**1. Initiate OAuth**
```typescript
GET /api/auth/plex/login
Response: Redirect to Plex OAuth URL
```

**2. OAuth Callback**
```typescript
GET /api/auth/plex/callback?code=...
Response: JWT token + user info
```

**3. Token Refresh**
```typescript
POST /api/auth/refresh
Headers: Authorization: Bearer <refresh_token>
Response: New access token
```

**4. Logout**
```typescript
POST /api/auth/logout
Response: Success (clears client-side token)
```

**5. Current User**
```typescript
GET /api/auth/me
Headers: Authorization: Bearer <jwt_token>
Response: Current user info
```

### Plex OAuth Configuration

**Required Environment Variables:**
- `PLEX_CLIENT_IDENTIFIER` - Unique app identifier
- `PLEX_PRODUCT_NAME` - "ReadMeABook"
- `PLEX_OAUTH_CALLBACK_URL` - Full callback URL

**Plex API Endpoints Used:**
- `https://plex.tv/api/v2/pins` - Request auth PIN
- `https://plex.tv/api/v2/pins/{id}` - Check PIN status
- `https://plex.tv/users/account` - Get user info with token

### JWT Token Structure

**Access Token (expires in 1 hour):**
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

**Refresh Token (expires in 7 days):**
```json
{
  "sub": "user-uuid",
  "type": "refresh",
  "iat": 1234567890,
  "exp": 1234971490
}
```

**Token Storage:**
- Access token: HTTP-only cookie + localStorage (for API calls)
- Refresh token: HTTP-only secure cookie only
- Both use SameSite=Strict for CSRF protection

### Role-Based Access Control

**Middleware: `requireAuth()`**
```typescript
// Verifies JWT token exists and is valid
// Adds user object to request
// Returns 401 if invalid/missing
```

**Middleware: `requireAdmin()`**
```typescript
// Checks user.role === 'admin'
// Returns 403 if not admin
// Chains after requireAuth()
```

**Protected Routes Example:**
```typescript
// Any authenticated user
GET /api/requests (requireAuth)

// Admin only
GET /api/admin/users (requireAuth, requireAdmin)
POST /api/admin/settings (requireAuth, requireAdmin)
```

### First User Setup

**Special Case:**
When the first user authenticates:
1. Check if any users exist in database
2. If database is empty, automatically promote to admin role
3. This ensures someone can access admin panel after fresh install
4. Subsequent users default to 'user' role

## Tech Stack

**OAuth Library:** Custom implementation using Plex API directly
**JWT Library:** `jsonwebtoken` (npm package)
**Password Hashing:** N/A (using OAuth only)
**Encryption:** Node.js `crypto` module for sensitive data

## Dependencies

- PostgreSQL database (users table)
- Plex.tv API access (internet connection required)
- Configuration service for storing Plex OAuth settings
- User model from database layer

## API Contracts

### POST /api/auth/plex/login

**Request:**
```json
{}  // No body required
```

**Response:**
```json
{
  "authUrl": "https://app.plex.tv/auth#?clientID=...",
  "pinId": "12345"
}
```

### GET /api/auth/plex/callback?pinId=12345

**Response Success:**
```json
{
  "success": true,
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "user": {
    "id": "uuid",
    "plexId": "12345",
    "username": "john_doe",
    "email": "john@example.com",
    "role": "user",
    "avatarUrl": "https://plex.tv/users/..."
  }
}
```

**Response Error:**
```json
{
  "success": false,
  "error": "Authentication failed",
  "message": "User denied authorization"
}
```

### GET /api/auth/me

**Headers:**
```
Authorization: Bearer eyJhbGc...
```

**Response:**
```json
{
  "id": "uuid",
  "plexId": "12345",
  "username": "john_doe",
  "email": "john@example.com",
  "role": "admin",
  "avatarUrl": "https://plex.tv/users/...",
  "createdAt": "2024-01-01T00:00:00Z",
  "lastLoginAt": "2024-01-15T12:30:00Z"
}
```

### POST /api/auth/refresh

**Headers:**
```
Cookie: refreshToken=eyJhbGc...
```

**Response:**
```json
{
  "accessToken": "eyJhbGc...",
  "expiresIn": 3600
}
```

## Security Considerations

### Token Security

- **Never log tokens** - Sanitize logs to remove sensitive data
- **Secure transmission** - HTTPS only in production
- **Short expiration** - Access tokens expire quickly (1 hour)
- **Refresh rotation** - Optionally rotate refresh tokens on use
- **Revocation** - Track valid tokens to allow manual revocation

### CSRF Protection

- SameSite cookie attribute
- Double-submit cookie pattern for state parameter
- Validate OAuth state parameter matches

### Rate Limiting

- Limit login attempts per IP (10 per hour)
- Limit token refresh attempts (20 per hour)
- Return 429 Too Many Requests when exceeded

### Input Validation

- Validate all OAuth callback parameters
- Sanitize user data from Plex API
- Validate JWT structure before parsing

## Error Handling

### Common Errors

**401 Unauthorized:**
- Invalid token
- Expired token
- Missing token
- Token signature verification failed

**403 Forbidden:**
- Valid token but insufficient permissions (not admin)

**500 Internal Server Error:**
- Plex API unavailable
- Database connection failed
- JWT signing error

**Error Response Format:**
```json
{
  "error": "ErrorType",
  "message": "Human-readable error message",
  "statusCode": 401
}
```

## Usage Examples

### Frontend Login Flow

```typescript
// 1. Initiate login
const { authUrl, pinId } = await fetch('/api/auth/plex/login').then(r => r.json());

// 2. Open Plex OAuth in new window
window.open(authUrl, 'plex-auth', 'width=600,height=700');

// 3. Poll callback endpoint until success
const interval = setInterval(async () => {
  const result = await fetch(`/api/auth/plex/callback?pinId=${pinId}`);
  if (result.ok) {
    const { accessToken, user } = await result.json();
    localStorage.setItem('accessToken', accessToken);
    clearInterval(interval);
    // Redirect to dashboard
  }
}, 1000);
```

### Backend Middleware Usage

```typescript
import { requireAuth, requireAdmin } from './services/auth';

// Protected user route
app.get('/api/requests', requireAuth, async (req, res) => {
  // req.user is populated by requireAuth middleware
  const requests = await getRequestsForUser(req.user.id);
  res.json(requests);
});

// Admin-only route
app.post('/api/admin/users/:id/promote', requireAuth, requireAdmin, async (req, res) => {
  await promoteUserToAdmin(req.params.id);
  res.json({ success: true });
});
```

### Checking Permissions in Code

```typescript
function canAccessRequest(user: User, request: Request): boolean {
  // Admins can access all requests
  if (user.role === 'admin') return true;

  // Users can only access their own requests
  return request.userId === user.id;
}
```

## Testing Strategy

### Unit Tests

- JWT generation and verification
- Token expiration logic
- Role checking functions
- First user promotion logic

### Integration Tests

- Full OAuth flow (mocked Plex API)
- Token refresh flow
- Permission middleware
- Error handling for invalid tokens

### Security Tests

- Expired token rejection
- Tampered token rejection
- Role escalation prevention
- CSRF attack prevention

## Known Issues

*This section will be updated during implementation.*

## Future Enhancements

- **Multi-factor authentication** - Optional 2FA for admins
- **Session management UI** - View and revoke active sessions
- **Audit logging** - Track all authentication events
- **API keys** - Alternative auth for automation/scripts
- **OAuth provider abstraction** - Support additional OAuth providers
- **Permission granularity** - More fine-grained permissions beyond user/admin
