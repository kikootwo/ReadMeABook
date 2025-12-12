# Audiobookshelf Integration PRD

**Status:** ❌ Not Started | PRD Complete, Awaiting Development

**Version:** 1.0
**Last Updated:** 2024-12-10
**Author:** System Architecture Planning

---

## Executive Summary

This PRD defines the requirements for adding Audiobookshelf as an alternative library backend to Plex, along with new authentication systems (OIDC and manual registration) to replace Plex OAuth when using Audiobookshelf.

**Scope:**
- Audiobookshelf library integration (alternative to Plex)
- OIDC authentication (Authentik, Keycloak, etc.)
- Manual user registration with admin toggle
- Backend selection during setup
- Full feature parity between Plex and Audiobookshelf modes

**Non-Goals:**
- Hybrid mode (using both Plex AND Audiobookshelf simultaneously)
- Migration tool between backends (manual reconfiguration required)
- Audiobookshelf's internal user system (uses external auth only)

---

## 1. Background & Motivation

### Current State
- ReadMeABook uses Plex as the sole library backend
- Authentication tied to Plex OAuth
- Users must have Plex accounts to use the system
- Library scanning, availability detection, and matching all depend on Plex

### Problem Statement
1. **Plex dependency:** Users without Plex cannot use ReadMeABook
2. **Self-hosted preference:** Many users prefer fully self-hosted solutions
3. **Audiobookshelf popularity:** Growing audiobook-specific media server
4. **Authentication flexibility:** Some users want OIDC integration with existing identity providers

### Solution
Add Audiobookshelf as an alternative library backend with flexible authentication options:
- **Plex Mode:** Existing functionality unchanged (Plex OAuth + Plex library)
- **Audiobookshelf Mode:** New library backend with OIDC or manual registration

---

## 2. System Architecture

### 2.1 Backend Selection Model

```
┌─────────────────────────────────────────────────────────────────┐
│                    ReadMeABook Instance                         │
├─────────────────────────────────────────────────────────────────┤
│  Mode: PLEX                    │  Mode: AUDIOBOOKSHELF          │
│  ────────────────              │  ─────────────────────         │
│  Auth: Plex OAuth              │  Auth: OIDC OR Manual Reg      │
│  Library: Plex Media Server    │  Library: Audiobookshelf API   │
│  Scanner: Plex API             │  Scanner: ABS API              │
│  Availability: Plex GUID       │  Availability: ABS Library ID  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Mode Selection (Mutually Exclusive)

**Decision Point:** Setup wizard Step 1 (after Welcome)

**Options:**
1. **Plex Mode** - Current behavior, no changes
2. **Audiobookshelf Mode** - New backend + auth system

**Persistence:** `system.backend_mode` config key (`plex` | `audiobookshelf`)

**Cannot Change After Setup:** Mode selection is permanent after initial setup to prevent data inconsistencies. To switch modes, user must reset the instance.

---

## 3. Audiobookshelf Library Integration

### 3.1 Audiobookshelf API Overview

**Base URL:** `{server_url}/api`
**Auth:** API token in `Authorization: Bearer {token}` header
**Response:** JSON

**Key Endpoints:**
| Endpoint | Purpose |
|----------|---------|
| `GET /api/libraries` | List all libraries |
| `GET /api/libraries/{id}/items` | Get all items in library |
| `GET /api/libraries/{id}/items?filter=...` | Filtered/sorted items |
| `GET /api/items/{id}` | Get single item with full metadata |
| `GET /api/items/{id}/cover` | Get cover image |
| `GET /api/search/covers?title=...&author=...` | Search for covers |
| `POST /api/libraries/{id}/match` | Trigger metadata match |
| `POST /api/items/{id}/scan` | Scan single item |
| `GET /api/me` | Current user info (for validation) |
| `GET /api/server` | Server info (version, name) |

**Item Structure:**
```json
{
  "id": "li_abc123",
  "libraryId": "lib_xyz",
  "media": {
    "metadata": {
      "title": "Book Title",
      "authorName": "Author Name",
      "narratorName": "Narrator",
      "description": "...",
      "isbn": "...",
      "asin": "B00ABC123",
      "publishedYear": "2023",
      "duration": 36000
    },
    "coverPath": "/audiobooks/book/cover.jpg",
    "audioFiles": [...]
  },
  "addedAt": 1699999999000,
  "updatedAt": 1699999999000
}
```

### 3.2 Library Service Abstraction

**New Interface:** `ILibraryService`

```typescript
interface ILibraryService {
  // Connection
  testConnection(): Promise<LibraryConnectionResult>;
  getServerInfo(): Promise<ServerInfo>;

