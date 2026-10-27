/**
 * Component: Fetch Error Reason Tests
 * Documentation: documentation/setup-wizard.md
 */

import http from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { apiSuffixHint, describeFetchError, fetchErrorDetails } from '@/lib/utils/fetch-error';

const SECRET = 'abs-api-key-0123456789abcdef';

// tests/setup.ts swaps fetch for a thrower in beforeAll; module code runs first, so this is Node's real fetch.
const realFetch = globalThis.fetch;

/** The shape Node 22's fetch rejects with: TypeError('fetch failed') carrying the socket error as `cause`. */
function fetchFailed(cause: Error & Record<string, unknown>): TypeError {
  return new TypeError('fetch failed', { cause });
}

function withProps(error: Error, props: Record<string, unknown>): Error & Record<string, unknown> {
  return Object.assign(error, props);
}

const servers: http.Server[] = [];

async function listen(handler: http.RequestListener): Promise<number> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

/** A port nothing listens on: bind an ephemeral port, then release it. */
async function closedPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the fetch to reject');
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

describe('describeFetchError', () => {
  it('names a refused connection and the host and port (real fetch)', async () => {
    const port = await closedPort();
    const url = `http://127.0.0.1:${port}/api/libraries`;
    const error = await rejectionOf(realFetch(url));

    const reason = describeFetchError(error, url, { service: 'Audiobookshelf' });

    expect(reason).toBe(
      `Could not reach Audiobookshelf at 127.0.0.1:${port}: connection refused, nothing is accepting connections at that address and port (ECONNREFUSED)`
    );
  });

  it('reads the code off an AggregateError cause (localhost tries IPv4 and IPv6)', () => {
    const aggregate = withProps(new AggregateError([], ''), { code: 'ECONNREFUSED' });
    const reason = describeFetchError(fetchFailed(aggregate), 'http://localhost:13378/api/libraries', { service: 'Audiobookshelf' });

    expect(reason).toContain('localhost:13378');
    expect(reason).toContain('(ECONNREFUSED)');
  });

  it('names a DNS failure', () => {
    const cause = withProps(new Error('getaddrinfo ENOTFOUND abs.invalid'), { code: 'ENOTFOUND', hostname: 'abs.invalid' });
    const reason = describeFetchError(fetchFailed(cause), 'http://abs.invalid:13378/api/libraries', { service: 'Audiobookshelf' });

    expect(reason).toBe(
      'Could not reach Audiobookshelf at abs.invalid:13378: the host name could not be resolved, the DNS lookup failed (ENOTFOUND)'
    );
  });

  it('names a connect timeout', () => {
    const cause = withProps(
      new Error('Connect Timeout Error (attempted address: 10.255.255.1:13378, timeout: 10000ms)'),
      { name: 'ConnectTimeoutError', code: 'UND_ERR_CONNECT_TIMEOUT' }
    );
    const reason = describeFetchError(fetchFailed(cause), 'http://10.255.255.1:13378/api/libraries', { service: 'Audiobookshelf' });

    expect(reason).toBe(
      'Could not reach Audiobookshelf at 10.255.255.1:13378: the connection timed out (UND_ERR_CONNECT_TIMEOUT)'
    );
  });

  it('names an AbortSignal timeout', () => {
    const error = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const reason = describeFetchError(error, 'http://abs:13378/api/libraries', { service: 'Audiobookshelf' });

    expect(reason).toBe('Could not reach Audiobookshelf at abs:13378: the request timed out');
  });

  it('names a rejected TLS certificate with its reason', () => {
    const cause = withProps(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    const reason = describeFetchError(fetchFailed(cause), 'https://abs.lan/api/libraries', { service: 'Audiobookshelf' });

    expect(reason).toBe(
      'Could not reach Audiobookshelf at abs.lan:443: the TLS certificate was rejected: self-signed certificate (DEPTH_ZERO_SELF_SIGNED_CERT)'
    );
  });

  it('names a TLS handshake failure against a plain http port (real fetch)', async () => {
    const port = await listen((_req, res) => res.end('plain http'));
    const url = `https://127.0.0.1:${port}/api/libraries`;
    const error = await rejectionOf(realFetch(url));

    const reason = describeFetchError(error, url, { service: 'Audiobookshelf' });

    expect(reason).toMatch(new RegExp(`^Could not reach Audiobookshelf at 127\\.0\\.0\\.1:${port}: the TLS handshake failed`));
    expect(reason).toContain('http://');
    expect(reason).toMatch(/\((ERR_SSL_[A-Z_]+|EPROTO)\)$/);
  });

  it('explains a port the fetch standard blocks (real fetch)', async () => {
    const url = 'http://127.0.0.1:1/api/libraries';
    const error = await rejectionOf(realFetch(url));

    expect(describeFetchError(error, url, { service: 'Audiobookshelf' })).toBe(
      'Could not reach Audiobookshelf at 127.0.0.1:1: port 1 is on the list of ports Node refuses to connect to; use the port the server listens on'
    );
  });

  it('never echoes a secret from an invalid header value (real fetch)', async () => {
    const url = 'http://127.0.0.1:9999/api/libraries';
    // An inner line break makes Headers throw with the whole value in the message.
    const pasted = `${SECRET}\nwrapped`;
    const error = await rejectionOf(realFetch(url, { headers: { Authorization: `Bearer ${pasted}` } }));
    expect((error as Error).message).toContain(SECRET);

    // No secrets passed: the reason must not depend on scrubbing to stay clean.
    const reason = describeFetchError(error, url, { service: 'Audiobookshelf' });

    expect(reason).not.toContain(SECRET);
    expect(reason).toContain('API token');
  });

  it('never echoes the URL query or path of an unparseable URL', () => {
    const url = 'htp//abs?token=SECRETVALUE';
    const cause = withProps(new TypeError('Invalid URL'), { code: 'ERR_INVALID_URL', input: url });
    const error = new TypeError(`Failed to parse URL from ${url}`, { cause });

    const reason = describeFetchError(error, url, { service: 'Audiobookshelf' });

    expect(reason).toBe('Could not reach Audiobookshelf: the server URL is not a valid URL (ERR_INVALID_URL)');
  });

  it('falls back to the scrubbed cause message for an unknown code', () => {
    const cause = withProps(new Error(`odd failure near ${SECRET}\nsecond line`), { code: 'E_SOMETHING' });
    const reason = describeFetchError(fetchFailed(cause), 'http://abs:13378/api/libraries', {
      service: 'Audiobookshelf',
      secrets: [SECRET],
    });

    expect(reason).toBe('Could not reach Audiobookshelf at abs:13378: odd failure near [redacted] (E_SOMETHING)');
  });
});

describe('fetchErrorDetails', () => {
  it('keeps the cause chain for the log and scrubs secrets and the URL', () => {
    const url = `http://abs:13378/api/libraries?token=${SECRET}`;
    const cause = withProps(new Error('connect ECONNREFUSED 10.0.0.5:13378'), {
      code: 'ECONNREFUSED',
      errno: -111,
      syscall: 'connect',
      address: '10.0.0.5',
      port: 13378,
    });
    const error = new TypeError(`fetch failed for ${url} with ${SECRET}`, { cause });

    const details = fetchErrorDetails(error, url, [SECRET]);
    const text = JSON.stringify(details);

    expect(details.target).toBe('abs:13378');
    expect(details.chain[1]).toEqual({
      name: 'Error',
      message: 'connect ECONNREFUSED 10.0.0.5:13378',
      code: 'ECONNREFUSED',
      errno: -111,
      syscall: 'connect',
      address: '10.0.0.5',
      port: 13378,
    });
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('token=');
  });
});

describe('fetchErrorDetails with an invalid header value', () => {
  it.each([`${SECRET}\nwrapped\n`, `${SECRET}\nwrapped  `, `${SECRET}\nwrapped\t`])(
    'withholds the quoted value even without secrets (real fetch, %j)',
    async (pasted) => {
      const url = 'http://127.0.0.1:9999/api/libraries';
      const error = await rejectionOf(realFetch(url, { headers: { Authorization: `Bearer ${pasted}` } }));
      expect((error as Error).message).toContain(SECRET);

      const details = fetchErrorDetails(error, url);

      expect(JSON.stringify(details)).not.toContain(SECRET);
      expect(details.chain).toEqual([{ name: 'TypeError', message: 'message withheld: it quotes a request header value' }]);
    }
  );

  it('scrubs a secret by its trimmed form too', () => {
    const error = new TypeError('fetch failed', { cause: new Error(`odd text ${SECRET}x`) });

    expect(JSON.stringify(fetchErrorDetails(error, 'http://abs/api', [`  ${SECRET}\n`]))).not.toContain(SECRET);
  });
});

describe('apiSuffixHint', () => {
  it.each([
    ['http://abs:13378/api', 'http://abs:13378'],
    ['http://abs:13378/api/', 'http://abs:13378'],
    ['https://host.example/audiobookshelf/API', 'https://host.example/audiobookshelf'],
  ])('suggests the base address for %s', (input, base) => {
    expect(apiSuffixHint(input)).toBe(`The server URL ends in /api. Remove it and use ${base}`);
  });

  it.each(['http://abs:13378', 'http://abs:13378/apidocs', 'not a url'])('returns null for %s', (input) => {
    expect(apiSuffixHint(input)).toBeNull();
  });
});
