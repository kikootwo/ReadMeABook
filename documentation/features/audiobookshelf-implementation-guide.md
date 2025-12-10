# Audiobookshelf Integration - Implementation Guide

**Purpose:** Step-by-step implementation instructions for AI agents to build the Audiobookshelf integration feature.

**Prerequisites:**
- Read the full PRD: `documentation/features/audiobookshelf-integration.md`
- Understand current architecture via `documentation/TABLEOFCONTENTS.md`

**Critical Rules:**
1. Complete each phase fully before moving to the next
2. Run tests after each phase to verify no regressions
3. Existing Plex functionality must remain unchanged
4. Follow existing code patterns and file structure conventions
5. Update documentation as you implement
6. Keep files under 400 lines - split if needed

---

## Phase 1: Foundation (Abstraction Layer)

### 1.1 Create Library Service Interface

**Goal:** Abstract library operations so both Plex and Audiobookshelf can be used interchangeably.

**Create file:** `src/lib/services/library/ILibraryService.ts`

```typescript
/**
 * Library Service Interface
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

export interface ServerInfo {
  name: string;
  version: string;
  platform?: string;
  identifier: string;  // machineIdentifier (Plex) or serverId (ABS)
}

export interface Library {
  id: string;
  name: string;
  type: string;
  itemCount?: number;
}

export interface LibraryItem {
  id: string;              // ratingKey (Plex) or item id (ABS)
  externalId: string;      // plexGuid or abs_item_id
  title: string;
  author: string;
  narrator?: string;
  description?: string;
  coverUrl?: string;
  duration?: number;       // seconds
  asin?: string;
  isbn?: string;
  year?: number;
  addedAt: Date;
  updatedAt: Date;
}

export interface LibraryConnectionResult {
  success: boolean;
  serverInfo?: ServerInfo;
  error?: string;
}

export interface ILibraryService {
  // Connection
  testConnection(): Promise<LibraryConnectionResult>;
  getServerInfo(): Promise<ServerInfo>;

  // Libraries
  getLibraries(): Promise<Library[]>;
  getLibraryItems(libraryId: string): Promise<LibraryItem[]>;
  getRecentlyAdded(libraryId: string, limit: number): Promise<LibraryItem[]>;

  // Items
  getItem(itemId: string): Promise<LibraryItem | null>;
  searchItems(libraryId: string, query: string): Promise<LibraryItem[]>;

  // Scanning
  triggerLibraryScan(libraryId: string): Promise<void>;
}
```

### 1.2 Refactor Existing Plex Code into PlexLibraryService

**Goal:** Move existing Plex library logic into the new interface structure.

**Create file:** `src/lib/services/library/PlexLibraryService.ts`

**Instructions:**
1. Read existing Plex integration code in `src/lib/services/plex/` or similar
2. Identify all library-related functions (getLibraries, scanLibrary, getItems, etc.)
3. Implement `ILibraryService` interface using existing Plex logic
4. Do NOT delete original code yet - keep for reference
5. Map Plex data structures to the generic `LibraryItem` interface:
   - `ratingKey` → `id`
   - `guid` → `externalId`
   - `parentTitle` → `author`
   - `grandparentTitle` or metadata → `narrator`

**Key mapping:**
```typescript
function mapPlexItemToLibraryItem(plexItem: PlexAudiobook): LibraryItem {
  return {
    id: plexItem.ratingKey,
    externalId: plexItem.guid,
    title: plexItem.title,
    author: plexItem.author,  // from parentTitle
    narrator: plexItem.narrator,
    description: plexItem.summary,
    coverUrl: plexItem.thumb,
    duration: plexItem.duration ? Math.floor(plexItem.duration / 1000) : undefined,
    asin: extractAsinFromGuid(plexItem.guid),
    year: plexItem.year,
    addedAt: new Date(plexItem.addedAt * 1000),
    updatedAt: new Date(plexItem.updatedAt * 1000),
  };
}
```

### 1.3 Create Library Service Factory

**Create file:** `src/lib/services/library/index.ts`

```typescript
/**
 * Library Service Factory
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { ILibraryService } from './ILibraryService';
import { PlexLibraryService } from './PlexLibraryService';
// import { AudiobookshelfLibraryService } from './AudiobookshelfLibraryService'; // Phase 2

export async function getLibraryService(): Promise<ILibraryService> {
  // TODO: Read from config once backend mode is implemented
  // const mode = await getConfig('system.backend_mode');
  // if (mode === 'audiobookshelf') {
  //   return new AudiobookshelfLibraryService();
  // }
  return new PlexLibraryService();
}

export * from './ILibraryService';
```

### 1.4 Create Auth Provider Interface

**Create file:** `src/lib/services/auth/IAuthProvider.ts`

```typescript
/**
 * Auth Provider Interface
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

export interface UserInfo {
  id: string;              // External ID (plexId, oidc subject, or local username)
  username: string;
  email?: string;
  avatarUrl?: string;
  isAdmin?: boolean;       // From claims or first-user logic
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginInitiation {
  redirectUrl?: string;    // For OAuth/OIDC flows
  pinId?: string;          // For Plex PIN flow
  state?: string;          // CSRF state token
}

export interface CallbackParams {
  code?: string;           // Authorization code
  state?: string;          // CSRF state
  pinId?: string;          // Plex PIN
  error?: string;
}

export interface AuthResult {
  success: boolean;
  user?: UserInfo;
  tokens?: AuthTokens;
  error?: string;
  requiresApproval?: boolean;  // For pending approval flow
  requiresProfileSelection?: boolean;  // For Plex Home
  profiles?: any[];  // Plex Home profiles
}

export interface IAuthProvider {
  type: 'plex' | 'oidc' | 'local';

  // Auth initiation
  initiateLogin(): Promise<LoginInitiation>;

  // Auth completion
  handleCallback(params: CallbackParams): Promise<AuthResult>;

  // Token refresh
  refreshToken(refreshToken: string): Promise<AuthTokens | null>;

  // Validation
  validateAccess(userInfo: UserInfo): Promise<boolean>;
}
```

### 1.5 Refactor Plex OAuth into PlexAuthProvider

**Create file:** `src/lib/services/auth/PlexAuthProvider.ts`

**Instructions:**
1. Read existing auth code in `src/lib/services/auth.ts` or `src/app/api/auth/plex/`
2. Extract Plex OAuth logic into `PlexAuthProvider` implementing `IAuthProvider`
3. Keep existing Plex Home profile support
4. Map Plex user data to generic `UserInfo` interface