  // Libraries
  getLibraries(): Promise<Library[]>;
  getLibraryItems(libraryId: string): Promise<LibraryItem[]>;
  getRecentlyAdded(libraryId: string, limit: number): Promise<LibraryItem[]>;

  // Items
  getItem(itemId: string): Promise<LibraryItem>;
  searchItems(query: string): Promise<LibraryItem[]>;

  // Scanning
  triggerLibraryScan(libraryId: string): Promise<void>;

  // Matching
  matchItem(item: AudiobookMetadata): Promise<LibraryItem | null>;
}
```

**Implementations:**
- `PlexLibraryService` - Existing Plex logic (refactored)
- `AudiobookshelfLibraryService` - New ABS implementation

**Factory Pattern:**
```typescript
function getLibraryService(): ILibraryService {
  const mode = await getConfig('system.backend_mode');
  return mode === 'audiobookshelf'
    ? new AudiobookshelfLibraryService()
    : new PlexLibraryService();
}
```

### 3.3 Database Schema Changes

**New/Modified Tables:**

```sql
-- Configuration additions
INSERT INTO configuration (key, value) VALUES
  ('system.backend_mode', 'plex'),  -- 'plex' | 'audiobookshelf'
  ('abs.server_url', ''),
  ('abs.api_token', ''),            -- encrypted
  ('abs.library_id', ''),
  ('abs.server_id', '');            -- for reference

-- Users table modifications
ALTER TABLE users ADD COLUMN auth_provider VARCHAR(50);
-- Values: 'plex' | 'oidc' | 'local'

ALTER TABLE users ADD COLUMN oidc_subject VARCHAR(255);
-- OIDC subject ID (unique per provider)

ALTER TABLE users ADD COLUMN oidc_provider VARCHAR(100);
-- OIDC provider name (e.g., 'authentik', 'keycloak')

-- Audiobooks table modifications (for ABS mode)
ALTER TABLE audiobooks ADD COLUMN abs_item_id VARCHAR(255);
-- Audiobookshelf item ID (alternative to plex_guid)

-- Plex Library table (renamed for abstraction)
-- OPTION A: Rename to generic 'library_cache'
-- OPTION B: Keep plex_library, add abs_library_cache
-- RECOMMENDED: Option A - single abstracted table
```

**Library Cache Table (Abstracted):**
```sql
CREATE TABLE library_cache (
  id UUID PRIMARY KEY,
  external_id VARCHAR(255) NOT NULL,  -- plexGuid OR abs_item_id
  backend_type VARCHAR(50) NOT NULL,  -- 'plex' | 'audiobookshelf'
  title VARCHAR(500),
  author VARCHAR(500),
  narrator VARCHAR(500),
  duration_seconds INTEGER,
  cover_url VARCHAR(1000),
  asin VARCHAR(50),
  isbn VARCHAR(50),
  year INTEGER,
  summary TEXT,
  added_at TIMESTAMP,
  updated_at TIMESTAMP,
  last_synced_at TIMESTAMP,
  UNIQUE(external_id, backend_type)
);
```

### 3.4 Audiobook Matching

**ABS Matching Advantages:**
- Native ASIN support in metadata
- ISBN field available
- Better audiobook-specific metadata

**Matching Strategy:**
1. **ASIN Match:** If request has ASIN and ABS item has same ASIN → 100% match
2. **ISBN Match:** If request has ISBN and ABS item has same ISBN → 100% match
3. **Fuzzy Match:** Title + Author fuzzy matching (existing algorithm)

**Matching Service:**
```typescript
interface IAudiobookMatcher {
  match(request: AudiobookRequest, libraryItems: LibraryItem[]): MatchResult;
}

