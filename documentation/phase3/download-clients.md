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
  ownedCategory?: string;        // The category RMAB created in this client (see Download Categories)
  customPath?: string;           // Relative sub-path appended to download_dir
}
```

### Download Categories (#46, #579)
**Rule:** RMAB creates, or sets the save path of, only its own category: `readmeabook` (any case, always RMAB's) or `ownedCategory` (any case). A category that already existed in the client is used as is: never created, never re-pathed. No schema change.
**Helper:** `src/lib/utils/download-category.ts` (client-safe; services, routes, modal, card). Path clients: qBittorrent, SABnzbd, NZBGet. Deluge/Transmission are labels (no path; ownership n/a).
**Decided on save only** (`resolveCategoryChoice`), from the client's own list via `manager.listCategories(config)` (fresh service, never the id-keyed cache):

| Input | Lists | Stored |
|---|---|---|
| empty / `readmeabook` (any case) | no | `readmeabook`; `ownedCategory` unchanged |
| Deluge | no | lower-cased; field error unless `[a-z0-9_.-]` |
| Transmission | no | as typed |
| unchanged from saved (any case) | no | saved values |
| equals saved `ownedCategory` | no | owned again |
| new, missing in client | yes | as typed (SABnzbd lower-cased); `ownedCategory` = name |
| new, present (any case) | yes | client's spelling; not owned |
| list throws | yes | 400 `Couldn't read <Client>'s categories: <reason>`; nothing written |

- **Where:** POST add (after the connection test), PUT edit (only when `category` is sent; the list comes from the new URL), setup complete (validation block, before any write; the wizard's display-only `categoryInClient` and any sent `ownedCategory` are dropped). The legacy single-client route carries `ownedCategory` over. A URL change alone never re-decides
- **`*`:** SABnzbd's default category; left out of lists, refused as a name
- **At add time:** owned → today's behaviour (missing → created, path differs → updated; qBittorrent/NZBGet lookups exact first, then any case, and act on the client's key). Not owned → no create/edit/`set_config`/`saveconfig`; qBittorrent adds in Manual mode (`autoTMM=false` + `savepath` = RMAB's folder, the #326 branch); SABnzbd/NZBGet send the name and the job lands in that category's folder (its settings, sorter and script apply); RMAB imports from the reported path, which must be reachable through the mapping ([volume-mapping.md](../deployment/volume-mapping.md))
- **In flight:** a change applies to the next grab; RMAB never renames, moves or deletes a category. The old owned category stays in the client
- **NZBGet cancel:** passes `category` to `deleteQueuedDownload` only when owned; otherwise name only
- **Usenet cleanup, not owned:** imported files only, folder only when empty ([file-organization.md](file-organization.md#download-cleanup-in-a-category-rmab-did-not-create))
- **UI:** "Category" field (`DownloadCategoryField.tsx`) after "Enabled": required, suggestions after a passed Test (every client type), amber note when the name is in the client and not RMAB's own. Card: `Category: x` only for a non-default name; amber `(existing, left as is)` on a path client when not owned (wizard: the modal's `categoryInClient` preview); the name truncates, the suffix never does
- **Ownership is never re-checked** (accepted): deleted in the client and re-created by another app; a restored or hand-edited config; a URL moved to another instance with the same name; re-adding a client in RMAB (forgets its old custom category); another RMAB using `readmeabook`. A custom category set through the API before this change reads as not owned (Manual mode on qBittorrent, no folder sync on usenet)
- **Deluge labels carry options:** "Move completed" and "remove at ratio" on an existing label apply on `label.set_torrent` (modal note: "Already in Deluge; its label settings apply.")

### Transmission Service
**File:** `src/lib/integrations/transmission.service.ts`

- **RPC endpoint:** `POST /transmission/rpc` (JSON-RPC)
- **CSRF:** 409 → capture `X-Transmission-Session-Id` header → retry
- **Auth:** HTTP Basic Auth (optional)
- **Categories:** Uses `labels` array on `torrent-add`
- **Download path:** `download-dir` argument on `torrent-add`
- **Torrent files:** Base64-encoded via `metainfo` field
- **Status codes:** 0=stopped→paused, 1=check-pending→checking, 2=checking→checking, 3=download-pending→queued, 4=downloading→downloading, 5=seed-pending→seeding, 6=seeding→seeding
- **Error handling:** only `error === 3` (local error) → failed, `errorMessage` = `errorString`. `error` 1/2 (tracker warning/error) keep the normal status, so a dead tracker stalls rather than fails (same as qBittorrent). Fixed #286: a tracker 404 used to fail the request and auto-blocklist the release
- **Stopped at 100%:** status 0 with `percentDone >= 1` → `completed` (monitor imports it). `percentDone` = done fraction of wanted bytes; `isFinished` is not used (it means "seed limit reached")
- **postProcess():** No-op (same as qBittorrent)

### Torrent IDs (Transmission, Deluge; #457)
**File:** `src/lib/integrations/torrent-ids.ts` (shared with qBittorrent: `magnetHashes()`, `torrentFileHashes()`, `candidateIds()`, `normalizeTorrentId()`, `addedTorrentId()`)

- **Base32 magnets:** `btih` in base32 (32 chars, any case) → 40 lowercase hex on add (`magnetHashes()`); no v1 (`btmh`-only) → `Invalid magnet link`, as before. Fixed #457: a base32 magnet was recorded and looked up in base32, which neither client answers to, so monitoring failed and the seeding cleanup marked the row `removed`
- **Recorded ID** (`AddDownloadResult.id`): the 40-hex ID the add answer reports, lowercased (Transmission `torrent-added`/`torrent-duplicate` `hashString`; Deluge `core.add_torrent_*` result); a non-hex answer → the computed v1. A reported ID that is none of the computed IDs is still recorded (it is the torrent the add created), with a warn log (`addedTorrentId()`)
- **`infoHash`** = v1 on every path (as qBittorrent). `DownloadHistory.torrentHash` = Prowlarr's infohash when the release has one (any case), else this v1
- **Deluge add checks** (pre-check, and the re-check after a rejected add): `core.get_torrent_status [id, ['name']]` per candidate ID, first hit wins: truncated v2 (a hybrid `.torrent`'s `meta version` 2, or a magnet's `btmh`), then v1. Non-hybrids: one call, as before. A `.torrent` add sets label + seed limits on the ID Deluge returns (was the parsed v1)
- **Lookups** send a stored ID as lower-case hex (`normalizeTorrentId()`: 40-hex lower-cased, base32 converted, anything else unchanged): `getDownload`, `probeDownload`, pause, resume, delete, `setCategory` on both clients (and qBittorrent's lookups). `torrentHashForms()` keeps the stored form and adds the others (see the guard line below)
- Fixed #460 (hardening: no write path is known to store a Deluge row without its client ID): a row with no `downloadClientId` falls back to `torrentHash` (the indexer's infohash, often upper case); Deluge's exact-key `core.get_torrent_status` would miss it, so the probe would mark the row `removed` and request delete would leave the torrent. Ownership still decides any remove (`resolveOwnership()`)
- Fixed #460, shared-torrent guard (`otherActiveRequestsUsingTorrent()`, `src/lib/utils/shared-torrent.ts`): its Prisma `in` is case-sensitive, so a lower-case row missed another active request's upper-case row for the same torrent and cleanup or request delete could remove a torrent still in use. `torrentHashForms()` (used only by the guard) now lists the stored form, hex and base32, each in lower and upper case; it only adds matches, so only more torrents are kept
- **Transmission identity check:** `getTorrentByHash` takes only the `torrent-get` entry whose `hashString` is the requested hash (case-insensitive, `sameHash()` in `torrent-probe.ts`); none → `Torrent <id> not found`. Was `torrents[0]`: a server that ignored `ids` could have RMAB act on another torrent
- **Rows stored in base32 before the fix:** found again while the request is active. Admin retry-download calls `getDownload` first, so a failed base32 request resumes monitoring on its original `addedByRmab: true` row (RMAB's own torrent); post-import category, seeding cleanup and request delete can then act on it. Legacy `null` base32 rows become reachable under the legacy window (residual risk in [Torrent Ownership](#torrent-ownership-423)). Ownership is still `resolveOwnership()`; a row already `removed` stays `removed`
- Cleanup `deletedHashes` stays keyed by the raw stored ID: a base32 row next to a hex row of the same torrent takes the probe → `missing` path (marks only)
- **Known limits (Deluge on libtorrent 2):**
  - A hybrid row stored with v1 before the fix that Deluge keys by truncated v2: not found (`get_torrent_status` is exact-key, no v1 field) → `removed`, never cleaned
  - A btih-only magnet of a hybrid Deluge already holds under its truncated v2: libtorrent rejects the add as a duplicate, the re-check by v1 misses → the add errors, as before
  - Which ID `core.add_torrent_*` returns for a hybrid is not confirmed on a live client; RMAB records whatever it returns
  - Pure v2 `.torrent`: still fails in parse-torrent
- **Known limit (both clients):** a reported ID that is none of the computed IDs leaves `torrentHash` on the computed v1, so the shared-torrent guard can miss a second request for that torrent; deleting or cleaning one can remove the torrent the other still uses (both rows RMAB's own; rare, logged as a warn)
- Not tested on a live Transmission or Deluge (fakes that answer by the IDs RMAB sends: `tests/integrations/torrent-client-ids.test.ts`)

### NZBGet Service
**File:** `src/lib/integrations/nzbget.service.ts`

- **RPC endpoint:** `POST /jsonrpc` (JSON-RPC with Basic Auth)
- **Auth:** HTTP Basic Auth (username + password)
- **Categories:** Config-based (`Category1.Name`, `Category1.DestDir`), managed via `config()` + `saveconfig()` (RMAB's own only); `getCategories()` lists `CategoryN.Name` in slot order, throws on failure
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
  - qBittorrent (#326): every add sends `category` + `autoTMM=true` and no `savepath`, so the category's path applies even when qBittorrent's default Torrent Management Mode is Manual. Category not ensured, or not RMAB's own (`ensureCategory()` → `null`) → `autoTMM=false` + `savepath` = resolved path (remote-mapped). `autoTMM` on add needs qBittorrent 4.1.5+ (Web API 2.2.0); 4.1.0 to 4.1.4 ignore it
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

### Client-Reported `failed` (#332)
| Client | Maps to `failed` | `errorMessage` |
|---|---|---|
| qBittorrent | `error`, `missingFiles` | fixed text: "qBittorrent reported an error" / "qBittorrent reports the files are missing (missingFiles)" (the Web API gives no reason) |
| Transmission | `error === 3` (local error) only | `errorString` |
| Deluge | state `Error` | `message` |
| SABnzbd | history status containing "failed" | `failMessage` |
| NZBGet | history `FAILURE/*`, `DELETED/*`, unknown prefix | raw status first, then Par/Unpack/Delete codes |
- The monitor hands it to `client-failure.ts`: automatic grabs move on to the next-ranked release (at most 3 in a row); storage/setup failures (`isReleaseFault()` false: full disk or quota, permissions, missing data, unmounted path or dropped share, too many open files, NZBGet `DELETED/MANUAL`/`FAILURE/MOVE`, qBittorrent `missingFiles`) are never blocked. Rule: [release-blocklist.md](../admin-features/release-blocklist.md#next-release-after-a-client-failure-332)
- Requesters and notifications see the client's name and a short reason; `errorMessage` (raw client text, can hold server paths) goes only to the job log and the blocklist row's admin-only `reasonDetail`
- Each failed attempt stays in the client (errored torrent, failed history entry); request delete and cancel act on the newest selected download only

### Torrent Ownership (#423)
**Files:** `src/lib/utils/torrent-ownership.ts` (rule), `src/lib/integrations/torrent-probe.ts` (strict probe parsers)
- RMAB removes or changes only torrents it added. `addDownload()` → `AddDownloadResult { id, alreadyInClient }`; `download-torrent.processor.ts` writes `DownloadHistory.addedByRmab = (alreadyInClient === false)` (fails closed: only an explicit "newly added" is RMAB's; `added_by_rmab`, nullable, see [database.md](../backend/database.md))
- "Already in client" (taken over): qBittorrent pre-check hit, or a rejected add (`Fails.` ≤5.1, HTTP 409 5.2) whose one re-check finds the hash; Transmission pre-check hit or `torrent-duplicate`; Deluge pre-check hit, or a rejected add (`Torrent already in session`) whose re-check finds it (both by each candidate ID, [Torrent IDs](#torrent-ids-transmission-deluge-457)). Logged at warn: `"<title>" is already in <client> (<id>); RMAB will never remove it or its files`. A rejected add with the hash still absent stays an error. NZBGet: always `false` (every add is a new job). SABnzbd: `true` when it reuses a job it already holds (duplicate NZB or retried add, logged `... ; tracking that job`, [sabnzbd.md](./sabnzbd.md#duplicate-nzbs-and-retried-adds-329)); request delete and remove-after-processing never remove a usenet job recorded `false`
- `resolveOwnership(row, addedAt)` (decided in code, never by a nullable-boolean WHERE):

| Row | Client added time (vs `createdAt`) | Verdict |
|---|---|---|
| `downloadStatus: 'removed'` | (no client call) | not owned: no remove, never written back to `completed` |
| `addedByRmab: false` | (no client call) | not owned (taken over) |
| `true` | > 1 h after | kept, nothing written, info log (re-added by someone) |
| `true` | ≥ 24 h before | kept, nothing written, info log (an older copy, e.g. another client instance of the same type) |
| `true` | otherwise / unknown (missing or 0) | owned |
| `null` (before the fix) | within [−15 min, +5 min] | owned (never written `true`) |
| `null` | ≥ 24 h before | not owned: written `false` (soft-deleted request: hard-deleted, torrent kept) |
| `null` | anything else / unknown | kept, nothing written, re-checked next run, info log |
- Recorded client type ≠ configured client type: no probe, no mark, no delete. Cleanup checks this before its same-run duplicate branch; logs debug per row + one warn per run with the count. Request delete: warn per row (usenet too: a usenet delete skips when the configured usenet client is a different type)
- Not owned → no remove call at all; no post-import `setCategory`; no Transmission seed-limit rewrite on `torrent-duplicate`
- Post-import category (`applyPostImportCategory()`, `src/lib/processors/post-import-category.ts`, reads the same row as organize-files: `requestId`, newest `createdAt`): `null`/`false` skip; `true` → one strict probe (error / not found → skip) → `resolveOwnership()` (removed, re-added, older copy → skip). Info log on every skip. Downloads in flight at upgrade (`null`) never get the post-import category
- Deluge `setCategory` replaces the torrent's label (one label per torrent); now only on RMAB's own torrents
- **Cancel (#228):** the cancel's download step and the seeding cleanup's cancelled-download pass follow the same rule (`knownNotOwned` before any call, strict probe, `resolveOwnership`, `recordNotOwned`); see [request-cancel.md](../admin-features/request-cancel.md). NZBGet cancel uses `deleteQueuedDownload()` (queue only, name or category must match), never `deleteDownload()`
- **Strict probe** `probeDownload(id)` (seeding cleanup and cancel; one request, qBittorrent: plus one unfiltered lookup after an empty answer, for a hybrid stored by its v1 hash; no not-found retries, unlike `getDownload()`): `{found:true, info}` | `{found:false}` | throws

| Client | `found:false` only for | Throws |
|---|---|---|
| qBittorrent | HTTP 200 + JSON array without the torrent (matched by `hash` or `infohash_v1`; filter ignored = other torrents) | other status, non-array body (login page, empty, `{}`), 5xx, timeout; 403 → one re-login, second 403 throws |
| Transmission | `result: success` + `arguments.torrents` array without it | RPC error result, missing `arguments`/`torrents`, empty body |
| Deluge | `core.get_torrent_status` → `{}` (KeyError swallowed upstream, 2.1.1) | daemon error, `null`, non-object |
- `addedAt` in `DownloadInfo`: qBittorrent `added_on`, Transmission `addedDate`, Deluge `time_added` (0/absent → undefined → legacy rows kept)
- **Known limits that keep a torrent (RMAB's own torrent is left in the client, never cleaned):**
  - Bull retry after an add that succeeded (lost response, history insert/enqueue failed, worker died) or two download jobs for one request → RMAB's own torrent recorded `false`
  - Admin retry-download (`src/app/api/admin/requests/[id]/retry-download/route.ts`) re-adding a stored link while RMAB's torrent is still there → recorded `false`
  - Re-request/replace/series pack of a hash whose owner row was hard-deleted
  - A `false` re-request row that is not finished or not done seeding holds the torrent `until_met` (#545, [request-deletion.md](../admin-features/request-deletion.md#shared-torrent-holds)): the soft-deleted owner stays soft-deleted (probed each run) and removes it once that request is finished and done seeding, marking the `false` row `removed`. Kept forever with the owner probed each run when that request can never let go: `failed`, an unlimited or unconfigured indexer, recorded for another client, or never imported by RMAB (the same for an owner held by a deleted or cancelled owner whose torrent stopped seeding). Still leaked: owners the cleanup hard-deleted before #545, an owner deleted while its torrent was partial (no `completed` row, never visited), and a torrent whose only owner is a pre-upgrade cancel (`cancelledAt` NULL)
  - Switching to a new client instance of the same type: its well-formed "not here" answers mark those rows `removed` for good (nothing clears the mark), so RMAB never cleans them after the torrents are migrated
  - Client migrated (added times reset) or without added time (legacy rows); clock drift between client and DB > 5 min
  - Deluge loads torrents asynchronously at startup (`load_state` → `add_async`), so a probe during startup can miss a torrent → row marked `removed` (never cleaned, never lost); Transmission 4.0.6 loads all torrents in one session-thread task before RPC answers (no partial list), 3.x not verified
- **Residual risk (a torrent RMAB did not add can be removed with its files):**
  - qBittorrent-compatible clients (RDTClient etc.) not covered: if they accept a duplicate add while the pre-check misses it, the takeover is recorded `true`
  - Deluge startup: the add pre-check can miss a torrent that is still loading, RMAB's add wins and the row is recorded `true`; with the same save path, the user's files go when it is cleaned
  - Legacy (`null`) rows: someone else added the same hash within ~15 min before RMAB's grab
- **Behaviour changes in #423/#258:** once a request's newest completed row is `removed`, an older selected completed row of the same request becomes the cleanup candidate (removed only if RMAB added it); downloads in flight at upgrade skip the post-import category; a usenet request delete skips when the configured usenet client is a different type
- The library-folder delete of a request is separate (files-hash guard, [request-deletion.md](../admin-features/request-deletion.md))

### Source Fetch & Prowlarr Key Scoping
**File:** `src/lib/integrations/download-source.ts` (`fetchDownloadSource`), rules in `src/lib/utils/prowlarr-url.ts`, constants in `src/lib/constants/download-source.ts`
- RMAB fetches every .torrent/.nzb itself (all 5 clients), then hands the file or magnet to the client
- Redirects followed one hop at a time, max `MAX_SOURCE_REDIRECT_HOPS` (5); `Location` resolved against the current hop (relative OK)
- `magnet:` accepted at any hop or as the response body (torrent clients only). Strict form everywhere (`isMagnetUri`: `^magnet:\?[^\s]+$`, no whitespace) because clients split URL lists on newlines; the processor drops releases with a malformed magnet before trying any client
- Hard deadline for the whole fetch (caller timeout; `AbortSignal.timeout`, since axios `timeout` is only an inactivity timer) → `DownloadSourceTimeoutError` (`code: 'ETIMEDOUT'`, transient: Bull retries the job); file size cap `MAX_SOURCE_FILE_BYTES` (50 MB)
- Unusable source (invalid/non-http redirect, malformed magnet hop, magnet for usenet, redirect loop) → `UnusableDownloadSourceError`: the processor tries the next ranked release; if it was the last, an earlier 429/5xx (retryable) error wins. With `blocklistReason` set (SABnzbd duplicate whose files are gone) the processor also blocklists the release (`addAutoBlock`, `download_fail`) first
- `AddDownloadOptions.retry`: set by the processor on a Bull retry (`job.attemptsMade > 0`, passed from `job-queue.service.ts`); SABnzbd looks for the job a timed-out upload left behind before uploading again, torrent clients ignore it (their add is already hash-idempotent). `AddDownloadOptions.releaseTitle` (usenet only): the name SABnzbd matches an existing job by. `AddDownloadResult.paused`: SABnzbd's held job waits paused (resumed only if RMAB added it)
- `httpsAgent` (usenet clients' "disable SSL verify") applies only to hops on the configured Prowlarr origin, and only when that origin is https
- **Prowlarr key:** `AddDownloadOptions.sourceAuth = { prowlarrBaseUrl, apiKey }` (built in `download-torrent.processor.ts` from `getProwlarrConnection()`). Key sent (`X-Api-Key` + `apikey` query restored if missing) **only** when the hop is exactly the configured scheme/host/port/credentials + `<base path>/{indexerId}/download` (`isProwlarrDownloadUrl`). Any other origin or Prowlarr path gets no key. Every grab is rewritten onto the configured base first (`toConfiguredProwlarrUrl(..., { withCredentials: true })`), which is the only place configured `user:pass@` is added
- Logs/errors: `urlForLog()` keeps scheme + host only (`magnet:` for magnets); `DownloadSourceError.sourceUrl` uses the same form
- HTTP error from source → `DownloadSourceError` (processor tries next ranked release on 429/5xx)
- **Which server answered (#298):** `DownloadSourceError.failure = { hop, redirects, authScheme? }` set by the fetcher. `hop`: `prowlarr` (failing hop on the configured Prowlarr origin), `redirect` (another host after ≥1 redirect), `direct` (another host, no redirect). `authScheme`: first word of `WWW-Authenticate` only (`Basic`), never realm/params. Messages built in `src/lib/utils/grab-failure.ts`:

| hop | Request `errorMessage` (no host ever) |
|---|---|
| prowlarr | `Grab failed: Prowlarr returned HTTP 401 for "<title>" (<indexer>)`; on 401/403 adds `This usually means a reverse proxy asks for a login on Prowlarr's download links (<Prowlarr URL>/<number>/download) while <Prowlarr URL>/api is open.` |
| redirect | `Grab failed: <indexer> returned HTTP 401 for "<title>" after a redirect` |
| direct / unknown | `Grab failed: <indexer> returned HTTP <status> while fetching "<title>" through Prowlarr` (unchanged) |

- Job log (`DownloadTorrent` job logger, so System Logs), one `warn` per failed fetch: `Download link answered HTTP 401 from <scheme://host> (the configured Prowlarr address | a redirect target | the download link host) after N redirects; WWW-Authenticate: Basic` (or `no WWW-Authenticate`). Usenet clients pass the fetcher's error through unchanged, so SABnzbd/NZBGet get the same messages

### User-Picked Releases
**File:** `src/lib/services/download-selection-guard.ts`
- Torrent/NZB picks (`request-with-torrent`, `select-torrent`, `select-ebook` indexer source, admin `replace`, admin `approve` incl. stored picks, admin `retry-download` when it re-adds a stored link): `downloadUrl` must be a `magnet:?` URI or a Prowlarr download link → else 400 `ValidationError`
- Prowlarr link match (`toConfiguredProwlarrUrl`), either:
  - **Configured address:** same host name as `prowlarr_url` (case-insensitive) + port + base path (case-insensitive) + `/{indexerId}/download`; tolerates http↔https (TLS proxy without `X-Forwarded-Proto`) and default-port differences
  - **Proxy link on any address (#298):** http(s), path ends in `/{digits}/download`, non-empty `link=` query. Prowlarr builds result links from the Host header it received (no setting for it), so behind a reverse proxy that rewrites Host they name an address RMAB can't reach (e.g. `https://127.0.0.1:9663`). The link's host, port, credentials and path prefix are dropped, never fetched
  - Anything else (another host without `link=`, `/{id}/download/x`, `/download`, `/abc/download`, empty `link=`) → rejected
- Either way the pick is **rewritten** to `{configured scheme}//{configured host}{configured base path}/{indexerId}/download{query}{hash}` **without credentials** (candidate credentials discarded), so stored picks, `DownloadHistory.magnetLink` and job payloads never hold them; non-admin pick responses omit `selectedTorrent` (`hideStoredPick`). The automatic grab uses the same rewrite; a non-Prowlarr link there is fetched as-is (no key: `isProwlarrDownloadUrl` is unchanged)
- Approve: an unusable stored user pick (or Anna's Archive with no links left) → warning, pick cleared, approve falls back to automatic search and the response says so (`selectionDropped`); Anna's Archive/FlareSolverr unreachable (`getSlowDownloadLinks(..., { throwOnError: true })`) → 503 `SourceUnavailable`, pick kept; an unusable admin-provided pick → 400. E-book pick routes also answer 503 when the source can't be reached
- Magnets are accepted as-is, so a user can choose a magnet's tracker list (accepted)
- Anna's Archive picks: only `md5` (32 hex) is trusted; links rebuilt with `getSlowDownloadLinks(md5, ebook_sidecar_base_url, flaresolverr)`; client `downloadUrl(s)` ignored
- Search responses (`search-torrents`, `requests/[id]/interactive-search`, both `interactive-search-ebook`): `stripProwlarrKeyFromResults()` removes any `apikey=<configured key>` on any origin from every string field (fetcher restores it for Prowlarr hops)
- Interactive search permission (`denyWithoutInteractiveSearchAccess`, `src/lib/middleware/interactive-search-access.ts`) enforced on all search + pick routes above (user routes) → 403
- Visibility: when a search's results carry proxy links on another origin, `prowlarr.service.ts` logs one info line per Prowlarr query (a request search runs several): `Prowlarr published download links on <scheme://host:port>; using the configured address <origin> instead` (origin only, no path/query/key)

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
**POST /api/admin/settings/download-clients/categories** - The client's category names (400 on failure); wizard: `POST /api/setup/download-client-categories` (500 on failure)

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
- Legacy: Converts to array on save (keeps the sent `category`)
- New: Saves as `download_clients` JSON
- Both: category ownership decided first (`src/lib/services/setup-download-categories.ts`, see Download Categories)

## Edge Cases

**Single client:** Works exactly as before (protocol filtering active)
**No clients:** Wizard requires one; settings shows warning
**Client disabled:** Results for that protocol filtered out
**Connection failure:** Per-download error handling (existing)
**Mixed results:** Best release selected regardless of protocol when both clients configured
**Custom path blank:** Uses base `download_dir` (backward-compatible default)
**Custom path with slashes:** Leading/trailing slashes stripped automatically
**Custom path with `..`:** Rejected by frontend validation and API validation
**Switching torrent clients:** Must delete existing torrent client before adding Transmission (or vice versa). Rows recorded for the old client are then left alone (no probe, mark or delete)
**Torrent already in the client:** recorded as taken over, never removed or re-categorized (see Torrent Ownership)

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
| `src/lib/integrations/torrent-ids.ts` | Shared torrent IDs: magnet/.torrent hashes, base32 → hex, candidate IDs, recorded add ID |
| `src/lib/services/download-client-manager.service.ts` | Core multi-client service, protocol-based routing |
| `src/lib/integrations/prowlarr.service.ts:379` | Protocol filtering logic (both clients = all results) |
| `src/lib/processors/download-torrent.processor.ts:44` | Download routing (detect protocol → route), builds `sourceAuth`, writes `addedByRmab` |
| `src/lib/utils/torrent-ownership.ts` | Ownership rule (`resolveOwnership`, `knownNotOwned`) |
| `src/lib/integrations/torrent-probe.ts` | Strict probe answer parsers (qBittorrent, Transmission, Deluge) |
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
