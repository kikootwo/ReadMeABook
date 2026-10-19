# Multi-Download-Client Support

**Status:** ✅ Implemented | qBittorrent, Transmission, SABnzbd, and NZBGet support

## Overview
Users can configure one torrent client (qBittorrent or Transmission) and one usenet client (SABnzbd or NZBGet) simultaneously. System selects best release across all indexer types regardless of protocol.

**Constraint:** 1 client per protocol (torrent/usenet). Users must remove an existing torrent client before adding a different one.

## Key Details

### Supported Clients

| Client | Protocol | Auth | Categories |
|--------|----------|------|------------|
| qBittorrent | torrent | Cookie-based (login endpoint) | Categories |
| Transmission | torrent | HTTP Basic Auth + CSRF (`X-Transmission-Session-Id`) | Labels |
| SABnzbd | usenet | API key | Categories |
| NZBGet | usenet | HTTP Basic Auth (JSON-RPC) | Config-based categories |

### Protocol Map
**File:** `src/lib/interfaces/download-client.interface.ts`

```typescript
export const CLIENT_PROTOCOL_MAP: Record<DownloadClientType, ProtocolType> = {
  qbittorrent: 'torrent',
  sabnzbd: 'usenet',
  nzbget: 'usenet',
  transmission: 'torrent',
};
```

Used by manager's `getClientForProtocol()` and UI's protocol-level enforcement.

### Configuration Structure
**Key:** `download_clients` (JSON array, replaces legacy flat keys)

```typescript
interface DownloadClientConfig {
  id: string;                    // UUID
  type: 'qbittorrent' | 'sabnzbd' | 'nzbget' | 'transmission';
  name: string;                  // User-friendly name
  enabled: boolean;
  url: string;
  username?: string;             // qBittorrent/Transmission/NZBGet only
  password: string;              // Password or API key
  disableSSLVerify: boolean;
  remotePathMappingEnabled: boolean;
  remotePath?: string;
  localPath?: string;
  category?: string;             // Default: 'readmeabook'
  customPath?: string;           // Relative sub-path appended to download_dir
}
```

### Transmission Service
**File:** `src/lib/integrations/transmission.service.ts`

- **RPC endpoint:** `POST /transmission/rpc` (JSON-RPC)
- **CSRF:** 409 → capture `X-Transmission-Session-Id` header → retry
- **Auth:** HTTP Basic Auth (optional)
- **Categories:** Uses `labels` array on `torrent-add`
- **Download path:** `download-dir` argument on `torrent-add`
- **Torrent files:** Base64-encoded via `metainfo` field
- **Status codes:** 0=stopped→paused, 1=check-pending→checking, 2=checking→checking, 3=download-pending→queued, 4=downloading→downloading, 5=seed-pending→seeding, 6=seeding→seeding
- **Error handling:** only `error === 3` (local error) → failed. `error` 1/2 (tracker warning/error) are transient and ignored. Stopped (status 0) with `percentDone >= 1` → completed (so it gets processed)
- **postProcess():** No-op (same as qBittorrent)

### NZBGet Service
**File:** `src/lib/integrations/nzbget.service.ts`

