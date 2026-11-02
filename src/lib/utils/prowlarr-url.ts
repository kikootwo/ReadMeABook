/**
 * Component: Prowlarr Download URL Rules (key scoping, validation, log-safe URLs)
 * Documentation: documentation/phase3/download-clients.md
 *
 * Pure helpers. The Prowlarr API key may only travel to the configured
 * Prowlarr origin, and only on its proxy-download path (`/{indexerId}/download`).
 */

import { REDACTED_VALUE } from '@/lib/constants/download-source';

export interface ProwlarrBase {
  /** Configured scheme + host + port */
  origin: string;
  protocol: 'http:' | 'https:';
  /** Lower-case host name without port */
  hostname: string;
  /** Host as configured (with a non-default port) */
  host: string;
  /** Effective port ('80'/'443' when omitted) */
  port: string;
  /** True when the configured URL uses its scheme's default port */
  defaultPort: boolean;
  /** `user:pass@` from the configured URL, or '' */
  userinfo: string;
  /** Configured URL base path without trailing slash ('' when none), original case */
  basePath: string;
}

const DOWNLOAD_PATH_PATTERN = /^\/\d+\/download$/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Parse an http(s) URL; null for anything else. */
export function parseHttpUrl(value: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.origin === 'null') return null;
  return parsed;
}

function effectivePort(url: URL): string {
  return url.port || (url.protocol === 'https:' ? '443' : '80');
}

function userinfoOf(url: URL): string {
  if (!url.username && !url.password) return '';
  return `${url.username}${url.password ? `:${url.password}` : ''}@`;
}

/** `/{indexerId}/download` after the base path (base path compared case-insensitively), or null. */
function downloadSuffix(url: URL, base: ProwlarrBase): string | null {
  const prefix = base.basePath.toLowerCase();
  if (!url.pathname.toLowerCase().startsWith(`${prefix}/`)) return null;
  const rest = url.pathname.slice(prefix.length);
  return DOWNLOAD_PATH_PATTERN.test(rest) ? rest : null;
}

/** Parse the configured Prowlarr URL. Returns null for anything but an http(s) URL. */
export function parseProwlarrBase(baseUrl: string | undefined | null): ProwlarrBase | null {
  if (!baseUrl) return null;
  const parsed = parseHttpUrl(baseUrl);
  if (!parsed) return null;
  return {
    origin: parsed.origin,
    protocol: parsed.protocol as 'http:' | 'https:',
    hostname: parsed.hostname.toLowerCase(),
    host: parsed.host.toLowerCase(),
    port: effectivePort(parsed),
    defaultPort: parsed.port === '',
    userinfo: userinfoOf(parsed),
    basePath: parsed.pathname.replace(/\/+$/, ''),
  };
}

/**
 * Strict check used before attaching the key: exactly the configured scheme,
 * host, port and credentials, on the proxy-download path.
 */
export function isProwlarrDownloadUrl(url: string, base: ProwlarrBase | null): boolean {
  if (!base) return false;
  const parsed = parseHttpUrl(url);
  if (!parsed) return false;
  return (
    parsed.protocol === base.protocol &&
    parsed.hostname.toLowerCase() === base.hostname &&
    effectivePort(parsed) === base.port &&
    userinfoOf(parsed) === base.userinfo &&
    downloadSuffix(parsed, base) !== null
  );
}

/** `/{indexerId}/download` of a link on the configured host and port, under the configured base path, or null. */
function configuredSuffix(parsed: URL, base: ProwlarrBase): string | null {
  if (parsed.hostname.toLowerCase() !== base.hostname) return null;
  const portsMatch = effectivePort(parsed) === base.port || (parsed.port === '' && base.defaultPort);
  return portsMatch ? downloadSuffix(parsed, base) : null;
}

const PROXY_LINK_PATH_PATTERN = /\/(\d+)\/download$/i;

/**
 * `/{indexerId}/download` of a Prowlarr proxy link on any host: the path ends in
 * `/{digits}/download` and the query has a non-empty `link` parameter. Null otherwise.
 */
function proxyLinkSuffix(parsed: URL): string | null {
  const match = PROXY_LINK_PATH_PATTERN.exec(parsed.pathname);
  if (!match || !parsed.searchParams.get('link')) return null;
  return `/${match[1]}/download`;
}

