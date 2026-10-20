# Notification System

**Status:** ✅ Implemented | Extensible notification system with Discord, ntfy, and Pushover support

## Overview
Sends notifications for audiobook request events (pending approval, approved, available, error) to configured backends. Non-blocking, atomic per-backend failure handling. Proper notification timing for all request flows including interactive search.

## Key Details
- **Backends:** Apprise (API), Discord (webhooks), ntfy (API), Pushover (API)
- **Events:** request_pending_approval, request_approved, request_grabbed, request_available, request_error, issue_reported
- **Encryption:** AES-256-GCM for sensitive config (webhook URLs, API keys, notification URLs)
- **Delivery:** Async via Bull job queue (priority 5)
- **Failure Handling:** Non-blocking, Promise.allSettled (one backend fails, others succeed)

## Database Schema

```prisma
model NotificationBackend {
  id        String   @id @default(uuid())
  type      String   // 'apprise' | 'discord' | 'ntfy' | 'pushover'
  name      String   // User-friendly label
  config    Json     // Encrypted sensitive values
  events    Json     // Array of subscribed events
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

## Event Types

| Event | Trigger | Notification Sent When |
|-------|---------|------------------------|
| request_pending_approval | User creates request | Request needs admin approval |
| request_approved | Admin approves OR auto-approval | Request approved (manual or auto) |
| request_grabbed | Torrent/NZB added to download client | Download handed off to configured download client (title resolves by type) — **opt-in: existing backends do not auto-subscribe; enable in Settings** |
| request_available | Plex/ABS scan or ebook download completes | Request available (title resolves by type) |
| request_error | Download/import fails | Request failed at any stage |
| issue_reported | User reports issue | User reports problem with available audiobook |

**Dynamic Titles:** Events can define `titleByRequestType` in `notification-events.ts` for type-specific titles.
- `request_grabbed` + `requestType: 'audiobook'` → "Audiobook Grabbed"
- `request_grabbed` + `requestType: 'ebook'` → "Ebook Grabbed"
- `request_available` + `requestType: 'audiobook'` → "Audiobook Available"
- `request_available` + `requestType: 'ebook'` → "Ebook Available"
- `request_available` + no requestType → "Request Available" (fallback)
- Use `getEventTitle(event, requestType?)` to resolve titles in providers

## Notification Triggers

**Request Creation (POST /api/requests)**
- Automatic search, approval needed: `status === 'awaiting_approval'` → request_pending_approval
- Automatic search, auto-approved: `status === 'pending'` → request_approved
- Interactive search: NO notification yet (deferred until torrent selection)

**BookDate Swipe (POST /api/bookdate/swipe)**
- Right swipe, approval needed: `status === 'awaiting_approval'` → request_pending_approval
- Right swipe, auto-approved: `status === 'pending'` → request_approved

**Request with Pre-Selected Torrent (POST /api/audiobooks/request-with-torrent)**
- Approval needed: `status === 'awaiting_approval'` → request_pending_approval
- Auto-approved: `status === 'downloading'` → request_approved

**Torrent Selection for Existing Request (POST /api/requests/[id]/select-torrent)**
- Approval needed: `status === 'awaiting_approval'` → request_pending_approval
- Auto-approved: `status === 'downloading'` → request_approved

**Admin Approval (POST /api/admin/requests/[id]/approve)**
- Approve (with or without pre-selected torrent): After job triggered → request_approved
- Deny: No notification

**Download Grabbed (processor: download-torrent)**
- After `client.addDownload()` succeeds and `DownloadHistory` record created → request_grabbed
- `message` field: `"${torrent.title} via ${indexer} (${clientType})"`
- `requestType`: from `request.type` (audiobook/ebook)

**Audiobook Available (processors: scan-plex, plex-recently-added)**
- After `status: 'available'` update → request_available (requestType: 'audiobook')
- Includes user info in query (plexUsername)

**Ebook Available (processor: organize-files)**
- After ebook `status: 'downloaded'` (terminal) → request_available (requestType: 'ebook')
- Ebooks don't transition to 'available' via Plex matching

**Request Error (processors: monitor-download, organize-files)**
- After `status: 'failed'` or `status: 'warn'` update → request_error
- Includes error message in payload

**Issue Reported (reported-issue.service.ts)**
- After user reports issue with available audiobook → issue_reported
- Payload: issue ID (as requestId), book title/author, reporter username, reason (as message)

## Configuration Encryption

**Encrypted Values:**
- Apprise: `urls`, `authToken`, `basicAuthPassword`
- Discord: `webhookUrl`
- ntfy: `accessToken`
- Pushover: `userKey`, `appToken`

**Pattern:** `iv:authTag:encryptedData` (base64)

**Masking:** Sensitive values returned as `••••••••` in API responses

**Preservation:** `NotificationService.mergeMaskedSecrets(type, existing, updated)` on update: a masked value (`MASKED_CONFIG_VALUE` = `••••••••`) keeps the existing encrypted value
- Providers with `secretBoundUrl` (Apprise: `serverUrl`, no default; ntfy: `serverUrl`, default `https://ntfy.sh`): a kept secret requires the same server URL (`isSameServiceUrl`; ntfy: empty = `https://ntfy.sh` on both sides) → else `PUT` returns 400 `{ error: 'ValidationError', message }` naming the fields to re-enter, nothing saved
- Apprise: an empty or scheme-less `serverUrl` with masked secrets → 400 asking for the full `http(s)://` URL
- Discord, Pushover: no server URL binding

