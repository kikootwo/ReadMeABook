# Credential Recovery Script

**Status:** ✅ Implemented | Interactive recovery for lost `CONFIG_ENCRYPTION_KEY` or forgotten local admin password

## Overview
Recovers from the "Invalid username or password" failure mode caused by a lost or rotated `CONFIG_ENCRYPTION_KEY`. Detects whether the key still works; either does a minimal password reset (preserves everything) or full recovery (rotates key + clears credentials that can no longer be decrypted).

## When to Use
- Local admin gets "Invalid username or password" with credentials known to be correct
- `/app/config/.secrets` was lost, truncated, or recreated
- After an unintended `CONFIG_ENCRYPTION_KEY` change
- See GitHub issue #200 for the symptom pattern

## How to Run
```
docker exec -it <container-name> npm run rmab:recover
```
- `-it` is required: without a terminal on stdin and stdout the script exits (code 2) before doing anything (`terminalProblem`, `scripts/lib/recovery-process.js`)
- Or directly: `docker exec -it <container-name> node /app/scripts/recover-credentials.js`

## What It Does
1. Loads `DATABASE_URL` and `CONFIG_ENCRYPTION_KEY` from env (falls back to `/etc/environment`)
2. Diagnoses key health by attempting to decrypt an existing encrypted Configuration row
3. Lists users who log in with a password; prompts for one (`scripts/lib/password-users.js`)
   - Rule: not soft-deleted, `authProvider` is `local` or `plex`, and `plexId` is exactly `local-<plexUsername>` (case-insensitive). Password = encrypted bcrypt in `authToken`
   - Covers local users and the Plex-mode setup admin (`authProvider='plex'`, logs in via `/api/auth/admin/login`, which looks up `plexId = local-<username>`); labelled `Plex-mode admin`
   - Never offers Plex users (`authProvider` null; `plexId` is the Plex account id from the callback, or the Home profile uuid from switch-profile, so not always numeric) or OIDC users (incl. a subject starting with `local-`): no password to reset
4. Prompts for new password twice (masked); validates length unless `ALLOW_WEAK_PASSWORD=true`
   - Prompts: `scripts/lib/terminal-prompt.js`. Questions use a short-lived readline closed before returning; the password is read in raw mode with no readline attached, so it is never echoed (one `*` per character). Raw mode is restored on Enter, Ctrl+C/Ctrl+D (exit 130, "Cancelled. No changes made."), SIGTERM/SIGHUP and process exit
5. Prints the exact plan (mode + what will be cleared); requires typing `confirm` verbatim
6. Executes inside a single Prisma `$transaction`
   - Every reset sets `sessionsInvalidatedAt`: the user's existing access and refresh tokens are rejected (`requireAuth`, `/api/auth/refresh`: `iat` before it → 401 "Session has been revoked"); a new login works
7. If key was rotated: writes new key to `/app/config/.secrets` and `/etc/environment`
   - Full recovery holds SIGTERM/SIGHUP/Ctrl+C from before the DB transaction until the new key is on disk or printed (`installExitHandlers().hold()`); a signal in that window exits right after (143/129/130)

## Two Modes (auto-detected)

**Simple Password Reset (key works):**
- Only updates the chosen user's `authToken` (new bcrypt, re-encrypted) and sets `sessionsInvalidatedAt` (`passwordResetData`)
- No other data touched
- No container restart needed

**Full Recovery (key broken):**
- Generates new `CONFIG_ENCRYPTION_KEY` (32 random bytes, base64)
- For each `Configuration` row with `encrypted=true`: re-encrypts with new key if old decrypt succeeds, deletes the row if not
- For `download_clients` JSON: re-encrypts each client password if possible, blanks it if not (URL/host/etc. preserved)
- For all `User.authToken` values: re-encrypts if possible, clears if not (Plex/OIDC users re-OAuth on next login)
- Overwrites target user's `authToken` with fresh bcrypt encrypted with new key and sets `sessionsInvalidatedAt`
- Writes new key to `.secrets` + `/etc/environment`
- **Container restart required after this mode**

## What Survives (Full Recovery Mode)
- All requests + request history
- Library mappings, organization templates, schedules, user accounts
- Non-encrypted Configuration rows (paths, log level, backend mode, etc.)
- Plex/OIDC users whose tokens decrypted successfully (no re-OAuth needed)

## What User Re-enters After Full Recovery
- Plex auth token (or re-OAuth via login)
- Audiobookshelf API token (if used)
- OIDC client secret (if used)
- Prowlarr API key
- Download client passwords (per client)
- Any AI / Hardcover / Goodreads / notification provider secrets

## Security
- CLI only — no HTTP endpoint, no auto-run, no rescue-mode env flag
- Requires `docker exec` access (= host root equivalent)
- Refuses to accept any CLI arguments — all input via interactive prompts
- Does not echo or log password or key values
- Operation summary written to stdout; full audit info to app logger
- Idempotent within a single mode (re-runs are safe)

## Failure Modes
- DB transaction fails → no changes committed, safe to re-run
- DB transaction commits but `.secrets`/`/etc/environment` write fails → script prints the new key in plaintext with instructions for manual write (one-time exposure in operator's terminal)

## Fixed Issues

**Typed password echoed on screen**
- **Cause:** the readline interface for the username prompt stayed open (only paused) while the hidden password prompt put stdin in raw mode; readline's keypress handling still echoed each character
- **Fix:** prompts moved to `scripts/lib/terminal-prompt.js` (no readline alive during the hidden read); tests drive a fake TTY and assert the password never reaches stdout (`tests/scripts/terminal-prompt.test.ts`)

**Plex-mode admin could not be recovered ("No local users exist")**
- **Cause:** the user list queried `authProvider='local'`, but setup stores the Plex-mode admin with `authProvider='plex'` (plexId `local-<username>`, bcrypt in `authToken`)
- **Fix:** list by the password-login rule above (`listPasswordUsers`); a reset also ends the user's existing sessions; tests in `tests/scripts/password-users.test.ts`, `tests/scripts/recovery-process.test.ts`

## Related
- `backend/services/auth.md` — local auth flow + the decrypt-then-compare path
- `backend/services/config.md` — encryption format details
- `deployment/unified.md` — entrypoint behavior and `.secrets` persistence
