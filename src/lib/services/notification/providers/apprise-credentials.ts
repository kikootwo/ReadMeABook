/**
 * Component: Apprise Server URL Credentials
 * Documentation: documentation/backend/services/notifications.md
 *
 * Basic auth credentials live in their own fields (basicAuthUser, basicAuthPassword —
 * the password is a sensitive, encrypted field), never inside serverUrl. These helpers
 * move `user:pass@` out of a URL: on save (normalizeAppriseConfig), for stored rows
 * (liftAppriseUrlCredentials: startup migration, API display, PUT merge) and on send.
 * Nothing here ever puts a value back into a URL, and errors never include the URL.
 */

import { MASKED_CONFIG_VALUE as MASK } from '../INotificationProvider';

export interface UrlCredentials {
  /** serverUrl with any userinfo removed (path, query and port kept) */
  url: string;
  user: string;
  password: string;
  hadUserinfo: boolean;
}

/**
 * Undo the URL parser's percent-encoding of userinfo. Each run of %XX escapes is decoded
 * on its own, so one stray '%' (e.g. "Ab^c%9", which the parser stores as "Ab%5Ec%9")
 * does not stop the other escapes from decoding. A run that is not valid UTF-8 as a
 * whole (e.g. "^%E2", stored as "%5E%E2") is decoded escape by escape: the longest valid
 * UTF-8 sequence (up to 4 bytes) is taken each time, and an escape that starts no valid
 * sequence is kept as typed.
 */
export function decodeUserinfo(value: string): string {
  return value.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return decodeEscapeRun(run);
    }
  });
}

function decodeEscapeRun(run: string): string {
  const escapes = run.match(/%[0-9a-fA-F]{2}/g) ?? [];
  let out = '';
  let i = 0;
  while (i < escapes.length) {
    let taken = 0;
    for (let len = Math.min(4, escapes.length - i); len > 0 && !taken; len--) {
      try {
        out += decodeURIComponent(escapes.slice(i, i + len).join(''));
        taken = len;
      } catch {
        // not a complete UTF-8 sequence; try a shorter one
      }
    }
    if (!taken) {
      out += escapes[i];
      taken = 1;
    }
    i += taken;
  }
  return out;
}

/**
 * Split userinfo out of an http(s) URL. Null when the value is not an http(s) URL; note
 * that "alice:secret@host" parses as a URL with scheme "alice:", so a non-http(s) parse
 * counts as unparseable (its credentials could not be found and removed).
 */
export function splitUrlCredentials(value: string): UrlCredentials | null {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const hadUserinfo = parsed.username !== '' || parsed.password !== '';
  const user = decodeUserinfo(parsed.username);
  const password = decodeUserinfo(parsed.password);
  parsed.username = '';
  parsed.password = '';
  return { url: hadUserinfo ? parsed.toString() : value.trim(), user, password, hadUserinfo };
}

const isBlank = (value: unknown) => value === undefined || value === null || value === '';

export type AppriseNormalizeResult =
  | { ok: true; config: Record<string, any> }
  | { ok: false; error: string };

/**
 * Normalise a submitted Apprise config (POST, PUT before merging, test route):
 * credentials typed into serverUrl move into the fields and are stripped from the URL.
 * The URL's password fills basicAuthPassword when that field is empty, missing or the
 * mask (and then the URL's username replaces basicAuthUser, so the pair stays together);
 * a non-empty typed password wins, and the username is only filled when blank. A URL
 * that does not parse but contains '@' is refused, since its credentials cannot be
 * removed safely.
 */
export function normalizeAppriseConfig(config: Record<string, any>): AppriseNormalizeResult {
  const serverUrl = typeof config.serverUrl === 'string' ? config.serverUrl : '';
  if (!serverUrl) return { ok: true, config: { ...config } };

  const split = splitUrlCredentials(serverUrl);
  if (!split) {
    if (serverUrl.includes('@')) {
      return {
        ok: false,
        error: 'The Apprise Server URL is not a valid URL. Enter it without credentials (e.g. http://apprise:8000) and put the username and password in the Basic Auth fields.',
      };
    }
    return { ok: true, config: { ...config } };
  }
  if (!split.hadUserinfo) return { ok: true, config: { ...config } };

  const next: Record<string, any> = { ...config, serverUrl: split.url };
  const urlSuppliesPassword = Boolean(split.password) && (isBlank(next.basicAuthPassword) || next.basicAuthPassword === MASK);
  if (urlSuppliesPassword) {
    next.basicAuthPassword = split.password;
    next.basicAuthUser = split.user;
  } else if (isBlank(next.basicAuthUser) && split.user) {
    next.basicAuthUser = split.user;
  }
  return { ok: true, config: next };
}

/**
 * Migrated form of a STORED config whose serverUrl still carries userinfo (legacy rows,
 * or re-entered after a rollback): URL stripped, userinfo wins over existing fields.
 * Returns null when there is nothing to move. `password` is the plaintext password from
 * the URL (never empty); the caller encrypts it, or masks it for display.
 */
export function liftAppriseUrlCredentials(
  config: Record<string, any>,
): { config: Record<string, any>; password: string | null } | null {
  const serverUrl = typeof config.serverUrl === 'string' ? config.serverUrl : '';
  const split = serverUrl ? splitUrlCredentials(serverUrl) : null;
  if (!split || !split.hadUserinfo) return null;

  const next: Record<string, any> = { ...config, serverUrl: split.url };
  if (split.user) next.basicAuthUser = split.user;
  return { config: next, password: split.password || null };
}