/**
 * Map a link Prowlarr published onto the configured base, or null if it is not a
 * Prowlarr download link. The result always points at the configured scheme, host,
 * port and base path; only the `/{indexerId}/download` step, query and fragment are
 * kept, and any credentials in the link are discarded.
 * - Link on the configured host name (case-insensitive) and port, under the
 *   configured base path: accepted (scheme and default-port differences, as from a
 *   TLS proxy without X-Forwarded-Proto, and base-path case are tolerated).
 * - Any other http(s) link is accepted only as a Prowlarr proxy link
 *   (`.../{digits}/download?link=...`): Prowlarr builds these from the Host header it
 *   received, so behind a reverse proxy they can name an address RMAB can't reach.
 *   The link's own host, port and path prefix are dropped, never fetched.
 * Configured credentials (`user:pass@`) are added only with `withCredentials` (at
 * fetch time), so they are never stored with a pick, a download record or a job.
 */
export function toConfiguredProwlarrUrl(
  url: string,
  base: ProwlarrBase | null,
  options: { withCredentials?: boolean } = {}
): string | null {
  if (!base) return null;
  const parsed = parseHttpUrl(url);
  if (!parsed) return null;
  const suffix = configuredSuffix(parsed, base) ?? proxyLinkSuffix(parsed);
  if (!suffix) return null;
  const userinfo = options.withCredentials ? base.userinfo : '';
  return `${base.protocol}//${userinfo}${base.host}${base.basePath}${suffix}${parsed.search}${parsed.hash}`;
}

/**
 * Origins (`scheme://host[:port]`, no path, query or credentials) of Prowlarr proxy
 * links that do not point at the configured Prowlarr, for one log line per search.
 */
export function foreignProxyLinkOrigins(urls: Array<string | undefined>, base: ProwlarrBase | null): string[] {
  if (!base) return [];
  const origins = new Set<string>();
  for (const url of urls) {
    const parsed = url ? parseHttpUrl(url) : null;
    if (parsed && !configuredSuffix(parsed, base) && proxyLinkSuffix(parsed)) origins.add(parsed.origin);
  }
  return [...origins];
}

const MAGNET_PATTERN = /^magnet:\?[^\s]+$/i;

/**
 * True for a single `magnet:?` URI with no whitespace anywhere. Download clients
 * (e.g. qBittorrent's `urls` field) split on newlines, so a value with embedded
 * whitespace could smuggle extra URLs.
 */
export function isMagnetUri(url: unknown): boolean {
  return typeof url === 'string' && MAGNET_PATTERN.test(url);
}

/**
 * Remove every `apikey` query parameter whose value equals the configured key,
 * on any origin, then mask any other occurrence of the key in the string.
 * Other query bytes are left untouched.
 */
export function stripApiKey(value: string, apiKey: string | undefined | null): string {
  if (!apiKey || !value.includes(apiKey)) return value;
  const param = new RegExp(`([?&])apikey=${escapeRegExp(apiKey)}(?=[&#]|$)&?`, 'gi');
  let result = value.replace(param, '$1').replace(/[?&](?=#|$)/, '');
  if (result.includes(apiKey)) {
    result = result.split(apiKey).join(REDACTED_VALUE);
  }
  return result;
}

/** Return `url` with `apikey=<key>` present (appended before any fragment when missing). */
export function withApiKeyParam(url: string, apiKey: string): string {
  const parsed = new URL(url);
  if (parsed.searchParams.has('apikey')) return url;
  const hashIndex = url.indexOf('#');
  const head = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const tail = hashIndex === -1 ? '' : url.slice(hashIndex);
  const separator = head.includes('?') ? (head.endsWith('?') || head.endsWith('&') ? '' : '&') : '?';
  return `${head}${separator}apikey=${encodeURIComponent(apiKey)}${tail}`;
}

/**
 * Loggable form of a download URL: scheme + host only (`magnet:` for magnets).
 * Paths and queries can carry indexer passkeys in many shapes, so none are logged.
 */
export function urlForLog(url: string | undefined | null): string {
  if (!url) return '';
  if (/^magnet:/i.test(url.trim())) return 'magnet:';
  try {
    const parsed = new URL(url.trim());
    return parsed.host ? `${parsed.protocol}//${parsed.host}` : `${parsed.protocol}`;
  } catch {
    return '(invalid URL)';
  }
}