// Shared implementation - works for both backends
class AudiobookMatcher implements IAudiobookMatcher {
  match(request, items) {
    // 1. Try ASIN match
    // 2. Try ISBN match
    // 3. Fall back to fuzzy title/author
  }
}
```

### 3.5 Availability Checking

**Flow:**
```
1. Library Scan Job → Fetch all ABS items → Populate library_cache
2. Request created → Check library_cache for match
3. Download complete → Scan ABS library → Match downloaded to cache
4. UI shows "In Your Library" based on availability_status
```

**ABS-Specific Considerations:**
- ABS has webhook support → Can receive notifications instead of polling
- ABS scan is faster (native audiobook support)
- ABS metadata includes ASIN/ISBN natively

### 3.6 File Organization

**Current (Plex):**
```
/media/{author}/{title}/audiofiles.m4b
```

**Audiobookshelf:**
```
/media/{author}/{title}/audiofiles.m4b
```

**Same structure works for both backends** - ABS supports same folder structure.

**ABS-Specific Features:**
- Can trigger item scan after file placement
- ABS auto-detects new files in library folder
- Faster metadata matching with ASIN

---

## 4. Authentication Systems

### 4.1 Authentication Provider Abstraction

**New Interface:** `IAuthProvider`

```typescript
interface IAuthProvider {
  type: 'plex' | 'oidc' | 'local';

  // Auth flow
  initiateLogin(): Promise<LoginInitiation>;
  handleCallback(params: CallbackParams): Promise<AuthResult>;
  refreshToken(refreshToken: string): Promise<TokenPair>;

  // User info
  getUserInfo(token: string): Promise<UserInfo>;

  // Validation
  validateToken(token: string): Promise<boolean>;
}

interface AuthResult {
  user: User;
  accessToken: string;
  refreshToken: string;
}
```

**Implementations:**
- `PlexAuthProvider` - Existing Plex OAuth (unchanged)
- `OIDCAuthProvider` - New OIDC implementation
- `LocalAuthProvider` - Username/password registration

### 4.2 OIDC Authentication

**Supported Providers:**
- Authentik
- Keycloak
- Auth0
- Okta
- Any OpenID Connect compliant provider

**Configuration:**
```typescript
interface OIDCConfig {
  provider_name: string;         // Display name
  issuer_url: string;            // OIDC issuer (e.g., https://auth.example.com)
  client_id: string;
  client_secret: string;         // encrypted
  redirect_uri: string;          // auto-generated
  scopes: string[];              // ['openid', 'profile', 'email']

  // Optional
  discovery_endpoint?: string;   // default: {issuer}/.well-known/openid-configuration
  userinfo_endpoint?: string;    // from discovery or manual
  token_endpoint?: string;       // from discovery or manual
  authorization_endpoint?: string;
}
```

**OIDC Flow:**
```
1. User clicks "Login with {Provider}"
2. Redirect to provider's authorization endpoint
3. User authenticates with provider
4. Provider redirects back with authorization code
5. Exchange code for tokens
6. Fetch user info from userinfo endpoint
7. Create/update user in DB
8. Issue JWT session tokens
9. Redirect to app
```

**User Mapping:**
```typescript
interface OIDCUserInfo {
  sub: string;           // Unique subject ID → oidc_subject
  preferred_username: string;  // → username
  email?: string;        // → email
  name?: string;         // → display name
  picture?: string;      // → avatar_url
}
```

**Role Assignment:**
- First OIDC user → Admin (same as current Plex behavior)
- Subsequent users → User role
- Optional: OIDC group/claim mapping for admin role

### 4.2.1 OIDC Access Control (Authorization)

**Problem:** OIDC only handles authentication ("who are you?"), not authorization ("can you use this app?"). Without access control, anyone with an account on your identity provider could access ReadMeABook.

**Comparison with Plex:**
- Plex OAuth has built-in access control: user must have access to your configured Plex server
- OIDC has no equivalent - we must implement our own access control

**Access Control Options:**

| Method | Description | Config Complexity | Recommended |
|--------|-------------|-------------------|-------------|
| **OIDC Group Claim** | Require membership in specific group | Medium | ✅ Yes |
| **Allowed Users List** | Admin maintains list of allowed emails | Low | ✅ Yes |
| **Admin Approval** | Users auto-created but pending until approved | Low | ✅ Yes |
| **Open Access** | Anyone who authenticates gets access | None | ⚠️ Rarely |

**Recommended: OIDC Group Claim (Primary)**

Requires user to be member of a specific group in the identity provider.

```typescript
interface OIDCAccessConfig {
  // Access control (who can use the app)
  access_control_enabled: boolean;      // default: true
  access_control_method: 'group_claim' | 'allowed_list' | 'admin_approval' | 'open';

  // Group claim settings (if method = 'group_claim')
  access_group_claim: string;           // e.g., 'groups' (claim name in token)
  access_group_value: string;           // e.g., 'readmeabook-users' (required group)

