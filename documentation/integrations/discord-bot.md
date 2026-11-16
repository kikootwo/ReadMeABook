# Discord Bot

**Status:** ⏳ In Progress | #231 parts 2-4 of 5: the bot connects when configured; `/request` for audiobooks and ebooks; request cards and Approve / Deny

## Overview
Optional Discord bot. Off by default; with it off RMAB loads no Discord code and opens no Discord connection. Users act in Discord as the RMAB account an admin links to their Discord ID ([auth.md](../backend/services/auth.md#discord-identity-link)). Commands: `/request` ([below](#request)); requests made in Discord get live cards and, while waiting, an approval message with Approve / Deny ([below](#request-cards)). A later part adds `/status`, Cancel and `/delete`.

## Settings (`configuration` table, category `discord`)
| Key | Value |
|---|---|
| `discord.enabled` | `'true'` / `'false'` (missing = off) |
| `discord.bot_token` | Bot token, `encrypted: true`; never returned (masked `••••••••••••`) |
| `discord.guild_id` | The one server the bot serves (snowflake) |
| `discord.request_channel_id` | Optional channel for public request cards (card mode `public` / `both`) |
| `discord.admin_role_id` | Optional role pinged on approval messages; never grants rights |
| `discord.admin_notify_channel_id` | Optional channel for approval messages; empty = no approval message is posted and admins approve on the web as before |
| `discord.request_card_mode` | `dm` (default) / `public` / `both`: where the request card goes; tab "Request cards"; unset or unknown reads as `dm` |
| `discord.requester_role_id` | Optional role a member needs for `/request`; empty = every linked user; RMAB admins always may. Read on every `/request` step (`loadRequesterRoleId`: straight from the database, so a failed read throws and the step is refused) |
- `isDiscordConfigured` = enabled && token && valid server ID (`src/lib/services/discord/discord-config.ts`)
- IDs: 15-20 digits, no leading zero (same rule as Discord user IDs)
- One RMAB instance per bot token (two instances on one token would both answer)
- **Use a Discord application made only for RMAB, with Public Bot off:** connecting bulk-overwrites that application's commands in the server (today: `/request`), so commands another tool registered there are removed

## Lifecycle (`src/lib/services/discord/discord-bot.service.ts`)
- Started from app init after `done = true`, **not awaited** (`startDiscordBotInBackground`, `scheduler.md`); a slow or unreachable Discord never delays the init route
- `start()`: reads settings → not configured: one info log `Discord bot not started` `{reason}` and nothing else (discord.js not loaded) → else `import('discord.js')` (once per process) → `Client({ intents: [Guilds], allowedMentions: { parse: [] } })` → `login`
- Ready: status `running`, `isDiscordBotRunning()` true, log `Discord bot connected`; commands bulk-overwritten in the server with the current list (`DISCORD_COMMANDS` in `discord-commands.ts`: `/request`; also clears commands left by an earlier build)
- Failure: error log `Failed to start the Discord bot`, client destroyed, status `failed` + short reason (tab shows it); never throws
- `stop()` destroys the client; `restart()` = stop + start. A generation counter discards a start superseded by a later stop/restart; a start also destroys any client an earlier start left (one gateway session per token)
- Listeners: `error`, `shardError` (warn logs); `interactionCreate` → router (ignored once a later start/stop superseded the client)
- Gateway closed for good (`shardDisconnect`: discord.js emits it only for unrecoverable close codes, e.g. 4004 token reset; no `invalidated` listener, 14.28.1 never emits it): error log `Discord gateway closed for good; save the settings to try again`, status `failed` (`Gateway closed (code N)`), running flag off, client destroyed. No automatic retry, also not for a failed start at boot: an admin's Save restarts it
- Shutdown: the coordinator peeks `processSingleton('discord-bot')` (`DISCORD_BOT_SINGLETON_KEY`, `src/lib/constants/shutdown.ts`) and calls its `stop()` alongside the drain, limit 0.4 s, errors swallowed; it never creates the state or loads discord.js ([unified.md](../deployment/unified.md#shutdown-sequence))
- State on `globalThis` (`processSingleton('discord-bot')`): one client per process
- Intents: `Guilds` only (no privileged intents); roles will come from `interaction.member`

## Router (`discord-interaction-router.ts`)
- Everything only from the configured server; from a DM only buttons and select menus (`isButton()` / `isAnySelectMenu()`): slash and context-menu commands, autocomplete and modals from a DM are dropped
- Never from another server
- Slash commands by name; modals, buttons and select menus by custom_id prefix (`rmab:req:` → `/request` steps, `rmab:apr:` → Approve / Deny). Handler modules load on first use (`import()`), so a bot that is off never loads them; no Discord module imports a discord.js value (replies are raw API JSON, `discord-format.ts`)
- No authority here: handlers resolve the actor on every interaction (`resolveDiscordActor`)

## /request
`/request type:<audiobook|ebook> [query]` (server only; `request/discord-request-handlers.ts`). All replies ephemeral.
| Step | Discord | Does |
|---|---|---|
| Command, no query | first reply = search form | access check (DB only), then `showModal` (a form must be the first reply, so no defer here) |
| Command with query / form submit | `deferReply` | access check, `getAudibleService().search(query, 1)` (language filter applies), results menu (≤ 25, one per ASIN). No results → "No books found…" (also what an Audible outage shows: the search returns no results on error); all hidden by the filter → says so |
| Menu pick | `deferUpdate` | access check, `getAudiobookDetails(asin)`, book embed + Request / Cancel |
| Request | `update` ("Requesting…", buttons removed, embed kept) | in-flight guard, access check (role again), then audiobook: `getAudiobookDetails(asin, {fillSeries: false})` + `createRequestForUser(actor.userId, {asin,title,author,narrator,description,coverArtUrl}, {bypassIgnore: true})` (as `POST /api/requests`); ebook: `createEbookRequestForUser(actor.userId, asin)` ([ebook-sidecar.md](ebook-sidecar.md)). Result text, embed kept. A request created here → `announceDiscordRequest(id)` after the reply, also when the reply fails (`finally`) ([cards](#request-cards)) |
| Cancel | `update` ("Cancelling…", buttons removed) | access check, "Cancelled. Nothing was requested." |
- **In-flight guard** (Request): a process-local set keyed `discordUserId:type:asin`, released in `finally`. A second press while the first is still running (a double click lands before the buttons go) → new ephemeral reply "Already working on that request. One moment.", no access read, no creator call (the creators check then create, not atomic)
- **Access** (`request/discord-request-access.ts`, every step): `resolveDiscordActor(interaction.user.id)` and `loadRequesterRoleId()` read together (`Promise.all`); either read failing → the step's generic error, refused. Unlinked, pending, rejected, deleted → "not linked… ask an RMAB admin"; then the requester role from `interaction.member` (raw `roles[]` or cached `roles.cache`). Role ID = server ID (@everyone) → any member passes. Role set and no member → refused. Admin (DB role) skips the role check
- **Replies:** fixed texts picked from result codes (`request/discord-request-replies.ts`); never a service `message`/`error` (the ebook creator's 500 body holds the raw error). Errors → logged, "Something went wrong. Try again in a moment."
- **Embed** (`discord-book-embed.ts`): title, author, narrator, series, https cover, footer type. Book text markdown-escaped (`escapeMarkdown`; book text can contain markdown) and cut to Discord limits (`clip` cuts between code points, never inside a surrogate pair). Menu text is plain (not rendered as markdown). Every reply sends `allowedMentions: { parse: [] }`
- **Custom ids** (`discord-custom-id.ts`): `rmab:req:<modal|pick|ok|no>:<a|e>[:<ASIN>]:<nonce>`; ASIN only on `ok`, `[A-Z0-9]{10}`; nonce 10 × `[a-z0-9]`. Anything else, or > 100 chars → ignored (no defer, no read). Never carries who may act
- **DMs:** commands and forms from a DM are dropped by the router; a `/request` button or menu used from a DM is ignored by the handler (no member to check)

## Request cards
Modules under `src/lib/services/discord/cards/`; run only inside the bot (through the facade).
- **Posted** (`announceRequest`, after a `/request` creates a request): card mode `dm` → requester's DMs (`/users/@me/channels`), `public` → request channel, `both` → both; plus, while `awaiting_approval` and an admin channel is set, the **approval message** there (embed + Approve / Deny); no admin channel → no approval message (admins approve on the web). Requests made on the web get no cards and no approval message. Posted only here: a request that returns to `awaiting_approval` later (select-torrent / select-ebook) gets no new approval message
- **Decision while posting:** if the status moved off `awaiting_approval` while the cards were being posted (the decision sync found no cards yet), the announcement reads the decision from the row (as a refresh does) and runs the decision sync (approval message shows it, requester DM)
- **Stored:** `Request.discordCards` = `[{kind: 'public'|'dm'|'approval', channelId, messageId}]` (snowflakes checked on read; anything else ignored). Written only while the bot runs; `[]` when nothing could be posted (still marks the request as made in Discord). NULL = made on the web
- **Refreshed** (`refreshRequestCards`): every card edited to the current status label. The approval message stays as it is while the request waits; once it does not (decided, completed by a library match, removed) it loses its buttons, shows "Approved." / "Denied." / "No longer waiting for approval." / "This request was removed.", and is dropped from the list after a successful edit (a failed edit is tried again on the next refresh). A refresh without a decision (e.g. the `request_approved` notification's, which can run before the decision sync) reads it from the row: `denied` → Denied; moved on with `approvalBypassedBy` NULL → Approved; removed, cancelled or completed by a library match (record set) → no decision. A card Discord reports as deleted (error 10008 Unknown Message) is dropped from the list
- **Hooks** (all through the facade, never awaited): approve / deny (web or Discord) → `syncDiscordApprovalDecision`; `send-notification` job → `refreshDiscordRequestCards(requestId)` after the send (approved, available, error and the other request events); `organize-files` → at `downloaded` (audiobooks). Each refresh = one narrow read; no cards → no Discord call
- **Content:** cover, title, author, narrator, type and a status label only (`CARD_SELECT`: never the release pick, URLs, paths or error text). Database text markdown-escaped. Every send and edit sets `allowed_mentions` (raw REST calls do not get the client default): `{parse: []}`, plus `roles: [adminRoleId]` on the approval message only when an admin role is set (content `<@&role> A request needs approval.`)
- Each post / edit is tried on its own: a Discord failure (DMs closed, message deleted) is logged and never stops the others or the caller

## Approval from Discord
- Buttons `rmab:apr:<a|d>:<request UUID>:<nonce>` (`discord-custom-id.ts`; lowercase UUID, nonce 10 × `[a-z0-9]`; anything else, or a click from a DM → ignored, no defer, no read)
- Handler (`approval/discord-approval-handler.ts`): `deferReply` (ephemeral) → `resolveDiscordActor` **on every click** → not linked (or pending, rejected, deleted) → refused; database role not admin → "Only RMAB admins can approve or deny requests." Holding the Discord admin role grants nothing (it is only pinged) → `decideRequestApproval({…, via: 'discord'})` as the linked admin ([request-approval.md](../admin-features/request-approval.md#post-apiadminrequestsidapprove))
- Replies: fixed texts from the result fields ("Approved. The search has started." / "Approved. The download has started." / "Approved. It will be searched on its release date." / "Denied." …), never a service message or error. Stale click (`invalid_status`) → "This request is no longer waiting for approval. Status: <label>." and the cards are refreshed; removed request → "This request no longer exists."
- **Decision sync** (`cards/discord-decision-sync.ts`, after any approve or deny): refresh with the decision, then a DM to the requester ("Your audiobook request for **Title** was approved." / "…denied.") when the request was made in Discord (`discordCards` not NULL) and the account is still linked. Never throws

## Running-check facade (`discord-runtime.ts`)
- The only Discord module core code imports: `isDiscordBotRunning()`, `syncDiscord(label, work)` (bot off → no import, nothing runs; on → runs in the background, never throws or blocks), `startDiscordBotInBackground()`, and the card hooks `syncDiscordApprovalDecision(id, decision)`, `refreshDiscordRequestCards(id)` (no id → nothing), `announceDiscordRequest(id)` (each = `syncDiscord` + lazy import of the card module)
- `tests/discord/zero-footprint.test.ts` walks the import graphs (static, `import()`, `require()`, plain template-literal imports) of approve and the approval service (`request-approval.service`, `-start`, `-selection`), the `send-notification` and `organize-files` processors, PATCH/cancel request, admin request delete, `request-delete.service`, `request-cancel.service`, app init, the shutdown coordinator, `POST /api/requests`, `request-creator.service`, fetch-ebook and `ebook-request-creator.service`: only `discord-runtime`/`discord-actor`/`discord-snowflake` may appear, never discord.js. It also checks that no file under `src/lib/services/discord/` imports, re-exports or `require()`s a discord.js value (type-only imports and lazy `import()` are fine)

## API (admin session; not on the API-token allowlist)
| Route | Does |
|---|---|
| `GET /api/admin/settings/discord` | `{ settings: {enabled, botToken (mask or ''), guildId, requestChannelId, adminRoleId, adminNotifyChannelId, requesterRoleId, requestCardMode}, isConfigured, status: {state: stopped\|starting\|running\|failed, botTag?, lastError?} }`. Reads RMAB only |
| `PUT /api/admin/settings/discord` | Body = the seven fields (`requesterRoleId` optional: omitted keeps the saved role, so a six-field body from an older client still saves; `''` = no role gate) + optional `requestCardMode` (`dm`/`public`/`both`, else 400 `Request cards must be DM, channel or both`; omitted keeps the saved mode) + optional `clearBotToken` (64 KiB limit). Mask or `''` keeps the saved token; a new value replaces it, even with `clearBotToken` (leading `Bot `/`Bearer ` dropped); only `clearBotToken: true` with `''` or the mask removes it (a blank form can't erase it). Enabling needs a token and a server ID (400). IDs not snowflakes → 400. `setManyAtomic` (one transaction), then `stop()` awaited and `start()` fire-and-forget; answers without waiting for Discord |
| `POST /api/admin/settings/test-discord` | Body: token (typed, or mask/empty = saved) + IDs (validated, 400 before any call). Returns `{ bot: {id, username}, inviteUrl, guilds[], guild \| null, names{}, warnings[] }`. 400 `Discord rejected the bot token`; 429 `Discord is rate limiting this bot; try again in a minute`; 502 `Could not reach Discord` (fixed texts). Typed token: leading `Bot `/`Bearer ` dropped |
- REST check (`discord-rest.ts`): discord.js loaded on call; `REST` v10, 10 s timeout, no retries, `rejectOnRateLimit: () => true` (else the library waits out any 429 and retries without limit), `hashSweepInterval: 0`, `handlerSweepInterval: 0` (no timers keeping the client alive); paths only from `Routes.*`; host fixed (discord.com)
- Server lookup: named from the bot's server list when it is there, else `GET /guilds/{id}`; 403/404 → `The bot is not in this server yet…`, other failures → `Could not check the server. Try again in a moment.`
- IDs: one check for server, tab and Users page (`discord-snowflake.ts`, no server imports)
- Invite URL: `https://discord.com/oauth2/authorize?client_id=<bot>&scope=bot applications.commands&permissions=84992[&guild_id=]`. 84992 = View Channels, Send Messages, Embed Links, Read Message History; never Administrator

## UI
- Settings → Discord tab (`tabs/DiscordTab/`): enable switch, token, five IDs (server, request channel, admin role, requester role, admin channel), "Request cards" select (The requester's DMs / The request channel / Both; saved with the other fields), status pill, Test, invite link, Save. The admin channel hint: with none set, no approval message is posted and admins approve on the web. Load = one GET to RMAB; Discord only on Test ([settings-pages.md](../settings-pages.md))
- Failed load (non-OK or network error): error + Retry, no form (Test and Save unavailable until a load works). Emptying a saved token sends `clearBotToken: true`. After a Save with the bot enabled: up to 5 status GETs, 1 s apart, stopping at `running`/`failed`. Editing an ID or the token clears the last Test result
- Users page: Discord user ID field + `Discord: <id>` line, only when `isConfigured` ([admin-dashboard.md](../admin-dashboard.md))

## Build
- `package.json`: `discord.js` exact `14.28.1` (no caret). `next.config.ts`: `serverExternalPackages` includes `discord.js`; client alias `discord.js: false`. The standalone trace ships it (checked with `node -e "import('discord.js')"` in the image)

## Downgrade
- An older image ignores the `discord.*` keys (bot gone). Disable first to stop the bot: Settings → Discord → off → Save

## Related: [auth.md](../backend/services/auth.md#discord-identity-link), [settings-pages.md](../settings-pages.md), [scheduler.md](../backend/services/scheduler.md), [admin-dashboard.md](../admin-dashboard.md)