**Apprise Basic auth (credentials never in `serverUrl`):** `src/lib/services/notification/providers/apprise-credentials.ts`
- Fields: `serverUrl` (plain, shown), `basicAuthUser` (plain), `basicAuthPassword` (sensitive)
- On every admin write (POST, PUT, test with `type+config`): `prepareSubmittedConfig()` → provider `normalizeSubmittedConfig()` moves `user:pass@` out of `serverUrl`. Userinfo is %-decoded run by run (`decodeUserinfo`: a stray `%` stays as typed, other escapes still decode; a run that is not valid UTF-8 is decoded escape by escape, longest valid sequence first, e.g. `^%E2` → `^%E2`, invalid escapes kept as typed). When the URL's password fills `basicAuthPassword` (field empty/missing/mask), the URL's username replaces `basicAuthUser` too; a typed password wins and the username is then only filled if blank. Then every non-empty, non-mask sensitive value is encrypted (even if it looks like ciphertext: a client-supplied ciphertext is stored as text, never decrypted); a non-text sensitive value → 400 `"<Label> must be text."`
- `serverUrl` that is not an http(s) URL and contains `@` → 400 (credentials could not be removed). Note `alice:pw@host` parses with scheme `alice:`, so it counts as not http(s)
- PUT order: saved config in migrated form (`migrateStoredConfig`) → submitted prepared → `mergeMaskedSecrets` (password is URL-bound like the other secrets) → `encryptConfig`
- Display: `maskConfig()` shows a not-yet-migrated row in migrated form (URL without credentials, `basicAuthUser`, `basicAuthPassword: ••••••••`); the mask is never placed inside a URL. A stored server URL that is not a valid http(s) URL but contains `@` (e.g. legacy `alice:pw@apprise:8000`, which never sent) is shown as the part after the last `@` only; such rows are not migrated
- Startup migration `migrateStoredSecrets()` (scheduler init, after `reEncryptUnprotectedBackends()`, serially): rows whose `serverUrl` has userinfo → URL stripped, userinfo wins over existing fields, password encrypted (an empty password is never stored); compare-and-swap on `updatedAt`; per-row errors logged and skipped; idempotent. `reEncryptUnprotectedBackends()` is per-row too: a failing row or a non-text sensitive value (skipped, value never logged) doesn't stop the others
- `send()`: validates `serverUrl` first (invalid → generic "The Apprise Server URL is not a valid URL", never echoing it); request URL never carries userinfo; Basic: userinfo still in a not-yet-migrated URL wins over the fields, per part (username, password), the same rule as the migration and `maskConfig`, so a send before and after the migration uses the same credentials; `authToken` (Bearer) wins over Basic
- Rollback: older versions read Basic auth only from `serverUrl`, so after a downgrade Apprise Basic auth fails until the credentials are re-entered in the URL. Change the Apprise password if DB backups or logs from before the upgrade are kept (they hold it in plaintext)