  // Allowed list settings (if method = 'allowed_list')
  allowed_emails: string[];             // e.g., ['user@example.com']
  allowed_usernames: string[];          // e.g., ['john', 'jane']
}
```

**Group Claim Flow:**
```
1. User authenticates with OIDC provider
2. Provider returns token with claims:
   {
     "sub": "user-123",
     "email": "john@example.com",
     "groups": ["readmeabook-users", "other-group"]  ← Group claim
   }
3. ReadMeABook checks: Does 'groups' contain 'readmeabook-users'?
4. If YES → Create/update user, issue session
5. If NO → Show error: "You don't have access to this application"
```

**Provider Setup Examples:**

**Authentik:**
1. Create group `readmeabook-users` in Authentik
2. Add allowed users to the group
3. In Application → Provider → Advanced Settings:
   - Add scope mapping for `groups` claim
4. ReadMeABook config: `access_group_claim: 'groups'`, `access_group_value: 'readmeabook-users'`

**Keycloak:**
1. Create group `readmeabook-users` in your realm
2. Add allowed users to the group
3. In Client → Mappers → Add mapper:
   - Type: Group Membership
   - Token Claim Name: `groups`
4. ReadMeABook config: same as above

**Allowed List Flow (Alternative):**
```
1. Admin adds allowed emails/usernames in ReadMeABook settings
2. User authenticates with OIDC provider
3. ReadMeABook checks: Is user's email in allowed list?
4. If YES → Create/update user, issue session
5. If NO → Show error: "Your account is not authorized"
```

**Admin Approval Flow (Alternative):**
```
1. User authenticates with OIDC provider
2. User record created with status: 'pending_approval'
3. User sees: "Your account is pending admin approval"
4. Admin sees pending users in admin panel
5. Admin approves → User can now access app
```

**Setup Wizard Configuration:**
```
┌─────────────────────────────────────────────────────────────┐
│  OIDC Access Control                                        │
│                                                             │
│  How should we control who can access ReadMeABook?          │
│                                                             │
│  ○ Require OIDC group membership (recommended)              │
│    Users must be in a specific group in your provider       │
│    Group claim name: [groups_________]                      │
│    Required group:   [readmeabook-users]                    │
│                                                             │
│  ○ Maintain allowed users list                              │
│    You'll manually add allowed emails in settings           │
│                                                             │
│  ○ Require admin approval                                   │
│    Anyone can login, but must be approved first             │
│                                                             │
│  ○ Open access (not recommended)                            │
│    Anyone who can authenticate will have access             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2.2 OIDC Role Assignment

**Admin Claim Mapping (Optional):**
```typescript
interface OIDCAdminConfig {
  enabled: boolean;
  claim_name: string;      // e.g., 'groups', 'roles', 'is_admin'
  claim_value: string;     // e.g., 'readmeabook-admin', 'admin'
}
```

**Note:** This is separate from access control. Access control determines WHO can use the app. Admin claim mapping determines which users get admin ROLE.

### 4.3 Manual Registration

**Toggle:** `auth.allow_registration` (boolean, default: false)

**When Enabled:**
- Registration form on login page
- Username + password signup
- Optional admin approval before access granted

**Registration Config:**
```typescript
interface RegistrationConfig {
  enabled: boolean;
  require_admin_approval: boolean;  // if true, new users pending until approved
  default_role: 'user';             // always 'user', admin promotes manually
}
```

**Registration Flow:**
```
1. User fills registration form (username, password)
2. Validate username uniqueness
3. Hash password (bcrypt)
4. If admin approval required:
   - Create user with status: 'pending_approval'
   - User sees: "Account pending admin approval"
   - Admin approves in admin panel
5. If no approval required:
   - Create user with status: 'approved'
   - User can login immediately
```

**User Table for Local Auth:**
```sql
-- Uses existing authToken field (bcrypt hash)
-- New field:
ALTER TABLE users ADD COLUMN registration_status VARCHAR(50);
-- Values: 'pending_approval' | 'approved' | 'rejected'
```

### 4.4 Login Page Changes

**Plex Mode:**
- Current login page (Plex OAuth button)
- No changes

**Audiobookshelf Mode:**

