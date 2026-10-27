/**
 * Component: Fetch Error Reasons
 * Documentation: documentation/setup-wizard.md
 *
 * Node's fetch rejects with a bare "fetch failed"; the real reason (refused,
 * DNS, timeout, TLS) sits on `error.cause`. These helpers turn that into a
 * short reason naming the target host:port, plus a detail object for the log.
 * Neither includes request headers, the URL path or query, or a given secret.
 */

const MAX_CAUSE_DEPTH = 5;
const MAX_REASON_CHARS = 160;
const MAX_LOG_MESSAGE_CHARS = 500;

/** Plain reasons for socket and URL error codes (Node and undici). */
const CODE_REASONS: Record<string, string> = {
  ECONNREFUSED: 'connection refused, nothing is accepting connections at that address and port',
  ENOTFOUND: 'the host name could not be resolved, the DNS lookup failed',
  EAI_AGAIN: 'the DNS lookup failed temporarily, check the DNS server the container uses',
  ETIMEDOUT: 'the connection timed out',
  UND_ERR_CONNECT_TIMEOUT: 'the connection timed out',
  UND_ERR_HEADERS_TIMEOUT: 'the server accepted the connection but did not answer in time',
  UND_ERR_BODY_TIMEOUT: 'the server stopped sending its answer',
  ECONNRESET: 'the connection was reset by the server or a proxy',
  UND_ERR_SOCKET: 'the connection was closed unexpectedly',
  EHOSTUNREACH: 'the host is unreachable',
  ENETUNREACH: 'the network is unreachable',
  ERR_INVALID_URL: 'the server URL is not a valid URL',
};

/**
 * Certificate verification codes (their messages are short and safe to show): every
 * code containing "CERT", plus this one, which doesn't.
 */
const TLS_CERT_CODE_WITHOUT_CERT = 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';

/**
 * Header validation errors ("Headers.append: "Bearer <token>" is an invalid header value.")
 * quote the value after trimming its edges, so scrubbing the token as supplied can miss it.
 * A cause-less rejection with such a message is never shown or logged.
 */
const HEADER_VALUE_MESSAGE = /header|ByteString/i;
const WITHHELD_HEADER_MESSAGE = 'message withheld: it quotes a request header value';

const TLS_HANDSHAKE_REASON = 'the TLS handshake failed; if the server uses plain http, start the URL with http://';

export interface FetchErrorOptions {
  /** Service name for the reason, for example "Audiobookshelf". */
  service: string;
  /** Values to scrub from any text taken from the error (API keys, tokens). */
  secrets?: ReadonlyArray<string | null | undefined>;
}

export interface FetchErrorLink {
  name?: string;
  message?: string;
  code?: string;
  errno?: number;
  syscall?: string;
  hostname?: string;
  address?: string;
  port?: number;
}

export interface FetchErrorDetails {
  target: string | null;
  chain: FetchErrorLink[];
}

type ErrorLike = { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };

/** "host:port" of a URL (default port filled in), or null when it does not parse. Never path, query or credentials. */
export function describeTarget(url: string): string | null {
  try {
    const parsed = new URL(url);
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    return `${parsed.hostname}:${port}`;
  } catch {
    return null;
  }
}

/** The error and its causes, outermost first. */
function causeChain(error: unknown): ErrorLike[] {
  const chain: ErrorLike[] = [];
  let current: unknown = error;
  while (current && typeof current === 'object' && chain.length < MAX_CAUSE_DEPTH) {
    chain.push(current as ErrorLike);
    current = (current as ErrorLike).cause;
  }
  return chain;
}

/** First string `code` in the chain (DOMException carries a numeric one, skipped). */
function findCode(chain: ErrorLike[]): string | undefined {
  for (const link of chain) {
    if (typeof link.code === 'string' && link.code) return link.code;
  }
  return undefined;
}

function scrub(text: string, url: string, secrets: ReadonlyArray<string | null | undefined>): string {
  // The URL first: a secret inside it would otherwise break the match.
  let out = url ? text.split(url).join(describeTarget(url) ?? '[url]') : text;
  for (const secret of secrets) {
    if (!secret) continue;
    // Headers trims a value's edges before quoting it; scrub both forms.
    for (const form of new Set([secret, secret.trim()])) {
      if (form) out = out.split(form).join('[redacted]');
    }
  }
  return out;
}

