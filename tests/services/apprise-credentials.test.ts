/**
 * Component: Apprise Server URL Credentials Tests
 * Documentation: documentation/backend/services/notifications.md
 *
 * Credentials typed into or stored inside the Apprise serverUrl move into the Basic Auth
 * fields (password encrypted). Real EncryptionService; prisma mocked for the migration.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.CONFIG_ENCRYPTION_KEY ??= 'test-config-encryption-key-32-bytes!';

const prismaMock = vi.hoisted(() => ({
  notificationBackend: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import { getEncryptionService } from '@/lib/services/encryption.service';
import { NotificationService, MASKED_CONFIG_VALUE as MASK } from '@/lib/services/notification/notification.service';
import { AppriseProvider } from '@/lib/services/notification/providers/apprise.provider';
import {
  liftAppriseUrlCredentials,
  normalizeAppriseConfig,
  splitUrlCredentials,
} from '@/lib/services/notification/providers/apprise-credentials';

const enc = getEncryptionService();
const LEGACY_URL = 'https://alice:p%40ss%3Aword@apprise.example:8443/base/path?x=1';
const STRIPPED_URL = 'https://apprise.example:8443/base/path?x=1';

describe('splitUrlCredentials', () => {
  it.each([
    ['percent-encoded @ and : in the password', LEGACY_URL, STRIPPED_URL, 'alice', 'p@ss:word'],
    ['an unencoded @ inside the password (last @ ends the userinfo)', 'https://alice:p@ss@host.example/', 'https://host.example/', 'alice', 'p@ss'],
    ['a % that is not valid percent-encoding (kept raw)', 'https://alice:100%zz@host.example/', 'https://host.example/', 'alice', '100%zz'],
    ['a stray % next to a character the parser encodes', 'https://alice:Ab^c%9@host.example/', 'https://host.example/', 'alice', 'Ab^c%9'],
    ['an escape run that is not valid UTF-8 (kept as-is)', 'https://alice:x%E2%82y%41@host.example/', 'https://host.example/', 'alice', 'x%E2%82yA'],
    ['a parser-encoded character next to an invalid typed escape', 'https://alice:^%E2@host.example/', 'https://host.example/', 'alice', '^%E2'],
    ['a parser-encoded multi-byte character next to an invalid typed escape', 'https://alice:é%E2@host.example/', 'https://host.example/', 'alice', 'é%E2'],
    ['an IPv6 host', 'http://u:pw@[::1]:8000/api', 'http://[::1]:8000/api', 'u', 'pw'],
    ['a username only', 'https://bob@host.example/', 'https://host.example/', 'bob', ''],
    ['path, query and fragment', 'https://u:p@h.example/a/b?c=1&d=2#e', 'https://h.example/a/b?c=1&d=2#e', 'u', 'p'],
  ])('splits %s', (_label, input, url, user, password) => {
    expect(splitUrlCredentials(input)).toEqual({ url, user, password, hadUserinfo: true });
  });

  it('leaves a URL without credentials exactly as entered', () => {
    expect(splitUrlCredentials(' http://apprise:8000 ')).toEqual({ url: 'http://apprise:8000', user: '', password: '', hadUserinfo: false });
  });

  it.each([
    ['not a URL', 'http//alice:hunter2@apprise'],
    ['a scheme-less host:port (parses with scheme "apprise:")', 'apprise:8000'],
    ['scheme-less credentials (parse with scheme "alice:")', 'alice:hunter2@apprise:8000'],
    ['another scheme', 'ftp://u:p@host.example/'],
  ])('returns null for %s', (_label, input) => {
    expect(splitUrlCredentials(input)).toBeNull();
  });
});

describe('normalizeAppriseConfig', () => {
  it('moves credentials from the URL into empty fields (add-mode payload sends "" for every field)', () => {
    const result = normalizeAppriseConfig({
      serverUrl: LEGACY_URL, basicAuthUser: '', basicAuthPassword: '', urls: '', configKey: '', tag: '', authToken: '',
    });

    expect(result).toEqual({
      ok: true,
      config: { serverUrl: STRIPPED_URL, basicAuthUser: 'alice', basicAuthPassword: 'p@ss:word', urls: '', configKey: '', tag: '', authToken: '' },
    });
  });

  it('fills a masked password field from the URL, but a typed password wins', () => {
    expect(normalizeAppriseConfig({ serverUrl: LEGACY_URL, basicAuthPassword: MASK })).toMatchObject({
      ok: true, config: { basicAuthPassword: 'p@ss:word' },
    });
    expect(normalizeAppriseConfig({ serverUrl: LEGACY_URL, basicAuthUser: 'typed', basicAuthPassword: 'typed-pw' })).toMatchObject({
      ok: true, config: { serverUrl: STRIPPED_URL, basicAuthUser: 'typed', basicAuthPassword: 'typed-pw' },
    });
  });

  it('takes the username from the URL together with its password when that fills a masked field', () => {
    const result = normalizeAppriseConfig({ serverUrl: 'https://bob:newpw@host.example/', basicAuthUser: 'alice', basicAuthPassword: MASK });

    expect(result).toEqual({ ok: true, config: { serverUrl: 'https://host.example/', basicAuthUser: 'bob', basicAuthPassword: 'newpw' } });
  });

  it('keeps a typed username when a typed password wins over the URL', () => {
    const result = normalizeAppriseConfig({ serverUrl: 'https://bob:urlpw@host.example/', basicAuthUser: 'alice', basicAuthPassword: 'typed' });

    expect(result).toMatchObject({ ok: true, config: { basicAuthUser: 'alice', basicAuthPassword: 'typed' } });
  });

  it('a username-only URL sets the username and leaves the password field alone', () => {
    const result = normalizeAppriseConfig({ serverUrl: 'https://bob@host.example/', basicAuthPassword: '' });
    expect(result).toEqual({ ok: true, config: { serverUrl: 'https://host.example/', basicAuthUser: 'bob', basicAuthPassword: '' } });
  });

  it.each(['http//alice:hunter2@apprise:8000', 'alice:hunter2@apprise:8000'])(
    'refuses an unparseable URL containing @ (%s), without repeating it',
    (serverUrl) => {
      const result = normalizeAppriseConfig({ serverUrl });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('hunter2');
    },
  );

  it('passes an unparseable URL without @ through unchanged', () => {
    expect(normalizeAppriseConfig({ serverUrl: 'apprise:8000' })).toEqual({ ok: true, config: { serverUrl: 'apprise:8000' } });
  });
});

describe('liftAppriseUrlCredentials', () => {
  it('lets URL credentials win over existing fields (re-entered after a rollback)', () => {
    expect(liftAppriseUrlCredentials({ serverUrl: LEGACY_URL, basicAuthUser: 'old', basicAuthPassword: 'enc-old' })).toEqual({
      config: { serverUrl: STRIPPED_URL, basicAuthUser: 'alice', basicAuthPassword: 'enc-old' },
      password: 'p@ss:word',
    });
  });

  it('returns no password for a username-only URL, and null when nothing needs moving', () => {
    expect(liftAppriseUrlCredentials({ serverUrl: 'https://bob@host.example/' })?.password).toBeNull();
    expect(liftAppriseUrlCredentials({ serverUrl: 'http://apprise:8000' })).toBeNull();
    expect(liftAppriseUrlCredentials({ serverUrl: 'not a url@' })).toBeNull();
  });
});

describe('NotificationService (apprise credentials)', () => {
  const service = new NotificationService();

  it('prepares a submitted config: credentials out of the URL, password encrypted, empty fields left empty', () => {
    const result = service.prepareSubmittedConfig('apprise', { serverUrl: LEGACY_URL, basicAuthUser: '', basicAuthPassword: '', urls: '', authToken: '' });
    if (!result.ok) throw new Error(result.error);

    expect(result.config.serverUrl).toBe(STRIPPED_URL);
    expect(enc.decrypt(result.config.basicAuthPassword)).toBe('p@ss:word');
    expect(result.config.urls).toBe('');
    expect(result.config.authToken).toBe('');
    expect(JSON.stringify(result.config)).not.toContain('p@ss');
  });

  it('encrypts a supplied value that is already ciphertext as text, so it is never decrypted to another secret', () => {
    const otherSecret = enc.encrypt('prowlarr-api-key');
    const result = service.prepareSubmittedConfig('apprise', { serverUrl: 'http://apprise:8000', authToken: otherSecret, urls: MASK });
    if (!result.ok) throw new Error(result.error);

    expect(enc.decrypt(result.config.authToken)).toBe(otherSecret);
    expect(result.config.urls).toBe(MASK); // masks are left for mergeMaskedSecrets
  });

  it('migrates a legacy stored row: URL stripped, password encrypted and decryptable', () => {
    const migrated = service.migrateStoredConfig('apprise', { serverUrl: LEGACY_URL, urls: enc.encrypt('slack://t') })!;

    expect(migrated.serverUrl).toBe(STRIPPED_URL);
    expect(migrated.basicAuthUser).toBe('alice');
    expect(enc.isEncryptedFormat(migrated.basicAuthPassword)).toBe(true);
    expect(enc.decrypt(migrated.basicAuthPassword)).toBe('p@ss:word');
    expect(enc.decrypt(migrated.urls)).toBe('slack://t'); // not double-wrapped
  });

  it('never stores an encrypted empty password for a username-only URL', () => {
    const migrated = service.migrateStoredConfig('apprise', { serverUrl: 'https://bob@host.example/' })!;

    expect(migrated).toEqual({ serverUrl: 'https://host.example/', basicAuthUser: 'bob' });
  });

  it('URL credentials replace a stored password field', () => {
    const migrated = service.migrateStoredConfig('apprise', {
      serverUrl: LEGACY_URL, basicAuthUser: 'old', basicAuthPassword: enc.encrypt('old-pw'),
    })!;

    expect(migrated.basicAuthUser).toBe('alice');
    expect(enc.decrypt(migrated.basicAuthPassword)).toBe('p@ss:word');
  });

  it('leaves current rows and other providers alone', () => {
    expect(service.migrateStoredConfig('apprise', { serverUrl: 'http://apprise:8000', basicAuthPassword: enc.encrypt('x') })).toBeNull();
    expect(service.migrateStoredConfig('ntfy', { serverUrl: 'https://u:p@ntfy.example', accessToken: 'enc' })).toBeNull();
  });

  it('refuses a non-text secret value instead of storing it', () => {
    const result = service.prepareSubmittedConfig('apprise', { serverUrl: 'http://apprise:8000', authToken: 424242 });

    expect(result).toEqual({ ok: false, error: 'Auth Token must be text.' });
  });

  it('encryptConfig refuses a non-text secret without repeating the value', () => {
    let message = '';
    try {
      service.encryptConfig('apprise', { serverUrl: 'http://apprise:8000', authToken: 424242 });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe('Sensitive field "authToken" is not text');
  });

  it('shows only the host part of an unparseable server URL that holds credentials', () => {
    const masked = service.maskConfig('apprise', { serverUrl: 'alice:hunter2@apprise:8000', urls: enc.encrypt('x') });

    expect(masked.serverUrl).toBe('apprise:8000');
    expect(JSON.stringify(masked)).not.toContain('hunter2');
  });

  it('shows a legacy row in its migrated form: no credentials in the URL, password masked', () => {
    const masked = service.maskConfig('apprise', { serverUrl: LEGACY_URL, urls: enc.encrypt('slack://t') });

    expect(masked).toEqual({ serverUrl: STRIPPED_URL, basicAuthUser: 'alice', basicAuthPassword: MASK, urls: MASK });
    expect(masked.serverUrl).not.toContain(MASK);
  });

  it('round-trips a legacy row through GET then PUT without losing or exposing secrets', () => {
    const stored = { serverUrl: LEGACY_URL, urls: enc.encrypt('slack://token') };

    // GET → the form shows this, the admin changes nothing and saves
    const shown = service.maskConfig('apprise', stored);
    // PUT pipeline (same order as the route)
    const saved = service.migrateStoredConfig('apprise', stored) ?? stored;
    const prepared = service.prepareSubmittedConfig('apprise', shown);
    if (!prepared.ok) throw new Error(prepared.error);
    const merged = service.mergeMaskedSecrets('apprise', saved, prepared.config);
    if (!merged.ok) throw new Error(merged.error);
    const final = service.encryptConfig('apprise', merged.config);

    expect(final.serverUrl).toBe(STRIPPED_URL);
    expect(final.basicAuthUser).toBe('alice');
    expect(enc.decrypt(final.basicAuthPassword)).toBe('p@ss:word');
    expect(enc.decrypt(final.urls)).toBe('slack://token'); // masked urls kept although the URL lost its userinfo
    expect(JSON.stringify(final)).not.toContain(MASK);
  });

  it('refuses keeping the masked password when the server changes', () => {
    const saved = service.migrateStoredConfig('apprise', { serverUrl: LEGACY_URL })!;
    const prepared = service.prepareSubmittedConfig('apprise', { serverUrl: 'https://elsewhere.example', basicAuthUser: 'alice', basicAuthPassword: MASK });
    if (!prepared.ok) throw new Error(prepared.error);

    const merged = service.mergeMaskedSecrets('apprise', saved, prepared.config);
    expect(merged.ok).toBe(false);
    if (!merged.ok) expect(merged.error).toContain('Basic Auth Password');
  });
});

describe('NotificationService.migrateStoredSecrets', () => {
  const service = new NotificationService();
  const at = new Date('2026-10-19T00:00:00.000Z');

  beforeEach(() => {
    prismaMock.notificationBackend.findMany.mockReset();
    prismaMock.notificationBackend.updateMany.mockReset();
  });

  it('migrates only rows that need it, compare-and-swap on updatedAt, and continues past a failing row', async () => {
    prismaMock.notificationBackend.findMany.mockResolvedValue([
      { id: 'a', type: 'apprise', name: 'A', updatedAt: at, config: { serverUrl: LEGACY_URL } },
      { id: 'b', type: 'apprise', name: 'B', updatedAt: at, config: { serverUrl: 'https://u:p@failing.example' } },
      { id: 'c', type: 'apprise', name: 'C', updatedAt: at, config: { serverUrl: 'http://apprise:8000' } },
      { id: 'd', type: 'ntfy', name: 'D', updatedAt: at, config: { serverUrl: 'https://u:p@ntfy.example' } },
      { id: 'e', type: 'apprise', name: 'E', updatedAt: at, config: { serverUrl: 'https://u:p@changed.example' } },
    ]);
    prismaMock.notificationBackend.updateMany.mockImplementation(async ({ where }: any) => {
      if (where.id === 'b') throw new Error('database hiccup');
      return { count: where.id === 'e' ? 0 : 1 }; // e was saved by an admin in between
    });

    await expect(service.migrateStoredSecrets()).resolves.toBe(1);

    const calls = prismaMock.notificationBackend.updateMany.mock.calls.map(([args]: any[]) => args);
    expect(calls.map((c: any) => c.where.id)).toEqual(['a', 'b', 'e']);
    expect(calls[0].where).toEqual({ id: 'a', updatedAt: at });
    expect(calls[0].data.config.serverUrl).toBe(STRIPPED_URL);
    expect(enc.decrypt(calls[0].data.config.basicAuthPassword)).toBe('p@ss:word');
  });

  it('is a no-op on a second run', async () => {
    const migrated = service.migrateStoredConfig('apprise', { serverUrl: LEGACY_URL });
    prismaMock.notificationBackend.findMany.mockResolvedValue([{ id: 'a', type: 'apprise', name: 'A', updatedAt: at, config: migrated }]);

    await expect(service.migrateStoredSecrets()).resolves.toBe(0);
    expect(prismaMock.notificationBackend.updateMany).not.toHaveBeenCalled();
  });
});

describe('NotificationService.reEncryptUnprotectedBackends', () => {
  const service = new NotificationService();

  beforeEach(() => {
    prismaMock.notificationBackend.findMany.mockReset();
    prismaMock.notificationBackend.update.mockReset();
  });

  it('skips a non-text secret and still re-encrypts the other rows', async () => {
    prismaMock.notificationBackend.findMany.mockResolvedValue([
      { id: 'a', type: 'apprise', name: 'A', config: { serverUrl: 'http://apprise:8000', authToken: 424242 } },
      { id: 'b', type: 'apprise', name: 'B', config: { serverUrl: 'http://apprise:8000', urls: 'slack://plain' } },
    ]);
    prismaMock.notificationBackend.update.mockResolvedValue({});

    await expect(service.reEncryptUnprotectedBackends()).resolves.toBe(1);
    const call = prismaMock.notificationBackend.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'b' });
    expect(enc.decrypt(call.data.config.urls)).toBe('slack://plain');
  });

  it('continues past a row whose update fails', async () => {
    prismaMock.notificationBackend.findMany.mockResolvedValue([
      { id: 'a', type: 'apprise', name: 'A', config: { urls: 'one' } },
      { id: 'b', type: 'apprise', name: 'B', config: { urls: 'two' } },
    ]);
    prismaMock.notificationBackend.update.mockRejectedValueOnce(new Error('db hiccup')).mockResolvedValueOnce({});

    await expect(service.reEncryptUnprotectedBackends()).resolves.toBe(1);
    expect(prismaMock.notificationBackend.update).toHaveBeenCalledTimes(2);
  });
});

describe('AppriseProvider.send', () => {
  const provider = new AppriseProvider();
  const payload = { event: 'request_available', title: 'T', author: 'A', userName: 'U', timestamp: new Date() } as any;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const sent = () => ({ url: fetchMock.mock.calls[0][0] as string, auth: (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string> });
  const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

  it('uses the Basic Auth fields and a URL without credentials', async () => {
    await provider.send({ serverUrl: 'https://apprise.example/', basicAuthUser: 'alice', basicAuthPassword: 'pw', urls: 'x://y' }, payload);

    expect(sent().url).toBe('https://apprise.example/notify/');
    expect(sent().auth.Authorization).toBe(basic('alice', 'pw'));
  });

  it('falls back to credentials still inside a legacy URL, decoded, and never sends them in the URL', async () => {
    await provider.send({ serverUrl: LEGACY_URL, urls: 'x://y' }, payload);

    expect(sent().url.startsWith('https://apprise.example:8443/base/path')).toBe(true);
    expect(sent().url).not.toContain('alice');
    expect(sent().url).not.toContain('p%40ss');
    expect(sent().auth.Authorization).toBe(basic('alice', 'p@ss:word'));
  });

  it('lets URL credentials win over the Basic Auth fields, matching what the migration stores', async () => {
    const row = { serverUrl: LEGACY_URL, basicAuthUser: 'svc', basicAuthPassword: 'old-pw', urls: 'x://y' };
    await provider.send(row, payload);

    expect(sent().auth.Authorization).toBe(basic('alice', 'p@ss:word'));
    const migrated = liftAppriseUrlCredentials(row)!;
    expect(sent().auth.Authorization).toBe(basic(migrated.config.basicAuthUser, migrated.password!));
  });

  it('takes each part from the URL when present and from the field otherwise', async () => {
    await provider.send({ serverUrl: 'https://bob@host.example/', basicAuthUser: 'svc', basicAuthPassword: 'pw', urls: 'x://y' }, payload);

    expect(sent().auth.Authorization).toBe(basic('bob', 'pw'));
  });

  it('keeps a malformed % in a legacy password as typed', async () => {
    await provider.send({ serverUrl: 'https://alice:100%zz@host.example', urls: 'x://y' }, payload);

    expect(sent().auth.Authorization).toBe(basic('alice', '100%zz'));
  });

  it('prefers the auth token (Bearer) over Basic auth', async () => {
    await provider.send({ serverUrl: 'https://h.example', basicAuthUser: 'a', basicAuthPassword: 'b', authToken: 'tok', urls: 'x://y' }, payload);

    expect(sent().auth.Authorization).toBe('Bearer tok');
  });

  it('rejects an invalid URL with a message that does not repeat it', async () => {
    const error = await provider.send({ serverUrl: 'http//alice:hunter2@apprise', urls: 'x://y' }, payload).catch((e) => e);

    expect(error.message).toBe('The Apprise Server URL is not a valid URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