```
┌─────────────────────────────────────────┐
│           ReadMeABook                   │
│                                         │
│  [Login with {OIDC Provider}]           │  ← If OIDC configured
│                                         │
│  ─────────── OR ───────────             │  ← If both enabled
│                                         │
│  Username: [_______________]            │  ← If registration enabled
│  Password: [_______________]            │
│  [Login]                                │
│                                         │
│  Don't have an account? [Register]      │  ← If registration enabled
│                                         │
└─────────────────────────────────────────┘
```

**Components:**
- `OIDCLoginButton` - Dynamic provider name
- `LocalLoginForm` - Username/password
- `RegistrationForm` - New user signup

---

## 5. Setup Wizard Modifications

### 5.1 New Setup Flow

**Step 1: Welcome** (unchanged)

**Step 2: Backend Selection** (NEW)
```
Choose your audiobook library backend:

○ Plex Media Server
  Use Plex for library management and authentication

○ Audiobookshelf
  Use Audiobookshelf for library management
  Choose OIDC or manual registration for authentication
```

**Step 3A (Plex Mode): Plex Setup** (current Step 3)
- Server URL, OAuth, library selection

**Step 3B (ABS Mode): Audiobookshelf Setup** (NEW)
- Server URL
- API token (with instructions to generate)
- Library selection (audiobook libraries only)
- Test connection

**Step 4A (Plex Mode): Skip** (Plex OAuth handles auth)

**Step 4B (ABS Mode): Authentication Setup** (NEW)
```
Choose authentication method:

○ OIDC Provider
  Use Authentik, Keycloak, or other OIDC provider

○ Manual Registration
  Users create accounts with username/password

○ Both
  Enable OIDC as primary, allow password fallback
```

**Step 4B-OIDC: OIDC Configuration** (NEW)
- Provider name
- Issuer URL
- Client ID
- Client Secret
- Test connection (validates discovery)

**Step 4B-Manual: Registration Settings** (NEW)
- Enable/disable registration
- Require email verification toggle
- Require admin approval toggle
- Allowed email domains (optional)

**Step 5: Admin Account** (modified)
- **Plex Mode:** Current behavior (Plex OAuth creates admin)
- **ABS + OIDC:** First OIDC login becomes admin (skip this step)
- **ABS + Manual:** Create admin username/password here

**Remaining Steps:** Prowlarr, Download Client, Paths, BookDate, Review, Finalize (unchanged)

### 5.2 Setup State Interface

```typescript
interface SetupState {
  currentStep: number;

  // Backend selection
  backendMode: 'plex' | 'audiobookshelf';

  // Plex config (if mode=plex)
  plexUrl: string;
  plexToken: string;
  plexLibraryId: string;

  // ABS config (if mode=audiobookshelf)
  absUrl: string;
  absApiToken: string;
  absLibraryId: string;

  // Auth config (if mode=audiobookshelf)
  authMethod: 'oidc' | 'manual' | 'both';

  // OIDC config
  oidcProviderName: string;
  oidcIssuerUrl: string;
  oidcClientId: string;
  oidcClientSecret: string;

  // Manual registration config
  registrationEnabled: boolean;
  requireEmailVerification: boolean;
  requireAdminApproval: boolean;
  allowedEmailDomains: string[];

  // Admin account (manual auth only)
  adminUsername: string;
  adminEmail: string;
  adminPassword: string;

  // Rest unchanged...
  prowlarrUrl: string;
  prowlarrApiKey: string;
  // ...
}
```

---

## 6. Settings Pages Modifications

### 6.1 New Settings Sections

**Backend Mode Display (Read-only):**
```
Backend Mode: Audiobookshelf
⚠️ Cannot be changed after setup. Reset instance to switch backends.
```

**Audiobookshelf Settings (if mode=audiobookshelf):**
- Server URL
- API Token (masked)
- Library selection
- Test connection
- Same validation pattern as Plex settings

**OIDC Settings (if auth=oidc):**
- Provider name
- Issuer URL
- Client ID
- Client Secret (masked)
- Test connection (validates discovery)

**Registration Settings (if auth includes manual):**
- Enable/disable registration toggle
- Email verification toggle
- Admin approval toggle
- Allowed email domains

### 6.2 Conditional Tab Display

```typescript
const settingsTabs = [
  { id: 'library', label: mode === 'plex' ? 'Plex' : 'Audiobookshelf' },
  { id: 'auth', label: 'Authentication', show: mode === 'audiobookshelf' },
  { id: 'prowlarr', label: 'Prowlarr' },
  { id: 'download', label: 'Download Client' },
  { id: 'paths', label: 'Paths' },
  { id: 'bookdate', label: 'BookDate' },
  { id: 'account', label: 'Account', show: isLocalAdmin },
];
```