### 1.6 Create Auth Provider Factory

**Create file:** `src/lib/services/auth/index.ts`

```typescript
/**
 * Auth Provider Factory
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { IAuthProvider } from './IAuthProvider';
import { PlexAuthProvider } from './PlexAuthProvider';
// import { OIDCAuthProvider } from './OIDCAuthProvider'; // Phase 3
// import { LocalAuthProvider } from './LocalAuthProvider'; // Phase 4

export type AuthMethod = 'plex' | 'oidc' | 'local';

export async function getAuthProvider(method?: AuthMethod): Promise<IAuthProvider> {
  // TODO: Read from config once backend mode is implemented
  // const mode = await getConfig('system.backend_mode');
  // const authMethod = method || await getConfig('auth.method');

  // if (authMethod === 'oidc') return new OIDCAuthProvider();
  // if (authMethod === 'local') return new LocalAuthProvider();

  return new PlexAuthProvider();
}

export * from './IAuthProvider';
```

### 1.7 Update Database Schema

**Modify:** `prisma/schema.prisma`

Add new fields to User model:
```prisma
model User {
  // ... existing fields ...

  // New fields for multi-auth support
  authProvider        String?    @map("auth_provider")  // 'plex' | 'oidc' | 'local'
  oidcSubject         String?    @map("oidc_subject")   // OIDC subject ID
  oidcProvider        String?    @map("oidc_provider")  // e.g., 'authentik'
  registrationStatus  String?    @map("registration_status")  // 'pending_approval' | 'approved' | 'rejected'
}
```

Add new Configuration keys (will be set during setup):
```prisma
// These are stored in Configuration table, not schema changes
// system.backend_mode = 'plex' | 'audiobookshelf'
```

**Run migration:**
```bash
npx prisma db push
```

### 1.8 Add Backend Mode Config Helper

