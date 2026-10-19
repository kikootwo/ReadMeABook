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
- `-it` is required for the interactive prompts
- Or directly: `docker exec -it <container-name> node /app/scripts/recover-credentials.js`
- Image dependencies (copied explicitly by `dockerfile.unified`, checked by its runtime guard): `/app/scripts/`, `/app/package.json`, `/app/src/generated/prisma/`, `bcrypt` in `/app/node_modules`

## What It Does
1. Loads `DATABASE_URL` and `CONFIG_ENCRYPTION_KEY` from env (falls back to `/etc/environment`)
2. Diagnoses key health by attempting to decrypt an existing encrypted Configuration row
3. Lists local users (`authProvider='local'`, not soft-deleted); prompts for one
4. Prompts for new password twice (masked); validates length unless `ALLOW_WEAK_PASSWORD=true`
5. Prints the exact plan (mode + what will be cleared); requires typing `confirm` verbatim
6. Executes inside a single Prisma `$transaction`
7. If key was rotated: writes new key to `/app/config/.secrets` and `/etc/environment`

## Two Modes (auto-detected)

**Simple Password Reset (key works):**
- Only updates the chosen user's `authToken` (new bcrypt, re-encrypted)
- No other data touched
- No container restart needed

**Full Recovery (key broken):**
- Generates new `CONFIG_ENCRYPTION_KEY` (32 random bytes, base64)
- For each `Configuration` row with `encrypted=true`: re-encrypts with new key if old decrypt succeeds, deletes the row if not
- For `download_clients` JSON: re-encrypts each client password if possible, blanks it if not (URL/host/etc. preserved)
- For all `User.authToken` values: re-encrypts if possible, clears if not (Plex/OIDC users re-OAuth on next login)
- Overwrites target user's `authToken` with fresh bcrypt encrypted with new key
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

## Related
- `backend/services/auth.md` — local auth flow + the decrypt-then-compare path
- `backend/services/config.md` — encryption format details
- `deployment/unified.md` — entrypoint behavior and `.secrets` persistence