---

## 7. Feature Parity Matrix

| Feature | Plex Mode | Audiobookshelf Mode |
|---------|-----------|---------------------|
| Library scanning | ✅ Plex API | ✅ ABS API |
| Availability detection | ✅ plexGuid | ✅ abs_item_id + ASIN |
| Recently added polling | ✅ Plex API | ✅ ABS API + webhooks |
| Fuzzy matching | ✅ Title/Author | ✅ Title/Author + ASIN/ISBN |
| File organization | ✅ Author/Title | ✅ Author/Title (same) |
| Authentication | ✅ Plex OAuth | ✅ OIDC / Manual |
| Plex Home profiles | ✅ Supported | ❌ N/A |
| BookDate (AI recs) | ✅ User ratings | ⚠️ No ratings in ABS |
| Request management | ✅ Full | ✅ Full |
| Admin dashboard | ✅ Full | ✅ Full |

**BookDate Limitation (ABS Mode):**
- Audiobookshelf doesn't have per-user ratings like Plex
- BookDate recommendations based on library content + custom prompt only
- "Rated books only" scope not available in ABS mode

---

## 8. API Changes

### 8.1 New Endpoints

**Library (Abstracted):**
```
GET  /api/library/info          → Server info (works for both backends)
GET  /api/library/items         → Library items
GET  /api/library/recent        → Recently added
POST /api/library/scan          → Trigger scan
```

**Authentication:**
```
GET  /api/auth/oidc/login       → Initiate OIDC flow
GET  /api/auth/oidc/callback    → Handle OIDC callback
POST /api/auth/register         → Create local account
POST /api/auth/local/login      → Login with username/password
GET  /api/auth/providers        → List enabled auth providers
```

**Setup:**
```
POST /api/setup/test-abs        → Test Audiobookshelf connection
POST /api/setup/test-oidc       → Test OIDC configuration
```

**Settings:**
```
GET  /api/admin/settings/abs           → Get ABS config
PUT  /api/admin/settings/abs           → Update ABS config
GET  /api/admin/settings/oidc          → Get OIDC config
PUT  /api/admin/settings/oidc          → Update OIDC config
GET  /api/admin/settings/registration  → Get registration config
PUT  /api/admin/settings/registration  → Update registration config
```

### 8.2 Modified Endpoints

**Existing endpoints use abstraction layer:**
```
GET /api/discovery/*    → Uses ILibraryService for availability
GET /api/requests/*     → Uses ILibraryService for availability
POST /api/requests      → Uses ILibraryService for duplicate check
```

---

## 9. Migration & Compatibility

### 9.1 No Migration Path

**By Design:** No automated migration between backends.

**Rationale:**
- User data (requests, history) may not map cleanly
- Library IDs are incompatible
- Auth providers change completely
- Clean slate ensures consistency

**User Experience:**
- Reset instance to switch backends
- Re-run setup wizard
- Existing requests/history lost (or export feature in future)

### 9.2 Backward Compatibility

**Existing Plex Installations:**
- Unaffected by this feature
- `system.backend_mode` defaults to `plex`
- No setup wizard re-run required
- All existing functionality preserved

---

## 10. Security Considerations

### 10.1 OIDC Security

- Use PKCE (Proof Key for Code Exchange) for authorization flow
- Validate `state` parameter to prevent CSRF
- Validate `nonce` in ID token
- Validate token signatures using provider's JWKS
- Validate issuer and audience claims
- Store client secret encrypted (AES-256)
- Use secure, HTTP-only cookies for refresh tokens

### 10.2 Registration Security

- Rate limit registration attempts (5 per hour per IP)
- Password requirements: min 8 chars
- Secure password hashing (bcrypt, 10+ rounds)
- Admin approval adds human review layer (optional)

### 10.3 Audiobookshelf API Security

- API token stored encrypted
- Validate SSL certificates
- Sanitize all input from ABS responses
- Rate limit API calls to prevent DoS

---

## 11. Implementation Phases

### Phase 1: Foundation (Abstraction Layer)

**Scope:**
- Create `ILibraryService` interface
- Refactor Plex code into `PlexLibraryService`
- Create `IAuthProvider` interface
- Refactor Plex OAuth into `PlexAuthProvider`
- Add `system.backend_mode` config key
- Database schema additions