**Modify:** `src/lib/services/config.service.ts` (or create if doesn't exist)

Add function to get backend mode:
```typescript
export async function getBackendMode(): Promise<'plex' | 'audiobookshelf'> {
  const config = await prisma.configuration.findUnique({
    where: { key: 'system.backend_mode' }
  });
  return (config?.value as 'plex' | 'audiobookshelf') || 'plex';
}

export async function isAudiobookshelfMode(): Promise<boolean> {
  return (await getBackendMode()) === 'audiobookshelf';
}
```

### 1.9 Phase 1 Verification

**Tests to run:**
1. Existing Plex authentication still works
2. Existing library scanning still works
3. All existing tests pass
4. New interfaces compile without errors

**Checklist:**
- [ ] `ILibraryService` interface created
- [ ] `PlexLibraryService` implements interface with existing logic
- [ ] `IAuthProvider` interface created
- [ ] `PlexAuthProvider` implements interface with existing logic
- [ ] Factory functions created for both services
- [ ] Database schema updated with new fields
- [ ] All existing functionality unchanged

---

## Phase 2: Audiobookshelf Library Integration

### 2.1 Create Audiobookshelf API Client

**Create file:** `src/lib/services/audiobookshelf/api.ts`

```typescript
/**
 * Audiobookshelf API Client
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { getConfig } from '../config.service';

interface ABSRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: any;
}

export async function absRequest<T>(endpoint: string, options: ABSRequestOptions = {}): Promise<T> {
  const serverUrl = await getConfig('abs.server_url');
  const apiToken = await getConfig('abs.api_token', true);  // true = decrypt

  if (!serverUrl || !apiToken) {
    throw new Error('Audiobookshelf not configured');
  }

  const url = `${serverUrl.replace(/\/$/, '')}/api${endpoint}`;

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`ABS API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// API endpoint wrappers
export async function getABSServerInfo() {
  return absRequest<{ version: string; name: string }>('/status');
}

export async function getABSLibraries() {
  const result = await absRequest<{ libraries: any[] }>('/libraries');
  return result.libraries;
}

export async function getABSLibraryItems(libraryId: string) {
  const result = await absRequest<{ results: any[] }>(`/libraries/${libraryId}/items`);
  return result.results;
}

export async function getABSRecentItems(libraryId: string, limit: number) {
  const result = await absRequest<{ results: any[] }>(
    `/libraries/${libraryId}/items?sort=addedAt&desc=1&limit=${limit}`
  );
  return result.results;
}

export async function getABSItem(itemId: string) {
  return absRequest<any>(`/items/${itemId}`);
}

export async function searchABSItems(libraryId: string, query: string) {
  const result = await absRequest<{ book: any[] }>(
    `/libraries/${libraryId}/search?q=${encodeURIComponent(query)}`
  );
  return result.book || [];
}

export async function triggerABSScan(libraryId: string) {
  await absRequest(`/libraries/${libraryId}/scan`, { method: 'POST' });
}
```

### 2.2 Create Audiobookshelf Type Definitions

**Create file:** `src/lib/services/audiobookshelf/types.ts`

```typescript
/**
 * Audiobookshelf Type Definitions
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

export interface ABSLibrary {
  id: string;
  name: string;
  mediaType: 'book' | 'podcast';
  folders: { id: string; fullPath: string }[];
}

export interface ABSBookMetadata {
  title: string;
  subtitle?: string;
  authorName: string;
  authorNameLF?: string;
  narratorName?: string;
  seriesName?: string;
  genres: string[];
  publishedYear?: string;
  description?: string;
  isbn?: string;
  asin?: string;
  language?: string;
  explicit: boolean;
}

export interface ABSAudioFile {
  index: number;
  ino: string;
  metadata: {
    filename: string;
    ext: string;
    path: string;
    size: number;
    mtimeMs: number;
  };
  duration: number;
}

export interface ABSLibraryItem {
  id: string;
  ino: string;
  libraryId: string;
  folderId: string;
  path: string;
  relPath: string;
  isFile: boolean;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  addedAt: number;
  updatedAt: number;
  isMissing: boolean;
  isInvalid: boolean;
  mediaType: 'book';
  media: {
    metadata: ABSBookMetadata;
    coverPath?: string;
    audioFiles: ABSAudioFile[];
    duration: number;
    size: number;
    numTracks: number;
    numAudioFiles: number;
  };
  numFiles: number;
  size: number;
}
```

### 2.3 Create AudiobookshelfLibraryService

**Create file:** `src/lib/services/library/AudiobookshelfLibraryService.ts`

```typescript
/**
 * Audiobookshelf Library Service
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import {
  ILibraryService,
  LibraryConnectionResult,
  ServerInfo,
  Library,
  LibraryItem,
} from './ILibraryService';
import {
  absRequest,
  getABSServerInfo,
  getABSLibraries,
  getABSLibraryItems,
  getABSRecentItems,
  getABSItem,
  searchABSItems,
  triggerABSScan,
} from '../audiobookshelf/api';
import { ABSLibraryItem } from '../audiobookshelf/types';

export class AudiobookshelfLibraryService implements ILibraryService {

  async testConnection(): Promise<LibraryConnectionResult> {
    try {
      const serverInfo = await this.getServerInfo();
      return {
        success: true,
        serverInfo,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getServerInfo(): Promise<ServerInfo> {
    const info = await getABSServerInfo();
    return {
      name: info.name || 'Audiobookshelf',
      version: info.version,
      identifier: info.name,  // ABS doesn't have unique identifier like Plex
    };
  }

  async getLibraries(): Promise<Library[]> {
    const libraries = await getABSLibraries();
    return libraries
      .filter((lib: any) => lib.mediaType === 'book')  // Only audiobook libraries
      .map((lib: any) => ({
        id: lib.id,
        name: lib.name,
        type: lib.mediaType,
        itemCount: lib.stats?.totalItems,
      }));
  }

  async getLibraryItems(libraryId: string): Promise<LibraryItem[]> {
    const items = await getABSLibraryItems(libraryId);
    return items.map(this.mapABSItemToLibraryItem);
  }

  async getRecentlyAdded(libraryId: string, limit: number): Promise<LibraryItem[]> {
    const items = await getABSRecentItems(libraryId, limit);
    return items.map(this.mapABSItemToLibraryItem);
  }

  async getItem(itemId: string): Promise<LibraryItem | null> {
    try {
      const item = await getABSItem(itemId);
      return this.mapABSItemToLibraryItem(item);
    } catch {
      return null;
    }
  }

  async searchItems(libraryId: string, query: string): Promise<LibraryItem[]> {
    const items = await searchABSItems(libraryId, query);
    return items.map((result: any) => this.mapABSItemToLibraryItem(result.libraryItem));
  }

  async triggerLibraryScan(libraryId: string): Promise<void> {
    await triggerABSScan(libraryId);
  }

  private mapABSItemToLibraryItem(item: ABSLibraryItem): LibraryItem {
    const metadata = item.media.metadata;
    return {
      id: item.id,
      externalId: item.id,  // ABS item ID is the external ID
      title: metadata.title,
      author: metadata.authorName,
      narrator: metadata.narratorName,
      description: metadata.description,
      coverUrl: item.media.coverPath ? `/api/items/${item.id}/cover` : undefined,
      duration: item.media.duration,
      asin: metadata.asin,
      isbn: metadata.isbn,
      year: metadata.publishedYear ? parseInt(metadata.publishedYear) : undefined,
      addedAt: new Date(item.addedAt),
      updatedAt: new Date(item.updatedAt),
    };
  }
}
```

### 2.4 Update Library Service Factory

**Modify:** `src/lib/services/library/index.ts`

```typescript
import { ILibraryService } from './ILibraryService';
import { PlexLibraryService } from './PlexLibraryService';
import { AudiobookshelfLibraryService } from './AudiobookshelfLibraryService';
import { getBackendMode } from '../config.service';

export async function getLibraryService(): Promise<ILibraryService> {
  const mode = await getBackendMode();
  if (mode === 'audiobookshelf') {
    return new AudiobookshelfLibraryService();
  }
  return new PlexLibraryService();
}
```

### 2.5 Create ABS Setup Test Endpoint

**Create file:** `src/app/api/setup/test-abs/route.ts`

```typescript
/**
 * Test Audiobookshelf Connection
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { serverUrl, apiToken } = await request.json();

    if (!serverUrl || !apiToken) {
      return NextResponse.json(
        { error: 'Server URL and API token are required' },
        { status: 400 }
      );
    }

    // Test connection
    const response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/status`, {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Connection failed: ${response.status} ${response.statusText}` },
        { status: 400 }
      );
    }

    const serverInfo = await response.json();

    // Get libraries
    const libResponse = await fetch(`${serverUrl.replace(/\/$/, '')}/api/libraries`, {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
      },
    });

    const libData = await libResponse.json();
    const libraries = libData.libraries
      .filter((lib: any) => lib.mediaType === 'book')
      .map((lib: any) => ({
        id: lib.id,
        name: lib.name,
        itemCount: lib.stats?.totalItems || 0,
      }));

    return NextResponse.json({
      success: true,
      serverInfo: {
        name: serverInfo.name || 'Audiobookshelf',
        version: serverInfo.version,
      },
      libraries,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Connection failed' },
      { status: 500 }
    );
  }
}
```

### 2.6 Update Library Scanning Jobs

**Modify existing scan jobs** to use the abstraction layer:

Find files like `src/lib/jobs/processors/plex-scan.ts` or similar.

Replace direct Plex calls with:
```typescript
import { getLibraryService } from '@/lib/services/library';

async function scanLibrary() {
  const libraryService = await getLibraryService();
  const items = await libraryService.getLibraryItems(libraryId);
  // ... rest of scanning logic using generic LibraryItem interface
}
```

### 2.7 Update Audiobook Matcher for ABS

**Modify:** `src/lib/utils/audiobook-matcher.ts` (or create if doesn't exist)

Enhance matching to use ASIN/ISBN from ABS:
```typescript
export function matchAudiobook(
  request: { title: string; author: string; asin?: string; isbn?: string },
  libraryItems: LibraryItem[]
): LibraryItem | null {
  // 1. Exact ASIN match (highest confidence)
  if (request.asin) {
    const asinMatch = libraryItems.find(item =>
      item.asin?.toLowerCase() === request.asin?.toLowerCase()
    );
    if (asinMatch) return asinMatch;
  }

  // 2. Exact ISBN match
  if (request.isbn) {
    const isbnMatch = libraryItems.find(item =>
      item.isbn?.replace(/-/g, '') === request.isbn?.replace(/-/g, '')
    );
    if (isbnMatch) return isbnMatch;
  }

  // 3. Fuzzy title/author match (existing logic)
  return fuzzyMatch(request, libraryItems);
}
```

### 2.8 Phase 2 Verification

**Tests to run:**
1. ABS connection test endpoint works
2. ABS library scanning retrieves items
3. ABS recently added works
4. Plex mode still works unchanged
5. Matching works with ASIN/ISBN

**Checklist:**
- [ ] ABS API client created
- [ ] ABS types defined
- [ ] `AudiobookshelfLibraryService` implements interface
- [ ] Test endpoint for ABS connection
- [ ] Scan jobs use abstraction layer
- [ ] Matcher enhanced for ASIN/ISBN

---

## Phase 3: OIDC Authentication

### 3.1 Install OIDC Dependencies

```bash
npm install openid-client
```

### 3.2 Create OIDC Provider Service

**Create file:** `src/lib/services/auth/OIDCAuthProvider.ts`

```typescript
/**
 * OIDC Auth Provider
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { Issuer, Client, generators } from 'openid-client';
import { getConfig, setConfig } from '../config.service';
import {
  IAuthProvider,
  LoginInitiation,
  CallbackParams,
  AuthResult,
  UserInfo,
  AuthTokens,
} from './IAuthProvider';

export class OIDCAuthProvider implements IAuthProvider {
  type: 'oidc' = 'oidc';
  private client: Client | null = null;

  private async getClient(): Promise<Client> {
    if (this.client) return this.client;

    const issuerUrl = await getConfig('oidc.issuer_url');
    const clientId = await getConfig('oidc.client_id');
    const clientSecret = await getConfig('oidc.client_secret', true);
    const redirectUri = await this.getRedirectUri();

    const issuer = await Issuer.discover(issuerUrl);

    this.client = new issuer.Client({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [redirectUri],
      response_types: ['code'],
    });

    return this.client;
  }

  private async getRedirectUri(): Promise<string> {
    const baseUrl = process.env.NEXTAUTH_URL || process.env.BASE_URL || 'http://localhost:3000';
    return `${baseUrl}/api/auth/oidc/callback`;
  }

  async initiateLogin(): Promise<LoginInitiation> {
    const client = await this.getClient();
    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    // Store state/nonce/verifier in session or encrypted cookie
    // This is a simplified example - use proper session storage
    await setConfig('oidc.pending_state', state);
    await setConfig('oidc.pending_nonce', nonce);
    await setConfig('oidc.pending_verifier', codeVerifier);

    const redirectUrl = client.authorizationUrl({
      scope: 'openid profile email groups',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return { redirectUrl, state };
  }

  async handleCallback(params: CallbackParams): Promise<AuthResult> {
    try {
      const client = await this.getClient();
      const redirectUri = await this.getRedirectUri();

      // Retrieve stored values
      const expectedState = await getConfig('oidc.pending_state');
      const nonce = await getConfig('oidc.pending_nonce');
      const codeVerifier = await getConfig('oidc.pending_verifier');

      if (params.state !== expectedState) {
        return { success: false, error: 'Invalid state parameter' };
      }

      const tokenSet = await client.callback(redirectUri, { code: params.code, state: params.state }, {
        code_verifier: codeVerifier,
        nonce,
      });

      const userinfo = await client.userinfo(tokenSet.access_token!);

      // Check access control
      const hasAccess = await this.checkAccessControl(userinfo);
      if (!hasAccess) {
        return {
          success: false,
          error: 'You do not have access to this application'
        };
      }

      // Map to UserInfo
      const user: UserInfo = {
        id: userinfo.sub,
        username: userinfo.preferred_username || userinfo.email || userinfo.sub,
        email: userinfo.email as string | undefined,
        avatarUrl: userinfo.picture as string | undefined,
        isAdmin: await this.checkAdminClaim(userinfo),
      };

      // Check if admin approval required
      const accessMethod = await getConfig('oidc.access_control_method');
      if (accessMethod === 'admin_approval') {
        const existingUser = await this.findExistingUser(user.id);
        if (!existingUser) {
          // Create pending user
          await this.createPendingUser(user);
          return { success: false, requiresApproval: true };
        }
        if (existingUser.registrationStatus === 'pending_approval') {
          return { success: false, requiresApproval: true };
        }
      }

      // Generate session tokens
      const tokens = await this.generateSessionTokens(user);

      return { success: true, user, tokens };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authentication failed'
      };
    }
  }

  private async checkAccessControl(userinfo: any): Promise<boolean> {
    const method = await getConfig('oidc.access_control_method');

    switch (method) {
      case 'open':
        return true;

      case 'group_claim': {
        const claimName = await getConfig('oidc.access_group_claim') || 'groups';
        const requiredGroup = await getConfig('oidc.access_group_value');
        const userGroups = userinfo[claimName] || [];
        return Array.isArray(userGroups) && userGroups.includes(requiredGroup);
      }

      case 'allowed_list': {
        const allowedEmails = JSON.parse(await getConfig('oidc.allowed_emails') || '[]');
        const allowedUsernames = JSON.parse(await getConfig('oidc.allowed_usernames') || '[]');
        return (
          allowedEmails.includes(userinfo.email) ||
          allowedUsernames.includes(userinfo.preferred_username)
        );
      }

      case 'admin_approval':
        return true;  // Handled separately

      default:
        return false;
    }
  }

  private async checkAdminClaim(userinfo: any): Promise<boolean> {
    const enabled = await getConfig('oidc.admin_claim_enabled');
    if (enabled !== 'true') {
      // First user becomes admin logic handled elsewhere
      return false;
    }

    const claimName = await getConfig('oidc.admin_claim_name') || 'groups';
    const claimValue = await getConfig('oidc.admin_claim_value');
    const userClaims = userinfo[claimName] || [];

    if (Array.isArray(userClaims)) {
      return userClaims.includes(claimValue);
    }
    return userClaims === claimValue;
  }

  async refreshToken(refreshToken: string): Promise<AuthTokens | null> {
    // Implement JWT refresh logic (reuse existing JWT refresh code)
    return null;
  }

  async validateAccess(userInfo: UserInfo): Promise<boolean> {
    return true;  // Already validated in handleCallback
  }

  private async findExistingUser(oidcSubject: string) {
    // Query database for user with this OIDC subject
    return null;  // Implement with Prisma
  }

  private async createPendingUser(user: UserInfo) {
    // Create user with registrationStatus: 'pending_approval'
    // Implement with Prisma
  }

  private async generateSessionTokens(user: UserInfo): Promise<AuthTokens> {
    // Reuse existing JWT generation logic
    return { accessToken: '', refreshToken: '' };
  }
}
```

### 3.3 Create OIDC Login Endpoint

**Create file:** `src/app/api/auth/oidc/login/route.ts`

```typescript
/**
 * OIDC Login Initiation
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextResponse } from 'next/server';
import { OIDCAuthProvider } from '@/lib/services/auth/OIDCAuthProvider';

export async function GET() {
  try {
    const provider = new OIDCAuthProvider();
    const { redirectUrl } = await provider.initiateLogin();

    return NextResponse.redirect(redirectUrl!);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to initiate login' },
      { status: 500 }
    );
  }
}
```

### 3.4 Create OIDC Callback Endpoint

**Create file:** `src/app/api/auth/oidc/callback/route.ts`

```typescript
/**
 * OIDC Callback Handler
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { OIDCAuthProvider } from '@/lib/services/auth/OIDCAuthProvider';
import { createOrUpdateUser, generateJWT } from '@/lib/services/auth';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(`/login?error=${encodeURIComponent(error)}`);
  }

  try {
    const provider = new OIDCAuthProvider();
    const result = await provider.handleCallback({ code: code!, state: state! });

    if (!result.success) {
      if (result.requiresApproval) {
        return NextResponse.redirect('/login?pending=approval');
      }
      return NextResponse.redirect(`/login?error=${encodeURIComponent(result.error || 'Authentication failed')}`);
    }

    // Create or update user in database
    const dbUser = await createOrUpdateUser({
      authProvider: 'oidc',
      oidcSubject: result.user!.id,
      username: result.user!.username,
      email: result.user!.email,
      avatarUrl: result.user!.avatarUrl,
      isAdmin: result.user!.isAdmin,
    });

    // Generate JWT tokens
    const tokens = await generateJWT(dbUser);

    // Set cookies and redirect
    const response = NextResponse.redirect('/');
    response.cookies.set('accessToken', tokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60,  // 1 hour
    });
    response.cookies.set('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7,  // 7 days
    });

    return response;
  } catch (error) {
    console.error('OIDC callback error:', error);
    return NextResponse.redirect('/login?error=auth_failed');
  }
}
```

### 3.5 Create OIDC Test Endpoint

**Create file:** `src/app/api/setup/test-oidc/route.ts`

```typescript
/**
 * Test OIDC Configuration
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { Issuer } from 'openid-client';

export async function POST(request: NextRequest) {
  try {
    const { issuerUrl, clientId, clientSecret } = await request.json();

    if (!issuerUrl || !clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'Issuer URL, Client ID, and Client Secret are required' },
        { status: 400 }
      );
    }

    // Discover OIDC endpoints
    const issuer = await Issuer.discover(issuerUrl);

    return NextResponse.json({
      success: true,
      issuer: {
        issuer: issuer.issuer,
        authorizationEndpoint: issuer.metadata.authorization_endpoint,
        tokenEndpoint: issuer.metadata.token_endpoint,
        userinfoEndpoint: issuer.metadata.userinfo_endpoint,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'OIDC discovery failed' },
      { status: 500 }
    );
  }
}
```

### 3.6 Phase 3 Verification

**Tests to run:**
1. OIDC discovery works with test provider
2. OIDC login redirects correctly
3. OIDC callback creates user
4. Group claim access control works
5. Admin claim mapping works
6. Plex auth still works unchanged

**Checklist:**
- [ ] `openid-client` installed
- [ ] `OIDCAuthProvider` implements interface
- [ ] Login endpoint initiates flow
- [ ] Callback endpoint handles response
- [ ] Access control (group claim) works
- [ ] Test endpoint validates OIDC config

---

## Phase 4: Manual Registration

### 4.1 Create Local Auth Provider

**Create file:** `src/lib/services/auth/LocalAuthProvider.ts`

```typescript
/**
 * Local Auth Provider (Username/Password)
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import {
  IAuthProvider,
  LoginInitiation,
  CallbackParams,
  AuthResult,
  UserInfo,
  AuthTokens,
} from './IAuthProvider';
import { generateJWT } from './jwt';
import { getConfig } from '../config.service';

interface LocalLoginParams extends CallbackParams {
  username: string;
  password: string;
}

interface RegisterParams {
  username: string;
  password: string;
}

export class LocalAuthProvider implements IAuthProvider {
  type: 'local' = 'local';

  async initiateLogin(): Promise<LoginInitiation> {
    // Local auth doesn't need initiation - return empty
    return {};
  }

  async handleCallback(params: CallbackParams): Promise<AuthResult> {
    // This handles login with username/password
    const { username, password } = params as LocalLoginParams;

    if (!username || !password) {
      return { success: false, error: 'Username and password required' };
    }

    // Find user
    const user = await prisma.user.findFirst({
      where: {
        plexUsername: username,
        authProvider: 'local',
      },
    });

    if (!user) {
      return { success: false, error: 'Invalid username or password' };
    }

    // Check registration status
    if (user.registrationStatus === 'pending_approval') {
      return { success: false, requiresApproval: true };
    }

    if (user.registrationStatus === 'rejected') {
      return { success: false, error: 'Account has been rejected' };
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, user.authToken || '');
    if (!passwordValid) {
      return { success: false, error: 'Invalid username or password' };
    }

    // Generate tokens
    const tokens = await generateJWT({
      id: user.id,
      username: user.plexUsername,
      role: user.role,
    });

    return {
      success: true,
      user: {
        id: user.id,
        username: user.plexUsername,
        isAdmin: user.role === 'admin',
      },
      tokens,
    };
  }

  async register(params: RegisterParams): Promise<AuthResult> {
    const { username, password } = params;

    // Validate
    if (!username || username.length < 3) {
      return { success: false, error: 'Username must be at least 3 characters' };
    }

    if (!password || password.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters' };
    }

    // Check if registration is enabled
    const registrationEnabled = await getConfig('auth.registration_enabled');
    if (registrationEnabled !== 'true') {
      return { success: false, error: 'Registration is disabled' };
    }

    // Check username uniqueness
    const existing = await prisma.user.findFirst({
      where: {
        plexUsername: username,
        authProvider: 'local',
      },
    });

    if (existing) {
      return { success: false, error: 'Username already taken' };
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Determine registration status
    const requireApproval = (await getConfig('auth.require_admin_approval')) === 'true';
    const registrationStatus = requireApproval ? 'pending_approval' : 'approved';

    // Check if first user (make admin)
    const userCount = await prisma.user.count();
    const isFirstUser = userCount === 0;

    // Create user
    const user = await prisma.user.create({
      data: {
        plexId: `local-${username}`,
        plexUsername: username,
        authToken: passwordHash,
        authProvider: 'local',
        role: isFirstUser ? 'admin' : 'user',
        isSetupAdmin: isFirstUser,
        registrationStatus: isFirstUser ? 'approved' : registrationStatus,
      },
    });

    if (requireApproval && !isFirstUser) {
      return { success: false, requiresApproval: true };
    }

    // Generate tokens for immediate login
    const tokens = await generateJWT({
      id: user.id,
      username: user.plexUsername,
      role: user.role,
    });

    return {
      success: true,
      user: {
        id: user.id,
        username: user.plexUsername,
        isAdmin: user.role === 'admin',
      },
      tokens,
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokens | null> {
    // Reuse existing JWT refresh logic
    return null;
  }

  async validateAccess(userInfo: UserInfo): Promise<boolean> {
    return true;
  }
}
```

### 4.2 Create Registration Endpoint

**Create file:** `src/app/api/auth/register/route.ts`

```typescript
/**
 * User Registration Endpoint
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { LocalAuthProvider } from '@/lib/services/auth/LocalAuthProvider';

// Rate limiting map (in production, use Redis)
const registrationAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const attempts = registrationAttempts.get(ip);

  if (!attempts || now > attempts.resetAt) {
    registrationAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (attempts.count >= MAX_ATTEMPTS) {
    return false;
  }

  attempts.count++;
  return true;
}

export async function POST(request: NextRequest) {
  // Rate limiting
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many registration attempts. Please try again later.' },
      { status: 429 }
    );
  }

  try {
    const { username, password } = await request.json();

    const provider = new LocalAuthProvider();
    const result = await provider.register({ username, password });

    if (!result.success) {
      if (result.requiresApproval) {
        return NextResponse.json({
          success: false,
          pendingApproval: true,
          message: 'Account created. Waiting for admin approval.',
        });
      }
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    // Return tokens for auto-login
    return NextResponse.json({
      success: true,
      user: result.user,
      accessToken: result.tokens!.accessToken,
      refreshToken: result.tokens!.refreshToken,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Registration failed' },
      { status: 500 }
    );
  }
}
```

### 4.3 Create Local Login Endpoint

**Create file:** `src/app/api/auth/local/login/route.ts`

```typescript
/**
 * Local Login Endpoint
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { LocalAuthProvider } from '@/lib/services/auth/LocalAuthProvider';

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    const provider = new LocalAuthProvider();
    const result = await provider.handleCallback({ username, password });

    if (!result.success) {
      if (result.requiresApproval) {
        return NextResponse.json({
          success: false,
          pendingApproval: true,
          message: 'Account pending admin approval.',
        });
      }
      return NextResponse.json(
        { error: result.error },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      user: result.user,
      accessToken: result.tokens!.accessToken,
      refreshToken: result.tokens!.refreshToken,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Login failed' },
      { status: 500 }
    );
  }
}
```

### 4.4 Create Auth Providers Endpoint

**Create file:** `src/app/api/auth/providers/route.ts`

```typescript
/**
 * List Available Auth Providers
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextResponse } from 'next/server';
import { getConfig, getBackendMode } from '@/lib/services/config.service';

export async function GET() {
  const mode = await getBackendMode();

  if (mode === 'plex') {
    return NextResponse.json({
      providers: ['plex'],
      registrationEnabled: false,
    });
  }

  // Audiobookshelf mode
  const oidcEnabled = (await getConfig('oidc.enabled')) === 'true';
  const registrationEnabled = (await getConfig('auth.registration_enabled')) === 'true';
  const oidcProviderName = await getConfig('oidc.provider_name') || 'SSO';

  const providers: string[] = [];
  if (oidcEnabled) providers.push('oidc');
  if (registrationEnabled) providers.push('local');

  return NextResponse.json({
    providers,
    registrationEnabled,
    oidcProviderName: oidcEnabled ? oidcProviderName : null,
  });
}
```

### 4.5 Create Admin User Approval Endpoints

**Create file:** `src/app/api/admin/users/pending/route.ts`

```typescript
/**
 * Pending User Approvals
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/middleware/auth';

export async function GET() {
  const authResult = await requireAdmin();
  if (!authResult.success) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const pendingUsers = await prisma.user.findMany({
    where: { registrationStatus: 'pending_approval' },
    select: {
      id: true,
      plexUsername: true,
      createdAt: true,
      authProvider: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ users: pendingUsers });
}
```

**Create file:** `src/app/api/admin/users/[id]/approve/route.ts`

```typescript
/**
 * Approve User Registration
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/middleware/auth';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authResult = await requireAdmin();
  if (!authResult.success) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  await prisma.user.update({
    where: { id: params.id },
    data: { registrationStatus: 'approved' },
  });

  return NextResponse.json({ success: true });
}
```

### 4.6 Phase 4 Verification

**Tests to run:**
1. Registration creates user with correct status
2. Login works for approved users
3. Login blocked for pending users
4. Admin can see pending users
5. Admin can approve users
6. Rate limiting works
7. Existing auth methods still work

**Checklist:**
- [ ] `LocalAuthProvider` implements interface
- [ ] Registration endpoint with rate limiting
- [ ] Local login endpoint
- [ ] Auth providers listing endpoint
- [ ] Admin approval endpoints
- [ ] First user becomes admin

---

## Phase 5: Setup Wizard Modifications

### 5.1 Create Backend Selection Step

**Create file:** `src/app/setup/components/BackendSelectionStep.tsx`

```typescript
/**
 * Backend Selection Step
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

'use client';

import { useState } from 'react';

interface Props {
  value: 'plex' | 'audiobookshelf';
  onChange: (value: 'plex' | 'audiobookshelf') => void;
  onNext: () => void;
}

export function BackendSelectionStep({ value, onChange, onNext }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Choose Your Library Backend</h2>
        <p className="text-gray-600 mt-2">
          Select which media server you'll use to manage your audiobook library.
        </p>
      </div>

      <div className="space-y-4">
        <label className={`block p-4 border rounded-lg cursor-pointer transition ${
          value === 'plex' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
        }`}>
          <input
            type="radio"
            name="backend"
            value="plex"
            checked={value === 'plex'}
            onChange={() => onChange('plex')}
            className="sr-only"
          />
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-orange-500 rounded-lg flex items-center justify-center">
              {/* Plex icon */}
              <span className="text-white text-2xl">P</span>
            </div>
            <div>
              <h3 className="font-semibold">Plex Media Server</h3>
              <p className="text-sm text-gray-600">
                Use Plex for library management. Authentication via Plex OAuth.
              </p>
            </div>
          </div>
        </label>

        <label className={`block p-4 border rounded-lg cursor-pointer transition ${
          value === 'audiobookshelf' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
        }`}>
          <input
            type="radio"
            name="backend"
            value="audiobookshelf"
            checked={value === 'audiobookshelf'}
            onChange={() => onChange('audiobookshelf')}
            className="sr-only"
          />
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-500 rounded-lg flex items-center justify-center">
              {/* ABS icon */}
              <span className="text-white text-2xl">A</span>
            </div>
            <div>
              <h3 className="font-semibold">Audiobookshelf</h3>
              <p className="text-sm text-gray-600">
                Use Audiobookshelf for library management. Choose OIDC or password authentication.
              </p>
            </div>
          </div>
        </label>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <p className="text-sm text-yellow-800">
          <strong>Note:</strong> This choice cannot be changed after setup.
          To switch backends, you'll need to reset the application.
        </p>
      </div>

      <button
        onClick={onNext}
        className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
      >
        Continue
      </button>
    </div>
  );
}
```

### 5.2 Create Audiobookshelf Setup Step

**Create file:** `src/app/setup/components/AudiobookshelfStep.tsx`

```typescript
/**
 * Audiobookshelf Configuration Step
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

'use client';

import { useState } from 'react';

interface Props {
  serverUrl: string;
  apiToken: string;
  libraryId: string;
  onServerUrlChange: (value: string) => void;
  onApiTokenChange: (value: string) => void;
  onLibraryIdChange: (value: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export function AudiobookshelfStep({
  serverUrl,
  apiToken,
  libraryId,
  onServerUrlChange,
  onApiTokenChange,
  onLibraryIdChange,
  onNext,
  onBack,
}: Props) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    libraries?: { id: string; name: string; itemCount: number }[];
    error?: string;
  } | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/setup/test-abs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl, apiToken }),
      });

      const data = await response.json();
      setTestResult(data);
    } catch (error) {
      setTestResult({ success: false, error: 'Connection failed' });
    } finally {
      setTesting(false);
    }
  };

  const canProceed = testResult?.success && libraryId;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Configure Audiobookshelf</h2>
        <p className="text-gray-600 mt-2">
          Enter your Audiobookshelf server details and API token.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Server URL</label>
          <input
            type="url"
            value={serverUrl}
            onChange={(e) => onServerUrlChange(e.target.value)}
            placeholder="http://audiobookshelf:13378"
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">API Token</label>
          <input
            type="password"
            value={apiToken}
            onChange={(e) => onApiTokenChange(e.target.value)}
            placeholder="Your API token"
            className="w-full px-3 py-2 border rounded-lg"
          />
          <p className="text-xs text-gray-500 mt-1">
            Find this in Audiobookshelf → Settings → Users → Your User → API Token
          </p>
        </div>

        <button
          onClick={handleTest}
          disabled={testing || !serverUrl || !apiToken}
          className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
        >
          {testing ? 'Testing...' : 'Test Connection'}
        </button>

        {testResult && (
          <div className={`p-4 rounded-lg ${testResult.success ? 'bg-green-50' : 'bg-red-50'}`}>
            {testResult.success ? (
              <>
                <p className="text-green-800 font-medium">Connection successful!</p>
                <div className="mt-2">
                  <label className="block text-sm font-medium mb-1">Select Library</label>
                  <select
                    value={libraryId}
                    onChange={(e) => onLibraryIdChange(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">Select a library...</option>
                    {testResult.libraries?.map((lib) => (
                      <option key={lib.id} value={lib.id}>
                        {lib.name} ({lib.itemCount} items)
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <p className="text-red-800">{testResult.error}</p>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-4">
        <button
          onClick={onBack}
          className="flex-1 py-3 border rounded-lg hover:bg-gray-50 transition"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!canProceed}
          className="flex-1 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
```

### 5.3 Create Auth Method Selection Step

**Create file:** `src/app/setup/components/AuthMethodStep.tsx`

Similar pattern to BackendSelectionStep - allow choosing between:
- OIDC Provider
- Manual Registration
- Both

### 5.4 Create OIDC Configuration Step

**Create file:** `src/app/setup/components/OIDCConfigStep.tsx`

Include fields for:
- Provider name (display name)
- Issuer URL
- Client ID
- Client Secret
- Access control method selection
- Group claim configuration (if group_claim selected)

Include test connection button that validates OIDC discovery.

### 5.5 Create Registration Settings Step

**Create file:** `src/app/setup/components/RegistrationSettingsStep.tsx`

Include:
- Enable/disable toggle
- Require admin approval toggle

### 5.6 Update Main Setup Wizard

**Modify:** `src/app/setup/page.tsx`

Update step flow based on backend mode:
```typescript
const steps = useMemo(() => {
  const baseSteps = ['welcome', 'backend'];

  if (state.backendMode === 'plex') {
    return [...baseSteps, 'plex', 'admin', 'prowlarr', 'download', 'paths', 'bookdate', 'review', 'finalize'];
  } else {
    return [...baseSteps, 'audiobookshelf', 'auth-method',
      ...(state.authMethod === 'oidc' || state.authMethod === 'both' ? ['oidc-config'] : []),
      ...(state.authMethod === 'manual' || state.authMethod === 'both' ? ['registration-settings'] : []),
      ...(state.authMethod === 'manual' ? ['admin-account'] : []),
      'prowlarr', 'download', 'paths', 'bookdate', 'review', 'finalize'
    ];
  }
}, [state.backendMode, state.authMethod]);
```

### 5.7 Update Setup Complete Endpoint

**Modify:** `src/app/api/setup/complete/route.ts`

Handle saving all new configuration:
```typescript
// Save backend mode
await setConfig('system.backend_mode', state.backendMode);

if (state.backendMode === 'audiobookshelf') {
  // Save ABS config
  await setConfig('abs.server_url', state.absUrl);
  await setConfig('abs.api_token', state.absApiToken, true);  // encrypted
  await setConfig('abs.library_id', state.absLibraryId);

  // Save auth config
  if (state.authMethod === 'oidc' || state.authMethod === 'both') {
    await setConfig('oidc.enabled', 'true');
    await setConfig('oidc.provider_name', state.oidcProviderName);
    await setConfig('oidc.issuer_url', state.oidcIssuerUrl);
    await setConfig('oidc.client_id', state.oidcClientId);
    await setConfig('oidc.client_secret', state.oidcClientSecret, true);
    await setConfig('oidc.access_control_method', state.oidcAccessMethod);
    // ... other OIDC config
  }

  if (state.authMethod === 'manual' || state.authMethod === 'both') {
    await setConfig('auth.registration_enabled', 'true');
    await setConfig('auth.require_admin_approval', state.requireAdminApproval ? 'true' : 'false');
  }
}
```

### 5.8 Phase 5 Verification

**Tests to run:**
1. Full setup flow with Plex mode
2. Full setup flow with ABS + OIDC
3. Full setup flow with ABS + Manual registration
4. All config saved correctly
5. Correct steps shown for each mode

**Checklist:**
- [ ] Backend selection step
- [ ] ABS configuration step
- [ ] Auth method selection step
- [ ] OIDC configuration step
- [ ] Registration settings step
- [ ] Dynamic step flow based on selections
- [ ] Setup complete saves all config

---

## Phase 6: Settings & Login UI

### 6.1 Update Login Page for Multi-Mode

**Modify:** `src/app/login/page.tsx`

```typescript
'use client';

import { useEffect, useState } from 'react';
import { PlexLoginButton } from '@/components/auth/PlexLoginButton';
import { OIDCLoginButton } from '@/components/auth/OIDCLoginButton';
import { LocalLoginForm } from '@/components/auth/LocalLoginForm';
import { RegistrationForm } from '@/components/auth/RegistrationForm';

export default function LoginPage() {
  const [providers, setProviders] = useState<{
    providers: string[];
    registrationEnabled: boolean;
    oidcProviderName: string | null;
  } | null>(null);
  const [showRegister, setShowRegister] = useState(false);

  useEffect(() => {
    fetch('/api/auth/providers')
      .then(res => res.json())
      .then(setProviders);
  }, []);

  if (!providers) return <div>Loading...</div>;

  // Plex mode
  if (providers.providers.includes('plex')) {
    return <PlexLoginButton />;
  }

  // Audiobookshelf mode
  return (
    <div className="max-w-md mx-auto space-y-6">
      {showRegister ? (
        <>
          <RegistrationForm onSuccess={() => setShowRegister(false)} />
          <button onClick={() => setShowRegister(false)}>
            Already have an account? Login
          </button>
        </>
      ) : (
        <>
          {providers.providers.includes('oidc') && (
            <OIDCLoginButton providerName={providers.oidcProviderName!} />
          )}

          {providers.providers.includes('oidc') && providers.providers.includes('local') && (
            <div className="text-center text-gray-500">OR</div>
          )}

          {providers.providers.includes('local') && (
            <LocalLoginForm />
          )}

          {providers.registrationEnabled && (
            <button onClick={() => setShowRegister(true)}>
              Don't have an account? Register
            </button>
          )}
        </>
      )}
    </div>
  );
}
```

### 6.2 Create Auth Components

**Create:** `src/components/auth/OIDCLoginButton.tsx`
**Create:** `src/components/auth/LocalLoginForm.tsx`
**Create:** `src/components/auth/RegistrationForm.tsx`

### 6.3 Add Settings Tabs for ABS Mode

**Modify:** `src/app/admin/settings/page.tsx`

Add conditional tabs:
- Audiobookshelf tab (if mode = audiobookshelf)
- OIDC tab (if OIDC enabled)
- Registration tab (if registration enabled)

### 6.4 Create Settings Tab Components

**Create:** `src/app/admin/settings/components/AudiobookshelfTab.tsx`
**Create:** `src/app/admin/settings/components/OIDCTab.tsx`
**Create:** `src/app/admin/settings/components/RegistrationTab.tsx`

### 6.5 Phase 6 Verification

**Tests to run:**
1. Login page shows correct options per mode
2. OIDC login button redirects correctly
3. Local login form works
4. Registration form works
5. Settings tabs appear correctly
6. Settings can be modified and saved

---

## Phase 7: Integration Testing & Documentation

### 7.1 End-to-End Tests

Create comprehensive tests for:
1. **Plex Mode (Regression)**
   - Full setup flow
   - Login/logout
   - Library scanning
   - Request flow

2. **ABS + OIDC Mode**
   - Full setup flow
   - OIDC login with group claim access control
   - Library scanning
   - Request flow

3. **ABS + Manual Registration Mode**
   - Full setup flow
   - User registration
   - Admin approval flow
   - Login after approval
   - Library scanning
   - Request flow

### 7.2 Update Documentation

**Update:** `documentation/TABLEOFCONTENTS.md`
- Add entries for new integration docs

**Update:** `documentation/backend/services/auth.md`
- Add OIDC and local auth sections

**Create:** `documentation/integrations/audiobookshelf.md`
- API reference
- Configuration
- Troubleshooting

**Update:** `documentation/setup-wizard.md`
- Document new steps
- Mode-specific flows

### 7.3 Final Verification Checklist

- [ ] All Phase 1-6 checklists complete
- [ ] Plex mode unchanged (full regression)
- [ ] ABS library integration works
- [ ] OIDC authentication works
- [ ] Group claim access control works
- [ ] Manual registration works
- [ ] Admin approval works
- [ ] Setup wizard handles all modes
- [ ] Settings pages handle all modes
- [ ] Login page adapts to mode
- [ ] Documentation updated
- [ ] No console errors
- [ ] No TypeScript errors
- [ ] All tests pass

---

## Important Notes for AI Agent

1. **Always read existing code first** before making changes
2. **Run tests frequently** - after each major change
3. **Keep existing functionality working** - Plex mode must not break
4. **Follow existing patterns** - match code style and structure
5. **Update imports** when moving/creating files
6. **Handle errors gracefully** - never crash on API errors
7. **Log appropriately** - debug info but never tokens
8. **Ask if unclear** - don't make assumptions about requirements
