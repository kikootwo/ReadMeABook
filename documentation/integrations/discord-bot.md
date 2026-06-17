# Discord Bot (Slash-Command Requesting)

**Status:** ✅ Implemented | Gateway bot (discord.js) for in-Discord requesting

## Overview
A persistent discord.js gateway bot lets linked users request and manage titles from Discord via `/checkout`, `/status`, and `/delete`, mapped to their existing RMAB user. Reuses the same request services as the Web UI (creation, ebook sidecar, approval, deletion). Per-user library tagging (filter/sort by RMAB user) is **deferred** (not in this build).

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

Typed accessor: [src/lib/services/discord/discord-config.ts](../../src/lib/services/discord/discord-config.ts) (`getDiscordConfig`, `isDiscordBotConfigured`, `getApprovalChannelId`).

## User Mapping
- `User.discordUserId` (unique, nullable) — set by admins in the Users page edit modal (`PUT /api/admin/users/[id]`).
- [discord-user.resolver.ts](../../src/lib/services/discord/discord-user.resolver.ts): `resolveRmabUser(discordUserId)` → `{ user, isAdmin }` (`isAdmin = role==='admin' || isSetupAdmin`); null → ephemeral "not linked" guidance.

## Commands
- **/checkout `<type>`** (audiobook|ebook): search modal → `audibleService.search` → result dropdown → confirm (cover thumbnail) → create request.
  - audiobook → `createRequestForUser` ([request-creator.service.ts](../../src/lib/services/request-creator.service.ts), `bypassIgnore: true`).
  - ebook → `createEbookRequestForUser` ([ebook-request-creator.service.ts](../../src/lib/services/ebook-request-creator.service.ts)). **Sidecar rule:** the audiobook must already be in the library, else it's rejected (same as the Web "Fetch Ebook" button).
- **/status**: lists invoker's outstanding requests (admins see all). Read-only.
- **/delete**: dropdown of invoker's outstanding requests (admins see all) → `deleteRequest`. Non-admins can only delete their own (ownership re-checked on select).

"Outstanding" statuses: pending, awaiting_approval, searching, downloading, processing, awaiting_search, awaiting_import, awaiting_release, warn.

## Approval Flow
- Request needing approval (status `awaiting_approval`) → bot posts to the approval channel: `<@&adminRoleId>` ping + rich embed (title, author, year, series, cover) + **Approve/Deny** buttons.
- Click authority: RMAB admin **or** holds `adminRoleId`. Approve/Deny → shared `processRequestApproval` ([request-approval.service.ts](../../src/lib/services/request-approval.service.ts), also used by the Web approve route). Message is locked (buttons disabled) and the requester is DM'd on approval (channel echo not used; DM best-effort).

## Modules (src/lib/services/discord/)
- `discord-bot.service.ts` — singleton client; `start/stop/restart/isReady`; registers commands on `ready`; routes interactions.
- `interaction-router.ts` — dispatch by command name / decoded customId; defers within 3s.
- `command-definitions.ts` — SlashCommandBuilder defs (guild-scoped JSON).
- `custom-id.ts` — encode/decode all cross-interaction state into ≤100-char customIds (no server session).
- `embeds.ts` — embeds, select menus, buttons (severity colors match the notification provider).
- `discord-helpers.ts` — outstanding-status list, actor log context, request queries.
- `discord-rest.helper.ts` — token-based REST for settings Test/Resolve (no gateway needed).
- `handlers/checkout.handler.ts`, `handlers/status-delete.handler.ts`, `handlers/approval.handler.ts`.

## Settings UI
- Tab: [DiscordTab](../../src/app/admin/settings/tabs/DiscordTab/DiscordTab.tsx) (self-contained). Enable toggle, bot token (+ Test Token), guild/channel/role IDs, optional notify channel, **Resolve Names** (confirms IDs → human names).
- Routes: `PUT /api/admin/settings/discord` (save; restarts bot), `POST /api/admin/settings/test-discord` (validate token), `POST /api/admin/settings/discord/resolve` (role/channel/user names). Token masked as `••••` on read.

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