**Files to Create/Modify:**
```
src/lib/services/library/
├── ILibraryService.ts          # Interface
├── PlexLibraryService.ts       # Refactored Plex
├── factory.ts                  # Service factory

src/lib/services/auth/
├── IAuthProvider.ts            # Interface
├── PlexAuthProvider.ts         # Refactored Plex OAuth
├── factory.ts                  # Provider factory

prisma/schema.prisma            # Schema updates
```

**Tests:**
- Existing Plex functionality unchanged
- Service factory returns correct implementation

### Phase 2: Audiobookshelf Integration

**Scope:**
- Implement `AudiobookshelfLibraryService`
- ABS connection testing
- Library scanning
- Availability detection
- Recently added polling
- Audiobook matching (ASIN/ISBN support)

**Files to Create:**
```
src/lib/services/library/
├── AudiobookshelfLibraryService.ts

src/lib/services/audiobookshelf/
├── api.ts                      # ABS API client
├── types.ts                    # ABS type definitions
├── matcher.ts                  # Enhanced matcher

documentation/integrations/
├── audiobookshelf.md           # ABS integration docs
```

**Tests:**
- ABS connection validation
- Library item fetching
- Matching algorithm with ASIN/ISBN

### Phase 3: OIDC Authentication

**Scope:**
- Implement `OIDCAuthProvider`
- OIDC discovery support
- Authorization flow with PKCE
- Token validation
- User creation/mapping
- **Access control implementation** (group claim, allowed list, admin approval)
- Admin role claim mapping (optional)

**Files to Create:**
```
src/lib/services/auth/
├── OIDCAuthProvider.ts

src/app/api/auth/oidc/
├── login/route.ts
├── callback/route.ts

src/lib/utils/
├── oidc.ts                     # OIDC utilities
```

**Dependencies:**
- `openid-client` npm package (or similar)

**Tests:**
- OIDC flow end-to-end
- Token validation
- User mapping

### Phase 4: Manual Registration

**Scope:**
- Implement `LocalAuthProvider`
- Registration endpoint
- Local login endpoint
- Admin approval workflow (optional)

**Files to Create:**
```
src/lib/services/auth/
├── LocalAuthProvider.ts

src/app/api/auth/
├── register/route.ts
├── local/login/route.ts

src/components/auth/
├── RegistrationForm.tsx
├── LocalLoginForm.tsx
```

**Tests:**
- Registration flow
- Password validation
- Admin approval workflow

### Phase 5: Setup Wizard Modifications

**Scope:**
- Backend selection step
- ABS configuration step
- Auth method selection step
- OIDC configuration step
- Registration settings step
- Conditional step flow

**Files to Modify:**
```
src/app/setup/
├── page.tsx                    # Add new steps
├── components/
│   ├── BackendSelectionStep.tsx   # NEW
│   ├── AudiobookshelfStep.tsx     # NEW
│   ├── AuthMethodStep.tsx         # NEW
│   ├── OIDCConfigStep.tsx         # NEW
│   ├── RegistrationStep.tsx       # NEW
│   ├── AdminAccountStep.tsx       # MODIFY
```

**Tests:**
- Full setup flow for each mode
- Validation at each step
- Config persistence

### Phase 6: Settings & UI Updates

**Scope:**
- ABS settings tab
- OIDC settings tab
- Registration settings tab
- Login page modes
- Conditional UI elements

**Files to Modify:**
```
src/app/admin/settings/
├── page.tsx                    # Add new tabs
├── components/
│   ├── AudiobookshelfTab.tsx   # NEW
│   ├── OIDCTab.tsx             # NEW
│   ├── RegistrationTab.tsx     # NEW

src/app/login/
├── page.tsx                    # Multi-mode login
```

### Phase 7: Testing & Documentation

**Scope:**
- Integration tests for all modes
- Documentation updates
- User guides
- Troubleshooting guides

**Deliverables:**
- End-to-end tests for Plex mode (regression)
- End-to-end tests for ABS + OIDC mode
- End-to-end tests for ABS + Manual mode
- Updated documentation
- User setup guides

---

## 12. Configuration Reference

### 12.1 Environment Variables (Optional Overrides)