- **RPC endpoint:** `POST /jsonrpc` (JSON-RPC with Basic Auth)
- **Auth:** HTTP Basic Auth (username + password)
- **Categories:** Config-based (`Category1.Name`, `Category1.DestDir`), managed via `config()` + `saveconfig()`
- **Adding NZBs:** Downloads NZB content from Prowlarr, base64-encodes, uploads via `append()`
- **Queue status:** `listgroups(0)` — QUEUED, PAUSED, DOWNLOADING, FETCHING, PP_* (processing states)
- **History status:** `history(false)` — SUCCESS/*, WARNING/* → completed; FAILURE/*, DELETED/* → failed
- **Pause/Resume/Delete:** `editqueue()` with GroupPause/GroupResume/GroupDelete/HistoryDelete commands
- **postProcess():** `editqueue('HistoryDelete')` — archives from visible history (preserves in hidden archive)
- **IDs:** Integer NZBIDs (stored as strings in RMAB system)

### Per-Client Custom Download Path
**Field:** `customPath` (optional string, blank = use base `download_dir` as-is)

Allows each download client to download to a different subdirectory under `download_dir`. Useful for separating torrent and usenet downloads.

**Path Resolution (in `createService()`):**
```
finalPath = config.customPath ? path.join(downloadDir, config.customPath) : downloadDir
```

**Example:**
- `download_dir` = `/downloads`, qBittorrent `customPath` = `torrents` → `/downloads/torrents`
- `download_dir` = `/downloads`, SABnzbd `customPath` = `usenet` → `/downloads/usenet`
- `download_dir` = `/downloads`, `customPath` = blank → `/downloads`

**Validation:**
- Leading/trailing slashes stripped on save
- Paths containing `..` rejected (frontend + API)
- Backward-compatible: existing configs without `customPath` default to base `download_dir`

**Resolved path used by:**
- Service constructors (`defaultSavePath` / `defaultDownloadDir`)
- Category creation (qBittorrent `ensureCategory`, SABnzbd `ensureCategory`)
- Torrent/NZB addition (save path / download-dir)
- Remote path mapping (applied after customPath resolution)
- Singleton getters (`getQBittorrentService`, `getSABnzbdService`)
- Retry fallback path construction (`retry-failed-imports.processor.ts`)

**UI:** Modal shows real-time path preview: `Downloads to: /downloads/torrents`

### Download Client Manager Service
**File:** `src/lib/services/download-client-manager.service.ts`

**Methods:**
- `getClientForProtocol(protocol: 'torrent' | 'usenet')` - Get client by protocol (uses `CLIENT_PROTOCOL_MAP`)
- `hasClientForProtocol(protocol)` - Check if protocol configured
- `getAllClients()` - List all configs
- `testConnection(config)` - Test specific config
- `invalidate()` - Clear cache on config change
- `getClientServiceForProtocol(protocol)` - Get instantiated service

**Factory Cases:** `qbittorrent` → `QBittorrentService`, `sabnzbd` → `SABnzbdService`, `nzbget` → `NZBGetService`, `transmission` → `TransmissionService`

**Singleton Pattern:** Uses caching with invalidation on config changes.

### Protocol Filtering
**File:** `src/lib/integrations/prowlarr.service.ts:379`

**Logic:**
- Both clients configured: Return all results (mixed torrent + NZB)
- Only torrent client: Filter for torrent results only
- Only usenet client: Filter for NZB results only
- No clients: Return empty

### Download Routing
**File:** `src/lib/processors/download-torrent.processor.ts:44`

**Logic:**
1. Detect protocol from result (`ProwlarrService.isNZBResult()`)
2. Get appropriate client via manager (`getClientForProtocol()`)
3. Route to correct service (qBittorrent, Transmission, or SABnzbd)
4. Create download history record

### Migration
**Auto-migration** from legacy single-client config to new JSON array format on first access:
- Reads legacy keys: `download_client_type`, `download_client_url`, etc.
- Converts to single-client array
- Saves as `download_clients` JSON
- Legacy keys remain for backward compatibility (cleaned up on migration)

## API Routes

**GET /api/admin/settings/download-clients** - List all configured clients
**POST /api/admin/settings/download-clients** - Add new client
**PUT /api/admin/settings/download-clients/[id]** - Update client by ID
**DELETE /api/admin/settings/download-clients/[id]** - Delete client by ID
**POST /api/admin/settings/download-clients/test** - Test connection

**Validation:**
- Only 1 client per protocol allowed (enforced on add via `CLIENT_PROTOCOL_MAP`)
- Test connection required before save
- Password masking in responses (`********`)

## UI Components

**Directory:** `src/components/admin/download-clients/`

| Component | Purpose |
|-----------|---------|
| `DownloadClientManagement.tsx` | Container with add cards (4-column: qBittorrent, Transmission, SABnzbd, NZBGet) + configured cards; protocol-level enforcement (grayed out when protocol taken) |
| `DownloadClientCard.tsx` | Card with name, type badge (blue=qBittorrent, green=Transmission, purple=SABnzbd, orange=NZBGet), custom path display, edit/delete |
| `DownloadClientModal.tsx` | Add/edit modal with type-specific fields; Username shown for qBittorrent + Transmission + NZBGet; URL placeholder per-type |

**UI Flow:**
1. **Add Client Section:** Four cards (qBittorrent, Transmission, SABnzbd, NZBGet) with "Add" button or "Protocol already configured" when protocol is taken (card grayed out with `opacity-50`)
2. **Configured Clients:** Grid of cards showing name, type, URL, custom path (if set), status
3. **Modal:** Type-specific fields, custom download path with live preview, SSL toggle, path mapping, test connection

**downloadDir Prop Flow:**
- **Settings mode:** `DownloadClientManagement` fetches from `GET /api/admin/settings` → `settings.paths.downloadDir` on mount
- **Wizard mode:** `setup/page.tsx` passes `state.downloadDir` → `DownloadClientStep` → `DownloadClientManagement` → `DownloadClientModal`

## Integration Points

### Settings Tab
**File:** `src/app/admin/settings/tabs/DownloadTab/DownloadTab.tsx`

Replaced legacy form with `<DownloadClientManagement mode="settings" />`

### Wizard Step
**File:** `src/app/setup/steps/DownloadClientStep.tsx`

Replaced single-client form with `<DownloadClientManagement mode="wizard" />`

**Props:** Accepts `downloadDir` from setup page state, passes to management component

**Validation:** At least 1 enabled client required to proceed

### Setup Complete API
**File:** `src/app/api/setup/complete/route.ts`

Accepts both legacy single client and new array format:
- Legacy: Converts to array on save
- New: Saves directly as `download_clients` JSON

## Edge Cases

**Single client:** Works exactly as before (protocol filtering active)
**No clients:** Wizard requires one; settings shows warning
**Client disabled:** Results for that protocol filtered out
**Connection failure:** Per-download error handling (existing)
**Mixed results:** Best release selected regardless of protocol when both clients configured
**Custom path blank:** Uses base `download_dir` (backward-compatible default)
**Custom path with slashes:** Leading/trailing slashes stripped automatically
**Custom path with `..`:** Rejected by frontend validation and API validation
**Switching torrent clients:** Must delete existing torrent client before adding Transmission (or vice versa)

## Verification Steps

1. **Migration:** Existing single-client users see config as card after update
2. **Single client:** Configure only qBittorrent → only torrent results shown
3. **Both clients:** Configure torrent + usenet → mixed results, best selected across protocols
4. **Download routing:** Torrent result → torrent client; NZB result → usenet client (SABnzbd or NZBGet)
5. **Wizard:** Must add at least one client to proceed
6. **Settings:** Can add/edit/delete/test clients; changes persist
7. **Custom path:** Set `torrents` on torrent client → save path includes subdirectory
8. **Custom path preview:** Modal shows resolved path in real-time as user types
9. **Custom path persistence:** Save, reopen modal → value persists
10. **Custom path on card:** Configured cards show custom path if set
11. **Transmission CSRF:** First RPC call gets 409, captures session ID, retry succeeds
12. **Protocol enforcement:** Adding qBittorrent grays out Transmission card (and vice versa)

## Critical Files

| File | Changes |
|------|---------|
| `src/lib/interfaces/download-client.interface.ts` | Client types, display names, `CLIENT_PROTOCOL_MAP` |
| `src/lib/integrations/nzbget.service.ts` | NZBGet JSON-RPC implementation |
| `src/lib/integrations/transmission.service.ts` | Transmission RPC implementation |
| `src/lib/services/download-client-manager.service.ts` | Core multi-client service, protocol-based routing |
| `src/lib/integrations/prowlarr.service.ts:379` | Protocol filtering logic (both clients = all results) |
| `src/lib/processors/download-torrent.processor.ts:44` | Download routing (detect protocol → route) |
| `src/app/api/admin/settings/download-clients/*` | CRUD API routes, protocol-level duplicate check |
| `src/components/admin/download-clients/*` | UI components (3-column card layout, protocol enforcement) |
| `src/app/admin/settings/tabs/DownloadTab/DownloadTab.tsx` | Replaced with management component |
| `src/app/setup/steps/DownloadClientStep.tsx` | Replaced with management component |
| `src/app/api/setup/complete/route.ts` | Save as JSON array, support legacy |

## Related

- [qBittorrent Integration](./qbittorrent.md) - Torrent client details
- [SABnzbd Integration](./sabnzbd.md) - Usenet client details (SABnzbd)
- [Prowlarr Integration](./prowlarr.md) - Indexer search
