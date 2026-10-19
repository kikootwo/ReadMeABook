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
**Storage:** every writer serialises via `serializeDownloadClients()` (`src/lib/services/download-client-storage.ts`): passwords stored encrypted; a value in encrypted format is kept as-is only when it does not decrypt with the current key. `getAllClients()` returns them decrypted

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
- **Error handling:** `error > 0` → failed status
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

### Source Fetch & Prowlarr Key Scoping
**File:** `src/lib/integrations/download-source.ts` (`fetchDownloadSource`), rules in `src/lib/utils/prowlarr-url.ts`, constants in `src/lib/constants/download-source.ts`
- RMAB fetches every .torrent/.nzb itself (all 5 clients), then hands the file or magnet to the client
- Redirects followed one hop at a time, max `MAX_SOURCE_REDIRECT_HOPS` (5); `Location` resolved against the current hop (relative OK)
- `magnet:` accepted at any hop or as the response body (torrent clients only). Strict form everywhere (`isMagnetUri`: `^magnet:\?[^\s]+$`, no whitespace) because clients split URL lists on newlines; the processor drops releases with a malformed magnet before trying any client
- Hard deadline for the whole fetch (caller timeout; `AbortSignal.timeout`, since axios `timeout` is only an inactivity timer) → `DownloadSourceTimeoutError` (`code: 'ETIMEDOUT'`, transient: Bull retries the job); file size cap `MAX_SOURCE_FILE_BYTES` (50 MB)
- Unusable source (invalid/non-http redirect, malformed magnet hop, magnet for usenet, redirect loop) → `UnusableDownloadSourceError`: the processor tries the next ranked release; if it was the last, an earlier 429/5xx (retryable) error wins
- `httpsAgent` (usenet clients' "disable SSL verify") applies only to hops on the configured Prowlarr origin, and only when that origin is https
- **Prowlarr key:** `AddDownloadOptions.sourceAuth = { prowlarrBaseUrl, apiKey }` (built in `download-torrent.processor.ts` from `getProwlarrConnection()`). Key sent (`X-Api-Key` + `apikey` query restored if missing) **only** when the hop is exactly the configured scheme/host/port/credentials + `<base path>/{indexerId}/download` (`isProwlarrDownloadUrl`). Any other origin or Prowlarr path gets no key. Every grab is rewritten onto the configured base first (`toConfiguredProwlarrUrl(..., { withCredentials: true })`), which is the only place configured `user:pass@` is added
- Logs/errors: `urlForLog()` keeps scheme + host only (`magnet:` for magnets); `DownloadSourceError.sourceUrl` uses the same form
- HTTP error from source → `DownloadSourceError` (processor tries next ranked release on 429/5xx)

### User-Picked Releases
**File:** `src/lib/services/download-selection-guard.ts`
- Torrent/NZB picks (`request-with-torrent`, `select-torrent`, `select-ebook` indexer source, admin `replace`, admin `approve` incl. stored picks, admin `retry-download` when it re-adds a stored link): `downloadUrl` must be a `magnet:?` URI or a Prowlarr download link → else 400 `ValidationError`
- Prowlarr link match (`toConfiguredProwlarrUrl`): same host name as `prowlarr_url` (case-insensitive) + base path (case-insensitive) + `/{indexerId}/download`; tolerates http↔https (TLS proxy without `X-Forwarded-Proto`) and default-port differences, never a different host or non-default port. The pick is then **rewritten** onto the configured base (scheme, port, base path) **without credentials** (candidate credentials discarded), so stored picks, `DownloadHistory.magnetLink` and job payloads never hold them; non-admin pick responses omit `selectedTorrent` (`hideStoredPick`)
- Approve: an unusable stored user pick (or Anna's Archive with no links left) → warning, pick cleared, approve falls back to automatic search and the response says so (`selectionDropped`); Anna's Archive/FlareSolverr unreachable (`getSlowDownloadLinks(..., { throwOnError: true })`) → 503 `SourceUnavailable`, pick kept; an unusable admin-provided pick → 400. E-book pick routes also answer 503 when the source can't be reached
- Magnets are accepted as-is, so a user can choose a magnet's tracker list (accepted)
- Anna's Archive picks: only `md5` (32 hex) is trusted; links rebuilt with `getSlowDownloadLinks(md5, ebook_sidecar_base_url, flaresolverr)`; client `downloadUrl(s)` ignored
- Search responses (`search-torrents`, `requests/[id]/interactive-search`, both `interactive-search-ebook`): `stripProwlarrKeyFromResults()` removes any `apikey=<configured key>` on any origin from every string field (fetcher restores it for Prowlarr hops)
- Interactive search permission (`denyWithoutInteractiveSearchAccess`, `src/lib/middleware/interactive-search-access.ts`) enforced on all search + pick routes above (user routes) → 403
- Known limit: if Prowlarr publishes links on a different host name (or non-default port) than `prowlarr_url`, interactive picks get 400 (automatic grabs still work); set `prowlarr_url` to the host Prowlarr links use

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
| `src/lib/processors/download-torrent.processor.ts:44` | Download routing (detect protocol → route), builds `sourceAuth` |
| `src/lib/integrations/download-source.ts` | Shared .torrent/.nzb fetch, redirect hops, key scoping |
| `src/lib/services/download-selection-guard.ts` | Pick validation, Anna's Archive link rebuild, key stripping |
| `src/app/api/admin/settings/download-clients/*` | CRUD API routes, protocol-level duplicate check |
| `src/components/admin/download-clients/*` | UI components (3-column card layout, protocol enforcement) |
| `src/app/admin/settings/tabs/DownloadTab/DownloadTab.tsx` | Replaced with management component |
| `src/app/setup/steps/DownloadClientStep.tsx` | Replaced with management component |
| `src/app/api/setup/complete/route.ts` | Save as JSON array, support legacy |

## Related

- [qBittorrent Integration](./qbittorrent.md) - Torrent client details
- [SABnzbd Integration](./sabnzbd.md) - Usenet client details (SABnzbd)
- [Prowlarr Integration](./prowlarr.md) - Indexer search