```env
# Backend mode (cannot override after setup)
BACKEND_MODE=audiobookshelf

# Audiobookshelf
ABS_URL=http://audiobookshelf:13378
ABS_API_TOKEN=xxxx

# OIDC
OIDC_ISSUER=https://auth.example.com
OIDC_CLIENT_ID=readmeabook
OIDC_CLIENT_SECRET=xxxx

# Registration
REGISTRATION_ENABLED=true
REQUIRE_ADMIN_APPROVAL=true
```

### 12.2 Database Configuration Keys

```
system.backend_mode          = 'plex' | 'audiobookshelf'

# Audiobookshelf
abs.server_url               = 'http://...'
abs.api_token                = (encrypted)
abs.library_id               = 'lib_xxx'
abs.server_id                = 'xxx'

# OIDC
oidc.enabled                 = 'true' | 'false'
oidc.provider_name           = 'Authentik'
oidc.issuer_url              = 'https://...'
oidc.client_id               = 'xxx'
oidc.client_secret           = (encrypted)

# OIDC Access Control (Authorization)
oidc.access_control_method   = 'group_claim' | 'allowed_list' | 'admin_approval' | 'open'
oidc.access_group_claim      = 'groups'              # claim name containing groups
oidc.access_group_value      = 'readmeabook-users'   # required group for access
oidc.allowed_emails          = '[]'                  # JSON array (if method = 'allowed_list')
oidc.allowed_usernames       = '[]'                  # JSON array (if method = 'allowed_list')

# OIDC Admin Role Mapping (separate from access control)
oidc.admin_claim_enabled     = 'false'
oidc.admin_claim_name        = 'groups'
oidc.admin_claim_value       = 'readmeabook-admin'

# Registration
auth.registration_enabled           = 'false'
auth.require_admin_approval         = 'false'
```

---

## 13. Success Metrics

### 13.1 Functional Requirements

- [ ] Plex mode unchanged (regression tests pass)
- [ ] ABS library scanning works
- [ ] ABS availability detection works
- [ ] OIDC authentication flow works
- [ ] Manual registration flow works
- [ ] Setup wizard handles all modes
- [ ] Settings pages handle all modes
- [ ] BookDate works in ABS mode (with limitations)

### 13.2 Non-Functional Requirements

- [ ] ABS API response time < 2s for library fetch
- [ ] OIDC login completes < 5s (excluding provider time)
- [ ] No breaking changes to existing Plex installations
- [ ] Documentation complete for all modes

---

## 14. Open Questions

1. **ABS Webhooks:** Should we use ABS webhooks for real-time updates instead of polling?
   - Pro: More efficient, faster updates
   - Con: Requires ABS to reach ReadMeABook (network config)

2. **User Data Export:** Should we provide export functionality before mode switch?
   - Pro: Better user experience
   - Con: Additional complexity

3. **Email Service:** What email provider for verification emails?
   - Options: SMTP config, SendGrid, Mailgun
   - Or: Skip email verification initially

4. **ABS User Ratings:** Should we add rating functionality in ABS mode?
   - Option: Store ratings in ReadMeABook DB
   - Or: Skip ratings, rely on custom prompts for BookDate

5. **Multiple OIDC Providers:** Support multiple providers simultaneously?
   - Initial: Single provider
   - Future: Multiple providers

---

## 15. Appendix

### A. Audiobookshelf API Token Generation

**Instructions for users:**
1. Login to Audiobookshelf web UI as admin
2. Go to Settings → Users
3. Click on your user
4. Scroll to "API Token" section
5. Click "Generate Token"
6. Copy token for ReadMeABook setup

### B. OIDC Provider Setup Guides

**Authentik:**
1. Create Application in Authentik
2. Create OAuth2/OIDC Provider
3. Set redirect URI: `{readmeabook_url}/api/auth/oidc/callback`
4. Note Client ID and Client Secret
5. Issuer URL: `https://{authentik_domain}/application/o/{app_slug}/`

**Keycloak:**
1. Create Realm or use existing
2. Create Client (OpenID Connect)
3. Set redirect URI
4. Enable Client Authentication
5. Note Client ID and Secret
6. Issuer URL: `https://{keycloak}/realms/{realm}`

### C. Related Documentation

- [Current Auth System](../backend/services/auth.md)
- [Current Plex Integration](../integrations/plex.md)
- [Database Schema](../backend/database.md)
- [Setup Wizard](../setup-wizard.md)
- [Settings Pages](../settings-pages.md)

---

**Document Status:** PRD Complete - Ready for Review
**Next Steps:** Architecture review → Phase 1 implementation approval
