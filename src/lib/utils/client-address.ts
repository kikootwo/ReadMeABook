/**
 * Component: Client Address Key
 * Documentation: documentation/backend/services/auth.md
 *
 * Turns X-Forwarded-For into a rate-limit key. Proxies append to the header, so the
 * entries nearest the right were written by the proxies in front of the app. The walk
 * starts at the right and returns the first public address; with none, the rightmost
 * valid one; with nothing valid, "none". IPv6 addresses are keyed by their /64.
 */

import net from 'net';

const MAX_HEADER_CHARS = 1024;
const MAX_ENTRIES = 16;
const MAX_ENTRY_CHARS = 64;

export const NO_CLIENT_ADDRESS = 'none';

type Parsed = { key: string; isPublic: boolean };

const BRACKETED_V6 = /^\[([^\]]+)\](?::\d{1,5})?$/;
const V4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;

function v4Octets(address: string): number[] {
  return address.split('.').map(Number);
}

function isPublicV4(address: string): boolean {
  const [a, b] = v4Octets(address);
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  return true;
}

/** Eight hextets of an address that net.isIP already accepted as IPv6. */
function v6Hextets(address: string): number[] {
  let text = address.toLowerCase();
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const [a, b, c, d] = v4Octets(tail);
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = rest === undefined ? [] : rest ? rest.split(':') : [];
  const zeros = rest === undefined ? [] : new Array(8 - left.length - right.length).fill('0');
  return [...left, ...zeros, ...right].map((part) => parseInt(part, 16));
}

function parseV6(address: string): Parsed {
  const h = v6Hextets(address);
  // ::ffff:a.b.c.d (IPv4-mapped) is an IPv4 client
  if (h.slice(0, 5).every((part) => part === 0) && h[5] === 0xffff) {
    const v4 = `${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`;
    return { key: `4:${v4}`, isPublic: isPublicV4(v4) };
  }
  const unspecifiedOrLoopback = h.slice(0, 7).every((part) => part === 0) && h[7] <= 1;
  const linkLocal = (h[0] & 0xffc0) === 0xfe80;
  const uniqueLocal = (h[0] & 0xfe00) === 0xfc00;
  return {
    key: `6:${h.slice(0, 4).map((part) => part.toString(16)).join(':')}::/64`,
    isPublic: !(unspecifiedOrLoopback || linkLocal || uniqueLocal),
  };
}

/** One header entry → key, or null when it is not a usable address. */
function parseEntry(raw: string): Parsed | null {
  const entry = raw.trim();
  // Length is checked before any parsing; zone IDs are never accepted
  if (entry.length === 0 || entry.length > MAX_ENTRY_CHARS || entry.includes('%')) return null;

  let host = entry;
  const bracketed = BRACKETED_V6.exec(entry);
  if (bracketed) {
    host = bracketed[1];
    if (net.isIP(host) !== 6) return null;
  } else {
    const withPort = V4_WITH_PORT.exec(entry);
    if (withPort) host = withPort[1];
  }

  const family = net.isIP(host);
  if (family === 4) return { key: `4:${host}`, isPublic: isPublicV4(host) };
  if (family === 6) return parseV6(host);
  return null;
}

/** Rate-limit key for the client that sent this request. */
export function clientAddressKey(headers: Pick<Headers, 'get'>): string {
  const header = headers.get('x-forwarded-for');
  if (!header) return NO_CLIENT_ADDRESS;

  const truncated = header.length > MAX_HEADER_CHARS;
  const entries = header.slice(-MAX_HEADER_CHARS).split(',');
  // A cut-off first entry is only part of an address
  if (truncated) entries.shift();

  let fallback: string | null = null;
  for (let i = entries.length - 1, seen = 0; i >= 0 && seen < MAX_ENTRIES; i -= 1, seen += 1) {
    const parsed = parseEntry(entries[i]);
    if (!parsed) continue;
    if (parsed.isPublic) return parsed.key;
    fallback ??= parsed.key;
  }
  return fallback ?? NO_CLIENT_ADDRESS;
}
