/**
 * Component: Credential Recovery Script
 * Documentation: documentation/admin-features/credential-recovery.md
 *
 * Interactive recovery for lost CONFIG_ENCRYPTION_KEY or forgotten local admin password.
 * Run inside the container with: docker exec -it <container> npm run rmab:recover
 *
 * Hard rules:
 * - No CLI arguments accepted. All input via interactive prompts.
 * - Never log password or key values.
 * - All DB mutations inside a single transaction.
 * - File writes happen only after DB commit succeeds.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { createPrompter, CANCELLED } = require('./lib/terminal-prompt');
const { listPasswordUsers, describePasswordUser, findPasswordUser } = require('./lib/password-users');
const { terminalProblem, installExitHandlers, passwordResetData } = require('./lib/recovery-process');

const SECRETS_FILE = '/app/config/.secrets';
const ENVIRONMENT_FILE = '/etc/environment';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const KEY_LENGTH = 32;
const ENCRYPTED_CONFIG_KEYS_FOR_PROBE = [
  'plex_token',
  'prowlarr_api_key',
  'audiobookshelf.api_token',
  'oidc.client_secret',
];

// ---------------------------------------------------------------------------
// Env loading
// ---------------------------------------------------------------------------
// docker exec doesn't inherit runtime-generated env vars, and /etc/environment
// can drift from what the running app process is actually using (e.g. if
// .secrets was regenerated on a restart while the existing pg_user kept its
// original password). The source of truth is the live node process's
// /proc/<pid>/environ — read that first, then fall back to files.
// ---------------------------------------------------------------------------

const WANTED_ENV_KEYS = [
  'DATABASE_URL',
  'CONFIG_ENCRYPTION_KEY',
  'POSTGRES_PASSWORD',
  'POSTGRES_USER',
  'POSTGRES_DB',
  'ALLOW_WEAK_PASSWORD',
];

const envSource = {}; // key -> short label of where it came from

// The dockerfile's builder stage sets ENV DATABASE_URL=<this> so prisma generate
// and next build have a valid URL; the runtime image no longer carries it, but
// images built before the multi-stage split (1.2.x) baked it into the image env,
// where a docker exec child could still see it. Never trust it.
const DUMMY_DB_URL = 'postgresql://dummy:dummy@localhost:5432/dummy?schema=public';

function isUsableValue(key, value) {
  if (value == null || value === '') return false;
  if (key === 'DATABASE_URL' && value === DUMMY_DB_URL) return false;
  if (key === 'DATABASE_URL' && /^postgresql:\/\/dummy:dummy@/.test(value)) return false;
  return true;
}

function setIfMissing(key, value, sourceLabel) {
  if (!isUsableValue(key, value)) return;
  if (!isUsableValue(key, process.env[key])) {
    process.env[key] = value;
    envSource[key] = sourceLabel;
  }
}

// Wipe inherited dummy URL up front so file/proc sources have a clean slate.
if (process.env.DATABASE_URL && !isUsableValue('DATABASE_URL', process.env.DATABASE_URL)) {
  delete process.env.DATABASE_URL;
}

function loadEnvFromFile(filePath, sourceLabel) {
  if (!fs.existsSync(filePath)) return;
  let contents;
  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch (_err) {
    return;
  }
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    setIfMissing(key, value, sourceLabel);
  }
}

function loadEnvFromRunningProcess() {
  // Walk every readable /proc/<pid>/environ. Pick the first process whose
  // environ contains a non-empty DATABASE_URL. Do NOT filter by comm name —
  // the app may run under gosu, npm, next-server, etc.
  let procDir;
  try {
    procDir = fs.readdirSync('/proc');
  } catch (_err) {
    return null;
  }
  const ownPid = String(process.pid);
  for (const entry of procDir) {
    if (!/^\d+$/.test(entry)) continue;
    if (entry === ownPid) continue;
    let environBuf;
    try {
      environBuf = fs.readFileSync(`/proc/${entry}/environ`);
    } catch (_err) {
      // environ may be mode 400 owned by another user; skip silently.
      continue;
    }
    if (!environBuf || environBuf.length === 0) continue;
    const pairs = environBuf.toString('utf8').split('\u0000');
    const collected = {};
    for (const p of pairs) {
      const eq = p.indexOf('=');
      if (eq === -1) continue;
      collected[p.slice(0, eq)] = p.slice(eq + 1);
    }
    if (!collected.DATABASE_URL) continue;
    let comm = '';
    try {
      comm = fs.readFileSync(`/proc/${entry}/comm`, 'utf8').trim();
    } catch (_e) {}
    const label = `pid ${entry}${comm ? ` (${comm})` : ''}`;
    for (const k of WANTED_ENV_KEYS) {
      if (collected[k]) setIfMissing(k, collected[k], label);
    }
    return label;
  }
  return null;
}

// Priority order: /etc/environment (entrypoint's persisted authoritative state)
// > /app/config/.secrets (persisted keys) > /proc/<pid>/environ (running process).
// The inherited docker-exec env was already wiped of the dummy URL above.
loadEnvFromFile(ENVIRONMENT_FILE, '/etc/environment');
loadEnvFromFile(SECRETS_FILE, '/app/config/.secrets');
const liveProcPid = loadEnvFromRunningProcess();

// Last resort: construct DATABASE_URL from POSTGRES_PASSWORD + sensible defaults,
// mirroring what entrypoint.sh does. Works as long as POSTGRES_PASSWORD was
// recoverable from .secrets or another source.
function urlEncodePassword(s) {
  // Match entrypoint.sh urlencode(): everything except [-_.~a-zA-Z0-9] is %xx.
  return Array.from(s).map((c) => {
    if (/[-_.~a-zA-Z0-9]/.test(c)) return c;
    return '%' + c.charCodeAt(0).toString(16).padStart(2, '0');
  }).join('');
}
if (!isUsableValue('DATABASE_URL', process.env.DATABASE_URL) && process.env.POSTGRES_PASSWORD) {
  const user = process.env.POSTGRES_USER || 'readmeabook';
  const db = process.env.POSTGRES_DB || 'readmeabook';
  const host = '127.0.0.1';
  const port = '5432';
  const encoded = urlEncodePassword(process.env.POSTGRES_PASSWORD);
  process.env.DATABASE_URL = `postgresql://${user}:${encoded}@${host}:${port}/${db}`;
  envSource.DATABASE_URL = 'constructed from POSTGRES_PASSWORD + defaults';
}

// ---------------------------------------------------------------------------
// Encryption helpers (mirrors src/lib/services/encryption.service.ts)
// ---------------------------------------------------------------------------
function deriveKey(rawKey) {
  if (!rawKey) {
    throw new Error('CONFIG_ENCRYPTION_KEY is not set');
  }
  if (rawKey.length < KEY_LENGTH) {
    const buf = Buffer.alloc(KEY_LENGTH);
    Buffer.from(rawKey).copy(buf);
    return buf;
  }
  if (rawKey.length > KEY_LENGTH) {
    return Buffer.from(rawKey).subarray(0, KEY_LENGTH);
  }
  return Buffer.from(rawKey);
}

function decryptWithKey(encryptedData, keyBuffer) {
  const parts = String(encryptedData || '').split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted data format');
  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(parts[2], 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function encryptWithKey(plaintext, keyBuffer) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

function tryDecrypt(encryptedData, keyBuffer) {
  try {
    return { ok: true, value: decryptWithKey(encryptedData, keyBuffer) };
  } catch (err) {
    return { ok: false, error: err };
  }
}

function generateNewKey() {
  return crypto.randomBytes(KEY_LENGTH).toString('base64');
}

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------
// Prompts live in ./lib/terminal-prompt.js (no readline left attached while a password is typed)
const prompter = createPrompter();

// Never leave the terminal in raw mode, whatever ends the process; hold() defers exit
// signals while a full recovery commits and writes the new key
const exitControl = installExitHandlers({ prompter });

// ---------------------------------------------------------------------------
// .secrets / /etc/environment file updates
// ---------------------------------------------------------------------------
function updateKeyInFile(filePath, keyName, newValue, quoted) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(
      filePath,
      `${keyName}=${quoted ? `"${newValue}"` : newValue}\n`,
      { mode: 0o600 }
    );
    return { created: true, replaced: false };
  }
  const original = fs.readFileSync(filePath, 'utf8');
  const lines = original.split('\n');
  let replaced = false;
  const updated = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return line;
    const name = trimmed.slice(0, eq).trim();
    if (name !== keyName) return line;
    replaced = true;
    return `${keyName}=${quoted ? `"${newValue}"` : newValue}`;
  });
  if (!replaced) {
    if (updated[updated.length - 1] === '') {
      updated[updated.length - 1] = `${keyName}=${quoted ? `"${newValue}"` : newValue}`;
      updated.push('');
    } else {
      updated.push(`${keyName}=${quoted ? `"${newValue}"` : newValue}`);
    }
  }
  fs.writeFileSync(filePath, updated.join('\n'));
  return { created: false, replaced };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // No CLI args, and interactive only: without a terminal the password prompt cannot hide input
  const problem = terminalProblem({ argv: process.argv, stdin: process.stdin, stdout: process.stdout });
  if (problem) {
    for (const line of problem) console.error(line);
    process.exit(2);
  }

  console.log('');
  console.log('================================================================');
  console.log('  ReadMeABook — Credential Recovery');
  console.log('================================================================');
  console.log('');
  console.log('Use when local login fails with "Invalid username or password"');
  console.log('despite known-correct credentials. See:');
  console.log('  documentation/admin-features/credential-recovery.md');
  console.log('');

  // Diagnostic: where did we resolve env vars from?
  const dbSrc = envSource.DATABASE_URL || (process.env.DATABASE_URL ? 'inherited' : 'NOT FOUND');
  const keySrc = envSource.CONFIG_ENCRYPTION_KEY || (process.env.CONFIG_ENCRYPTION_KEY ? 'inherited' : 'NOT FOUND');
  console.log('Environment:');
  console.log(`  Live process w/ DATABASE_URL: ${liveProcPid || 'none found'}`);
  console.log(`  DATABASE_URL source:        ${dbSrc}`);
  console.log(`  CONFIG_ENCRYPTION_KEY src:  ${keySrc}`);
  if (process.env.DATABASE_URL) {
    const redacted = String(process.env.DATABASE_URL).replace(/(:\/\/[^:]+:)[^@]+(@)/, '$1***$2');
    console.log(`  DATABASE_URL (redacted):    ${redacted}`);
  }
  console.log('');

  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is not set and could not be loaded from any source.');
    console.error('       Tried: /proc/<pid>/environ of running node process,');
    console.error('              /etc/environment, /app/config/.secrets');
    console.error('       Workaround: docker exec -it -e DATABASE_URL="<your url>" <container> npm run rmab:recover');
    process.exit(1);
  }
  if (!process.env.CONFIG_ENCRYPTION_KEY) {
    console.error('ERROR: CONFIG_ENCRYPTION_KEY is not set and could not be loaded from any source.');
    console.error('       Tried: /proc/<pid>/environ of running node process,');
    console.error('              /etc/environment, /app/config/.secrets');
    process.exit(1);
  }

  const currentKey = deriveKey(process.env.CONFIG_ENCRYPTION_KEY);

  // Load Prisma client (generated in container at src/generated/prisma)
  let PrismaClient;
  try {
    ({ PrismaClient } = require(path.join(__dirname, '..', 'src', 'generated', 'prisma', 'client')));
  } catch (err) {
    try {
      ({ PrismaClient } = require('@prisma/client'));
    } catch (innerErr) {
      console.error('ERROR: Could not load Prisma client. Tried generated path and @prisma/client.');
      console.error('       Generated path error:', err.message);
      console.error('       Package error:       ', innerErr.message);
      process.exit(1);
    }
  }
  const prisma = new PrismaClient();
  let releaseSignals = () => {};

  try {
    // -------------------------------------------------------------------------
    // Diagnose key health
    // -------------------------------------------------------------------------
    console.log('Step 1/5 — Diagnosing encryption key health...');
    const encryptedRows = await prisma.configuration.findMany({
      where: { encrypted: true },
    });

    let keyWorks = null; // null = unknown (no probe rows)
    let probedKey = null;
    for (const row of encryptedRows) {
      if (!row.value) continue;
      const result = tryDecrypt(row.value, currentKey);
      if (result.ok) {
        keyWorks = true;
        probedKey = row.key;
        break;
      }
      if (keyWorks === null) keyWorks = false;
    }

    if (keyWorks === true) {
      console.log(`  Key works (verified against Configuration row "${probedKey}").`);
    } else if (keyWorks === false) {
      console.log(`  Key DOES NOT work — none of the ${encryptedRows.length} encrypted Configuration rows decrypt.`);
    } else {
      console.log('  No encrypted Configuration rows exist yet — defaulting to password-reset-only mode.');
    }

    // -------------------------------------------------------------------------
    // List users who log in with a password (local users and the Plex-mode admin)
    // -------------------------------------------------------------------------
    console.log('');
    console.log('Step 2/5 — Selecting the user to reset...');
    const passwordUsers = await listPasswordUsers(prisma);

    if (passwordUsers.length === 0) {
      console.error('');
      console.error('ERROR: No user in the database logs in with a username and password.');
      console.error('       Plex and OIDC users sign in through their provider and have no password to reset.');
      console.error('       Use the setup wizard / registration page to create a local user instead.');
      process.exit(1);
    }

    console.log('');
    console.log('  Users with a password login:');
    for (const u of passwordUsers) {
      console.log(`    - ${describePasswordUser(u)}`);
    }
    console.log('');

    let chosenUser = null;
    while (!chosenUser) {
      const typed = (await prompter.ask('  Username to reset: ')).trim().toLowerCase();
      if (!typed) continue;
      chosenUser = findPasswordUser(passwordUsers, typed);
      if (!chosenUser) {
        console.log(`  No password-login user named "${typed}". Try again, or Ctrl+C to abort.`);
      }
    }

    // -------------------------------------------------------------------------
    // New password
    // -------------------------------------------------------------------------
    console.log('');
    console.log('Step 3/5 — New password...');
    const allowWeak = process.env.ALLOW_WEAK_PASSWORD === 'true';
    const minLen = allowWeak ? 1 : 8;

    let newPassword = null;
    while (!newPassword) {
      const a = await prompter.askHidden('  New password: ');
      const b = await prompter.askHidden('  Confirm new password: ');
      if (a !== b) {
        console.log('  Passwords did not match. Try again.');
        continue;
      }
      if (a.length < minLen) {
        console.log(`  Password must be at least ${minLen} character(s). Try again.`);
        continue;
      }
      newPassword = a;
    }

    // -------------------------------------------------------------------------
    // Build the plan
    // -------------------------------------------------------------------------
    console.log('');
    console.log('Step 4/5 — Plan...');
    console.log('');

    const fullRecovery = keyWorks === false;

    if (fullRecovery) {
      console.log('  MODE: FULL RECOVERY (encryption key is unrecoverable)');
      console.log('');
      console.log('  The following will happen, atomically:');
      console.log(`    1. A new CONFIG_ENCRYPTION_KEY will be generated.`);
      console.log(`    2. User "${chosenUser.plexUsername}" will get a new password (bcrypt + new key).`);
      console.log('    3. Every Configuration row with encrypted=true will be tried with the OLD key:');
      console.log('         - If it decrypts: re-encrypted with the new key (preserved).');
      console.log('         - If it cannot decrypt: DELETED (must be re-entered in Settings).');
      console.log('    4. download_clients JSON: each per-client password tried with OLD key:');
      console.log('         - Decryptable: re-encrypted with new key.');
      console.log('         - Not decryptable: blanked. URL, host, name, etc. preserved.');
      console.log('    5. User.authToken for every user tried with OLD key:');
      console.log('         - Decryptable: re-encrypted with new key.');
      console.log('         - Not decryptable: cleared. Plex/OIDC users re-OAuth on next login.');
      console.log('    6. /app/config/.secrets and /etc/environment updated with the new key.');
      console.log('');
      console.log('  Likely to need re-entering in Settings after this completes:');
      console.log('    - Plex auth token (or just re-login with Plex)');
      console.log('    - Audiobookshelf API token (if used)');
      console.log('    - Prowlarr API key');
      console.log('    - OIDC client secret (if used)');
      console.log('    - Download client passwords (per client)');
      console.log('    - Any AI / Hardcover / Goodreads / notification provider secrets');
      console.log('');
      console.log('  Survives untouched:');
      console.log('    - All requests + request history');
      console.log('    - Library mappings, organization templates, schedules');
      console.log('    - User accounts (just credentials cleared)');
      console.log('    - Non-encrypted config (paths, log level, backend mode, etc.)');
      console.log('');
      console.log('  Container restart REQUIRED after this completes.');
    } else {
      console.log('  MODE: PASSWORD RESET ONLY (encryption key is healthy)');
      console.log('');
      console.log(`  Only one change: user "${chosenUser.plexUsername}" gets a new password.`);
      console.log('  Everything else (all credentials, all settings) untouched.');
      console.log('  No container restart needed.');
    }

    console.log('');
    const confirm = (await prompter.ask("  Type 'confirm' to proceed (anything else aborts): ")).trim();
    if (confirm !== 'confirm') {
      console.log('  Aborted. No changes made.');
      await prisma.$disconnect();
      process.exit(0);
    }

    // -------------------------------------------------------------------------
    // Execute
    // -------------------------------------------------------------------------
    console.log('');
    console.log('Step 5/5 — Applying changes...');

    let summary;
    let newKeyBase64 = null;
    let newKeyBuffer = currentKey;

    if (fullRecovery) {
      // From here until the new key is on disk (or printed), exit signals wait
      releaseSignals = exitControl.hold();
      newKeyBase64 = generateNewKey();
      newKeyBuffer = deriveKey(newKeyBase64);

      // Plan mutations in memory using OLD key for reads, NEW key for writes.
      const configUpdates = [];
      const configDeletes = [];
      let downloadClientsUpdate = null;
      const userUpdates = [];

      // Configuration rows
      for (const row of encryptedRows) {
        if (!row.value) {
          configDeletes.push(row.key);
          continue;
        }
        const decrypted = tryDecrypt(row.value, currentKey);
        if (decrypted.ok) {
          configUpdates.push({ key: row.key, value: encryptWithKey(decrypted.value, newKeyBuffer) });
        } else {
          configDeletes.push(row.key);
        }
      }

      // download_clients JSON (not marked encrypted=true at row level)
      const dcRow = await prisma.configuration.findUnique({ where: { key: 'download_clients' } });
      if (dcRow && dcRow.value) {
        try {
          const clients = JSON.parse(dcRow.value);
          let touched = 0;
          let cleared = 0;
          if (Array.isArray(clients)) {
            for (const client of clients) {
              if (!client || !client.password) continue;
              const decrypted = tryDecrypt(client.password, currentKey);
              if (decrypted.ok) {
                client.password = encryptWithKey(decrypted.value, newKeyBuffer);
                touched++;
              } else {
                client.password = '';
                cleared++;
              }
            }
            downloadClientsUpdate = { value: JSON.stringify(clients), touched, cleared };
          }
        } catch (err) {
          console.log(`  WARNING: download_clients JSON unparseable, leaving as-is: ${err.message}`);
        }
      }

      // User auth tokens (except the chosen user, whose token will be overwritten)
      const allUsers = await prisma.user.findMany({
        where: { deletedAt: null },
        select: { id: true, authToken: true, authProvider: true },
      });
      for (const u of allUsers) {
        if (u.id === chosenUser.id) continue;
        if (!u.authToken) continue;
        const decrypted = tryDecrypt(u.authToken, currentKey);
        if (decrypted.ok) {
          userUpdates.push({ id: u.id, authToken: encryptWithKey(decrypted.value, newKeyBuffer) });
        } else {
          userUpdates.push({ id: u.id, authToken: '' });
        }
      }

      // Chosen user — fresh bcrypt encrypted with new key
      const newHash = await bcrypt.hash(newPassword, 10);
      const encryptedHash = encryptWithKey(newHash, newKeyBuffer);

      // Apply atomically
      summary = await prisma.$transaction(async (tx) => {
        const result = {
          configRotated: configUpdates.length,
          configDeleted: configDeletes.length,
          downloadClients: downloadClientsUpdate
            ? { touched: downloadClientsUpdate.touched, cleared: downloadClientsUpdate.cleared }
            : null,
          usersRotated: 0,
          usersCleared: 0,
        };
        for (const u of configUpdates) {
          await tx.configuration.update({ where: { key: u.key }, data: { value: u.value } });
        }
        for (const key of configDeletes) {
          await tx.configuration.delete({ where: { key } });
        }
        if (downloadClientsUpdate) {
          await tx.configuration.update({
            where: { key: 'download_clients' },
            data: { value: downloadClientsUpdate.value },
          });
        }
        for (const u of userUpdates) {
          await tx.user.update({ where: { id: u.id }, data: { authToken: u.authToken } });
          if (u.authToken === '') result.usersCleared++;
          else result.usersRotated++;
        }
        await tx.user.update({
          where: { id: chosenUser.id },
          data: passwordResetData(encryptedHash),
        });
        return result;
      });
    } else {
      // Simple password reset, current key preserved
      const newHash = await bcrypt.hash(newPassword, 10);
      const encryptedHash = encryptWithKey(newHash, currentKey);
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: chosenUser.id },
          data: passwordResetData(encryptedHash),
        });
      });
      summary = null;
    }

    // -------------------------------------------------------------------------
    // Post-commit: file writes (only on full recovery)
    // -------------------------------------------------------------------------
    let fileWriteFailed = false;
    if (fullRecovery) {
      try {
        updateKeyInFile(SECRETS_FILE, 'CONFIG_ENCRYPTION_KEY', newKeyBase64, true);
      } catch (err) {
        fileWriteFailed = true;
        console.error(`  ERROR writing ${SECRETS_FILE}: ${err.message}`);
      }
      try {
        updateKeyInFile(ENVIRONMENT_FILE, 'CONFIG_ENCRYPTION_KEY', newKeyBase64, false);
      } catch (err) {
        fileWriteFailed = true;
        console.error(`  ERROR writing ${ENVIRONMENT_FILE}: ${err.message}`);
      }
    }

    // -------------------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------------------
    console.log('');
    console.log('================================================================');
    console.log('  Recovery complete.');
    console.log('================================================================');
    console.log('');
    console.log(`  User reset:   ${chosenUser.plexUsername}`);
    console.log('  Existing sessions for this user were signed out.');
    if (fullRecovery && summary) {
      console.log(`  Configuration rows re-encrypted: ${summary.configRotated}`);
      console.log(`  Configuration rows deleted:      ${summary.configDeleted}`);
      if (summary.downloadClients) {
        console.log(`  download_clients passwords re-encrypted: ${summary.downloadClients.touched}`);
        console.log(`  download_clients passwords cleared:      ${summary.downloadClients.cleared}`);
      }
      console.log(`  User tokens re-encrypted: ${summary.usersRotated}`);
      console.log(`  User tokens cleared:      ${summary.usersCleared}`);
      console.log('');

      if (fileWriteFailed) {
        console.log('  ⚠️  Could not persist the new key to .secrets / /etc/environment.');
        console.log('  ⚠️  The new key is printed ONCE below. Write it into /app/config/.secrets:');
        console.log('');
        console.log(`        CONFIG_ENCRYPTION_KEY="${newKeyBase64}"`);
        console.log('');
        console.log('  ⚠️  And into /etc/environment (without quotes):');
        console.log('');
        console.log(`        CONFIG_ENCRYPTION_KEY=${newKeyBase64}`);
        console.log('');
      } else {
        console.log('  New CONFIG_ENCRYPTION_KEY persisted to /app/config/.secrets and /etc/environment.');
      }
      console.log('');
      console.log('  NEXT STEPS:');
      console.log('    1. Restart the container.');
      console.log(`    2. Log in as "${chosenUser.plexUsername}" with the new password.`);
      console.log('    3. Re-enter cleared credentials in Settings (Plex, Prowlarr, etc.).');
    } else {
      console.log('  Encryption key was healthy — only the password was reset.');
      console.log(`  Log in as "${chosenUser.plexUsername}" with the new password. No restart needed.`);
    }
    console.log('');
  } catch (err) {
    if (err && err.code === CANCELLED) {
      console.error('');
      console.error('Cancelled. No changes made.');
      process.exitCode = 130;
      return;
    }
    console.error('');
    console.error('ERROR: Recovery aborted.');
    console.error(`  ${err.message}`);
    console.error('');
    const msg = String(err && err.message ? err.message : '');
    if (
      msg.includes('was denied access') ||
      msg.includes('P1010') ||
      msg.includes('password authentication')
    ) {
      console.error('Diagnosis: Postgres rejected the credentials in DATABASE_URL.');
      console.error('This usually means /etc/environment or .secrets drifted from what the running');
      console.error('app process is actually using (common after a container restart where .secrets');
      console.error('was regenerated but the existing Postgres user kept its original password).');
      console.error('');
      console.error('Try one of:');
      console.error('  1. Restart the container so the entrypoint resyncs all env files, then re-run.');
      console.error('  2. Pass DATABASE_URL explicitly:');
      console.error('       docker exec -it \\');
      console.error("         -e DATABASE_URL=\"$(docker exec <container> cat /proc/1/environ \\");
      console.error("            | tr '\\0' '\\n' | grep ^DATABASE_URL= | cut -d= -f2-)\" \\");
      console.error('         <container> npm run rmab:recover');
    }
    console.error('');
    console.error('No changes have been committed (or the DB transaction was rolled back).');
    process.exitCode = 1;
  } finally {
    try {
      await prisma.$disconnect();
    } catch (_e) {
      // ignore
    }
    releaseSignals(); // exits now if a signal arrived during the held section
  }
}

main();
