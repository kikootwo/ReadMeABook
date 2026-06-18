# Discord Bot (Slash-Command Requesting)

**Status:** ✅ Implemented | Gateway bot (discord.js) for in-Discord requesting

## Overview
A persistent discord.js gateway bot lets linked users request and manage titles from Discord via `/request`, `/status`, and `/delete`, mapped to their existing RMAB user. Reuses the same request services as the Web UI (creation, ebook sidecar, approval, deletion). Per-user library tagging (filter/sort by RMAB user) is **deferred** (not in this build).

## Transport
- **discord.js gateway** (persistent WebSocket), NOT an HTTP interactions endpoint. No public URL/signature needed.
- Singleton started once at app init: `getDiscordBotService().start()` in [src/app/api/init/route.ts](../../src/app/api/init/route.ts) — same process as Bull workers. Idempotent; gated on config.
- Server-only: `discord.js` in `serverExternalPackages` + client-alias `false` in [next.config.ts](../../next.config.ts). Never import the bot from client components.
- **Lazy-loaded:** `discord.js` and the command/router modules are pulled via dynamic `import()` inside `start()`/`registerCommands()` — never at module scope (`Client` is a type-only import, erased at build). When the bot is **disabled**, importing the service (e.g. from `/api/init`) loads **nothing** from discord.js → zero runtime footprint until enabled.
- **Single-guild** assumption: commands registered guild-scoped (instant propagation) for the configured `guildId`.

## Config (category `discord`, Configuration table)
| Key | Notes |
|-----|-------|
| `discord.enabled` | 'true'/'false' |
| `discord.bot_token` | **encrypted** (AES-256-GCM) |
| `discord.guild_id` | server ID |
| `discord.request_channel_id` | channel for approval embeds |
| `discord.admin_role_id` | pinged for approvals; grants Approve/Deny authority |
| `discord.admin_notify_channel_id` | optional; approval pings go here, else request channel |
| `discord.request_card_mode` | `public` (default) / `dm` / `both` — where the live request card is posted |
| `discord.requester_role_id` | optional; restricts who may `/request` (blank = any linked user; admins always pass) |
| `discord.delete_permission` | `own_only` (default) / `anyone_any` / `admin_only` / `disabled` — who may `/delete` |

Typed accessor: [src/lib/services/discord/discord-config.ts](../../src/lib/services/discord/discord-config.ts) (`getDiscordConfig`, `isDiscordBotConfigured`, `getApprovalChannelId`).

## User Mapping
- `User.discordUserId` (unique, nullable) — set by admins on the Users page edit modal, or in bulk via the Discord tab's **Link Discord Usernames** modal (both `PUT /api/admin/users/[id]`; `role` is optional on that route so a Discord-only update needn't change the role).
- **Link Discord Usernames modal:** lists all RMAB users; per-row search hits `POST /api/admin/settings/discord/search-members` → `searchGuildMembers` (Discord `GET /guilds/{id}/members/search`, matches username + nickname, filtered to `requester_role_id` when set). Results + existing mappings show as colored avatar pills; selecting one persists the Discord User ID, Unlink clears it.
- **Existing-mapping pills:** resolved via `POST /api/admin/settings/discord/resolve-members` → `resolveMembersByIds` (guild member → user fallback; one shared REST client across the batch so discord.js throttles through a single set of rate-limit buckets), cached client-side in `localStorage` ([discordMemberCache.ts](../../src/lib/utils/discordMemberCache.ts), 24h TTL) to avoid re-fetching on every open. The Users-page edit modal shows the same pill right-aligned in the Discord ID field.
- [discord-user.resolver.ts](../../src/lib/services/discord/discord-user.resolver.ts): `resolveRmabUser(discordUserId)` → `{ user, isAdmin }` (`isAdmin = role==='admin' || isSetupAdmin`); null → ephemeral "not linked" guidance.
- **Requester gate:** when `requester_role_id` is set, `/request` is allowed only for members holding that role (RMAB admins always pass) — enforced in `handleRequestCommand` via `memberHasRole`.

## Commands
- **/request `<type>`** (audiobook|ebook): search modal → `audibleService.search` → result dropdown → confirm (cover thumbnail) → create request → post live **request card** (see below).
  - audiobook → `createRequestForUser` ([request-creator.service.ts](../../src/lib/services/request-creator.service.ts), `bypassIgnore: true`).
  - ebook → `createEbookRequestForUser` ([ebook-request-creator.service.ts](../../src/lib/services/ebook-request-creator.service.ts)). **Sidecar rule:** the audiobook must already be in the library, else it's rejected (same as the Web "Fetch Ebook" button).