## Message Formatting

**Apprise (JSON via Apprise API):**
- Type: info (pending), success (approved/available), failure (error)
- Modes: Stateless (send URLs directly) or Stateful (use persistent configKey, optional tag filter)
- Endpoint: `{serverUrl}/notify/` (stateless) or `{serverUrl}/notify/{configKey}` (stateful)
- Auth: optional Bearer token (`authToken`), else optional Basic auth (`basicAuthUser` / `basicAuthPassword`)
- Format: Event title + book details + user + error (if applicable)

**Discord (Rich Embeds):**
- Color-coded by event (yellow=pending, green=approved, blue=available, red=error, orange=issue)
- Fields: Title, Author, Requested/Reported By, Error/Reason (if applicable)
- Footer: Request/Issue ID
- Timestamp: Event time

**ntfy (JSON Publishing to Base URL):**
- Endpoint: POST to base `serverUrl` (default: https://ntfy.sh), topic in JSON body
- Tags: mailbox_with_mail, white_check_mark, tada, x, triangular_flag_on_post (rendered as emojis by ntfy)
- Priority: Default (3) for pending/approved, High (4) for available/error
- Format: Event title + book details + user + error (if applicable)
- Auth: Optional Bearer token via `accessToken` config field
- Server: Configurable `serverUrl` (default: https://ntfy.sh)

**Pushover (Plain Text with Emojis):**
- Emojis: 📬 📬 🎉 ❌
- Priority: Normal (0) for pending/approved, High (1) for available/error
- Format: Event title + book details + user + error (if applicable)

## API Endpoints

**GET /api/admin/notifications**
- Returns all backends (sensitive values masked)

**POST /api/admin/notifications**
- Create backend (encrypts sensitive values)
- Body: `{type, name, config, events, enabled}`

**GET /api/admin/notifications/[id]**
- Get single backend (sensitive values masked)

**PUT /api/admin/notifications/[id]**
- Update backend (masked values kept via `mergeMaskedSecrets`, URL-bound for Apprise/ntfy; new values encrypted)

**DELETE /api/admin/notifications/[id]**
- Delete backend

**POST /api/admin/notifications/test**
- Test notification (synchronous, not via job queue)
- Body: `{backendId}` (stored config) or `{type, config}` (prepared like a save: normalised, secrets encrypted as text)
- Sends test payload: "The Hitchhiker's Guide to the Galaxy" by Douglas Adams

## UI Components

**NotificationsTab (src/app/admin/settings/tabs/NotificationsTab)**
- Type selector cards (Discord: indigo "D", Pushover: blue "P")
- Configured backends grid (3 columns)
- Backend cards: type icon, name, enabled status, event count, edit/delete actions
- Modal: type-specific forms, event checkboxes, enable toggle, test button

**Modal Features:**
- Type-first selection (user clicks "Add Discord" or "Add Pushover")
- Password inputs for sensitive values
- Event subscription checkboxes (5 events, default: available + error)
- Test button (sends synchronous test notification)
- Save button (validates and creates/updates backend)

## Job Queue Integration

**Job Type:** `send_notification` (priority 5, concurrency 5)

**Payload:**
```typescript
{
  jobId?: string,
  event: string,
  requestId: string,
  title: string,
  author: string,
  userName: string,
  message?: string,
  requestType?: string, // 'audiobook' | 'ebook' — drives type-specific titles
  timestamp: Date
}
```

**Processor:** `src/lib/processors/send-notification.processor.ts`
- Calls NotificationService.sendNotification()
- Non-blocking error handling (logs but doesn't throw)

**Queue Method:** `addNotificationJob(event, requestId, title, author, userName, message?, requestType?)`

## Architecture

**Provider Pattern:** `INotificationProvider` interface + registry (matches `IAuthProvider` pattern)

```
src/lib/services/notification/
  INotificationProvider.ts          # Interface + shared types
  notification.service.ts           # Core service with registry
  index.ts                          # Re-exports
  providers/
    apprise.provider.ts             # Apprise API (100+ services)
    apprise-credentials.ts          # Credentials out of serverUrl (normalise, lift, split)
    discord.provider.ts             # Discord webhook
    ntfy.provider.ts                # ntfy API
    pushover.provider.ts            # Pushover API
```

**Registry:** Module-level `Map<string, INotificationProvider>` with `registerProvider()` / `getProvider()`

**INotificationProvider interface:**
- `type: string` — provider identifier (registry key)
- `sensitiveFields: string[]` — fields needing encryption/masking
- `secretBoundUrl?: { field, defaultUrl?, credentialKind }` — config field holding the server URL the sensitive fields are sent to (Apprise, ntfy)
- `normalizeSubmittedConfig?(config)` — normalise an admin-submitted config before merge/encrypt (Apprise: credentials out of the URL); may refuse with an error
- `liftStoredSecrets?(config)` — migrated form of a stored config + plaintext password to encrypt (Apprise legacy URL userinfo), or null
- `metadata: ProviderMetadata` — self-describing UI/validation metadata
- `send(config, payload): Promise<void>` — receives decrypted config

**ProviderMetadata:** `{ type, displayName, description, iconLabel, iconColor, configFields[] }`
**ProviderConfigField:** `{ name, label, type, required, placeholder?, helpText?, defaultValue?, options? }` (`helpText` shown under the field)

**Helper functions (notification.service.ts):**
- `getRegisteredProviderTypes(): string[]` — all registered type keys
- `getAllProviderMetadata(): ProviderMetadata[]` — metadata for all providers

**Helper functions (notification-events.ts):**
- `getEventMeta(event)` — raw event metadata (label, title, emoji, severity, priority)
- `getEventTitle(event, requestType?)` — resolved title (checks `titleByRequestType` first, falls back to `title`)
- `getEventLabel(event)` — human-readable label for UI

**API Endpoint:** `GET /api/admin/notifications/providers` — returns all provider metadata (admin-only)

## Extensibility

**Adding New Backend (2 steps):**
1. Create `providers/email.provider.ts` implementing `INotificationProvider`:
   - Set `type = 'email'`, `sensitiveFields = ['smtpPassword']`
   - Set `metadata` with displayName, description, iconLabel, iconColor, configFields
   - Implement `send()` with email-specific logic
2. Register in `notification.service.ts`: `registerProvider(new EmailProvider())` + re-export from `index.ts`

No UI changes, no API route changes, no Zod schema changes needed — the UI renders dynamically from provider metadata.

**Adding New Event (e.g., download_complete):**
1. Add entry to `NOTIFICATION_EVENTS` in `notification-events.ts` (label, title, emoji, severity, priority)
2. Optionally add `titleByRequestType` for type-specific titles
3. Add trigger point in processor, passing `requestType` if relevant
4. Providers auto-resolve titles via `getEventTitle()` — no per-provider changes needed

## Tech Stack
- Bull (job queue)
- Node.js crypto (AES-256-GCM encryption)
- Apprise API, Discord webhooks, ntfy API, Pushover API
- React (UI), Tailwind CSS (styling)

## Fixed Issues

**Apprise server URL credentials stored and shown in plaintext**
- **Cause:** Basic auth for an Apprise server behind auth was only possible as `https://user:pass@host` in `serverUrl`, a plain (unencrypted, unmasked) field
- **Fix:** separate `basicAuthUser` / `basicAuthPassword` (encrypted) fields; credentials typed into the URL are moved on save; existing rows migrated at startup; the API returns neither the password nor URL userinfo. Exception: a legacy row whose URL was never a valid http(s) URL is not migrated (its credentials stay in the stored value until the admin re-saves it) but is displayed without the part before the last `@`

## Related
- [Job Queue System](jobs.md)
- [Config Encryption](config.md)
- [Settings Pages](../../settings-pages.md)