function firstLine(text: string, max: number): string {
  const line = text.split(/\r?\n/)[0].trim();
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}

/** Deepest non-empty message in the chain (the socket error, not "fetch failed"). */
function deepestMessage(chain: ErrorLike[]): string | undefined {
  for (let i = chain.length - 1; i > 0; i--) {
    const message = chain[i].message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return undefined;
}

function failureReason(error: unknown, url: string, secrets: ReadonlyArray<string | null | undefined>): string {
  const chain = causeChain(error);
  const names = chain.map((link) => link.name);
  if (names.includes('TimeoutError')) return 'the request timed out';
  if (names.includes('AbortError')) return 'the request was cancelled';

  const code = findCode(chain);
  const causeMessage = deepestMessage(chain);
  if (code && CODE_REASONS[code]) return `${CODE_REASONS[code]} (${code})`;
  if (code && (code.includes('CERT') || code === TLS_CERT_CODE_WITHOUT_CERT)) {
    const detail = causeMessage ? `: ${firstLine(scrub(causeMessage, url, secrets), MAX_REASON_CHARS)}` : '';
    return `the TLS certificate was rejected${detail} (${code})`;
  }
  if (code && (code.startsWith('ERR_SSL_') || code === 'EPROTO')) return `${TLS_HANDSHAKE_REASON} (${code})`;

  if (chain.slice(1).some((link) => link.message === 'bad port')) {
    const port = describeTarget(url)?.split(':').pop();
    return `port ${port ?? 'in the URL'} is on the list of ports Node refuses to connect to; use the port the server listens on`;
  }
  if (causeMessage) {
    const text = firstLine(scrub(causeMessage, url, secrets), MAX_REASON_CHARS);
    return code ? `${text} (${code})` : text;
  }

  // No cause: fetch rejected before connecting. The message itself is never echoed.
  const message = typeof chain[0]?.message === 'string' ? chain[0].message : '';
  if (HEADER_VALUE_MESSAGE.test(message)) {
    return 'the request could not be built; check the API token for spaces, line breaks or unusual characters';
  }
  return 'the request failed before it reached the server';
}

/**
 * Short reason for a rejected fetch, for example
 * "Could not reach Audiobookshelf at 10.0.0.5:13378: connection refused, ... (ECONNREFUSED)".
 */
export function describeFetchError(error: unknown, url: string, options: FetchErrorOptions): string {
  const target = describeTarget(url);
  const reason = failureReason(error, url, options.secrets ?? []);
  return target ? `Could not reach ${options.service} at ${target}: ${reason}` : `Could not reach ${options.service}: ${reason}`;
}

/** Log-safe cause chain for a rejected fetch: names, messages, codes and socket fields, scrubbed. */
export function fetchErrorDetails(
  error: unknown,
  url: string,
  secrets: ReadonlyArray<string | null | undefined> = []
): FetchErrorDetails {
  const links = causeChain(error);
  const chain = links.map((link, index) => {
    const source = link as ErrorLike & Record<string, unknown>;
    const out: FetchErrorLink = {};
    if (typeof source.name === 'string') out.name = source.name;
    if (typeof source.message === 'string') {
      // A rejection with no cause failed before connecting; a header message there quotes the token.
      const isLeafRejection = index === 0 && links.length === 1;
      const message = isLeafRejection && HEADER_VALUE_MESSAGE.test(source.message)
        ? WITHHELD_HEADER_MESSAGE
        : scrub(source.message, url, secrets);
      out.message = message.length > MAX_LOG_MESSAGE_CHARS ? `${message.slice(0, MAX_LOG_MESSAGE_CHARS)}...` : message;
    }
    if (typeof source.code === 'string') out.code = source.code;
    if (typeof source.errno === 'number') out.errno = source.errno;
    if (typeof source.syscall === 'string') out.syscall = source.syscall;
    if (typeof source.hostname === 'string') out.hostname = source.hostname;
    if (typeof source.address === 'string') out.address = source.address;
    if (typeof source.port === 'number') out.port = source.port;
    return out;
  });
  return { target: describeTarget(url), chain };
}

/** Hint for a server URL ending in /api (the client adds /api itself), or null. */
export function apiSuffixHint(serverUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    return null;
  }
  if (!/\/api\/?$/i.test(parsed.pathname)) return null;
  return `The server URL ends in /api. Remove it and use ${parsed.origin}${parsed.pathname.replace(/\/api\/?$/i, '')}`;
}