- **/status**: lists invoker's outstanding requests (admins see all). Read-only.
- **/delete**: dropdown of invoker's deletable requests → select shows a **confirmation preview** (warning-colored embed enriched with Duration/Series/Format/Genre/File Size + cover) with **Confirm Delete** / **Cancel** buttons. The dropdown stays open, so re-selecting another title re-renders the preview. Only **Confirm Delete** commits `deleteRequest` (cascading soft-delete: files, library backend, download client); **Cancel** dismisses without removing anything. Gated by `discord.delete_permission`:
  - `own_only` (default): users see/delete their own; admins see/delete all.
  - `anyone_any`: all linked users see and can delete any request.
  - `admin_only`: only RMAB admins may use the command.
  - `disabled`: command responds with an error for everyone.
  Permission + ownership are re-checked at **both** select and confirm time (the Confirm button's customId is untrusted; guards against stale dropdowns).
  - Preview enrichment: Duration/Format(abridgement)/Genre aren't persisted in the DB — they're best-effort merged from live Audible metadata (`getAudiobookDetails(audibleAsin)`); File Size/Format come from the cached `audiobook.fileSizeBytes`/`fileFormat` (populated post-download). Enrichment failures degrade gracefully to cached fields (`fetchDeletePreviewItem`).

"Outstanding" statuses (for /status): pending, awaiting_approval, searching, downloading, processing, awaiting_search, awaiting_import, awaiting_release, warn.

"Deletable" statuses (for /delete): all outstanding statuses + available, downloaded.

## Request Card (live, auto-updating)
- On `/request` confirm, the bot posts a **persistent rich card** (cover thumbnail, description, Author/Narrator/Series #/Format/Duration/Genre, Requested By) with the current status in the **footer**. The release **year is appended to the embed title** in parentheses (e.g. `Lonesome Dove (2025)`); there is no standalone Year field. **Author/Narrator show only the top-listed person.** **Narrator, Duration, and Format are audiobook-only** (omitted for ebooks). Genre lists up to two genres when present. Delivery per `discord.request_card_mode`: `public` (configured request channel), `dm` (requester), or `both`.
- Footer reflects lifecycle: `⏳ Awaiting Admin Approval`, `🚫 Request Denied`/`Cancelled`, or once approved `✅ Approved • <stage>` (🔎 Searching / ⬇️ Downloading / ⚙️ Processing / 📚 Download Complete / ❌ Download Failed). Color tracks status.
- **Cancel Request** button shown while the request is still in flight (`isCancellableStatus`). Authorized for the **requester or any admin** (RMAB admin / `adminRoleId`) → shared `deleteRequest` (stops search/download, handles seeding) → card re-rendered to Cancelled, button removed. If the request was still `awaiting_approval`, the admin approval message is also rewritten to `🚫 Cancelled by <user>` with its Approve/Deny buttons removed (embed kept for reference) via `cancelApprovalMessage`. `/delete` of a pending request does the same.
- Message refs persisted on `Request.discordCards` (`[{kind:'public'|'dm'|'approval', channelId, messageId}]`); writes go through `mergeCardRefs` so the approval ref and the public/DM card refs coexist. The `send-notification` processor calls `editRequestCards(requestId)` after every status notification (gated on `getClient()` so discord.js stays lazy when the bot is off) — it re-reads `request.status` and rewrites footer/color/button in place (skipping the `approval` ref).

## Approval Flow
- Request needing approval (status `awaiting_approval`) → bot posts to the approval channel: `<@&adminRoleId>` ping + rich embed (title shows **⏳ Pending**; a **Title** field carries the book title with year in parentheses; author, narrator, duration, series #, format, genre, cover — narrator/duration/format audiobook-only, author/narrator top-listed) + **Approve/Deny** buttons. The message location is recorded (`recordApprovalMessage`) so it can be updated on cancel.
- Click authority: RMAB admin **or** holds `adminRoleId`. Approve/Deny → shared `processRequestApproval` ([request-approval.service.ts](../../src/lib/services/request-approval.service.ts), also used by the Web approve route; the transition is claimed atomically so concurrent clicks can't double-process — see [request-approval.md](../admin-features/request-approval.md)). Embed title rewritten to **✅ Approved by X** / **🚫 Denied by X**, buttons disabled, the requester's request card refreshed, and the requester DM'd on approval (best-effort).
- **Two independent approval surfaces.** The bot's interactive approval message (above, in `admin_notify_channel_id`/`request_channel_id`) is separate from the **Discord webhook notifications** (Settings → Notifications → Discord, [notifications.md](../backend/services/notifications.md)), which also emit a `request_pending_approval`/`request_approved` embed. They serve different setups (the webhook works without the bot; only the bot's message has buttons) and normally reach different audiences (channel announcement vs the requester's DM on approval). **Recommendation:** point the webhook notification channel and the bot approval channel at **different channels** — pointing both at the same channel intentionally produces two messages (one actionable, one informational), not a bug. Suppressing one is avoided because it would regress non-bot/email setups or drop the requester's personal DM.

## Modules (src/lib/services/discord/)
- `discord-bot.service.ts` — singleton client; `start/stop/restart/isReady`; registers commands on `ready`; routes interactions.
- `interaction-router.ts` — dispatch by command name / decoded customId; defers within 3s.
- `command-definitions.ts` — SlashCommandBuilder defs (guild-scoped JSON).
- `custom-id.ts` — encode/decode all cross-interaction state into ≤100-char customIds (no server session). Paginated kinds parse the page via `parsePage` (rejects empty/negative/non-integer from tampered IDs → decode returns null).
- `embeds/` — embed/select/button builders, split to stay under the per-file size cap, re-exported via `embeds/index.ts` (import surface stays `./embeds`): `book-fields.ts` (palette, text helpers, `BookEmbedFields`, shared `addBookFields`, status footer/color/cancellability), `request-cards.ts` (search select, confirm/live request card), `approval.ts` (approval message + decision/cancel rewrites), `lists.ts` (/status & /delete paginated lists, the shared request-select builder, the /delete confirmation preview + Confirm/Cancel buttons, post-delete confirm embed). All list/card field rendering goes through `addBookFields` for one consistent field set.
- `discord-cards.ts` — post/update the live request card (public + DM); `postRequestCards`, `editRequestCards`.
- `discord-helpers.ts` — outstanding-status list, actor log context, request queries.
- `discord-rest.helper.ts` — token-based REST for settings Test/Resolve (no gateway needed).
- `handlers/request.handler.ts`, `handlers/status-delete.handler.ts`, `handlers/approval.handler.ts`.

## Settings UI
- Tab: [DiscordTab](../../src/app/admin/settings/tabs/DiscordTab/DiscordTab.tsx) (self-contained). Enable toggle, bot token (+ Test Token), guild/channel/role IDs, optional notify channel, optional requester role, **Request card delivery** (public/dm/both), **/delete command permissions** (own_only/anyone_any/admin_only/disabled), **Resolve Names** (confirms IDs → human names), **Link Discord Usernames** ([MapUsersModal](../../src/app/admin/settings/tabs/DiscordTab/MapUsersModal.tsx)).
- **Bot identity pill:** a successful **Test Token** renders an avatar pill (next to the button) of the connected bot; it links to `https://discord.com/developers/applications/{botId}/bot` (bot user ID == application ID) → the bot's config in the Discord Developer Portal. `fetchBotUser` returns `{id, username, avatarUrl}`; surfaced by `test-discord` as `botId/botUsername/botAvatarUrl`.
- Routes: `PUT /api/admin/settings/discord` (save; restarts bot), `POST /api/admin/settings/test-discord` (validate token), `POST /api/admin/settings/discord/resolve` (role/channel/user names). Token masked as `••••` on read.
- **Cache invalidation on save:** the save route upserts config directly (bypassing `configService.setMany`), so it explicitly `clearCache`s every `discord.*` key before `restart()`. Without this, a disable→re-enable within the config service's 60s cache TTL would read the stale `enabled='false'` and the bot would silently fail to reconnect ("application did not respond").

## Logging
Handlers log via `RMABLogger.create('Discord.*')` with actor context `{ discordUserId, discordUsername, rmabUserId }`.

## Enable/Disable lifecycle
- Toggled via the **Enable Discord bot** checkbox in the Discord settings tab.
- **Off:** saving persists `discord.enabled='false'` then calls `restart()` → `stop()` (`client.destroy()` closes the gateway WebSocket, nulls the client/listeners) → `start()` short-circuits on the `enabled` gate. No connection, no client, no listeners. Combined with lazy loading, discord.js isn't even loaded when disabled at boot.
- **On:** saving persists `enabled='true'` then `restart()` → `start()` dynamically imports discord.js, logs in, registers commands. Takes effect immediately (no container restart).

## Edge cases

Bot disabled/unconfigured → init skips start (and skips loading discord.js). Unlinked user → ephemeral guidance. Invalid token → caught at start + surfaced by Test. Gateway auto-reconnects; commands re-registered on each `ready`. Stale/double approval → status guard + buttons disabled. DM closed → logged, non-fatal.

## Deferred
Per-user library tags (Plex labels / ABS tags) for filter/sort by RMAB user — design settled (apply at scan-plex mark-available for all requests) but not built, pending project-head decision.

## Related
[backend/services/notifications.md](../backend/services/notifications.md), [admin-features/request-approval.md](../admin-features/request-approval.md), [integrations/ebook-sidecar.md](ebook-sidecar.md), [settings-pages.md](../settings-pages.md)
