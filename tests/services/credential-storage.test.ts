/**
 * Component: Download Client Storage + Credential Migration Tests
 * Documentation: documentation/backend/services/config.md
 *
 * Real EncryptionService: passwords are stored encrypted, a plaintext secret that merely
 * contains colons is still encrypted, and a value already in the encrypted format (even
 * one this key cannot decrypt) is never wrapped twice. Migration writes are
 * compare-and-swap so an admin save in between wins.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.CONFIG_ENCRYPTION_KEY ??= 'test-config-encryption-key-32-bytes!';

const rows = vi.hoisted(() => new Map<string, { key: string; value: string; encrypted: boolean }>());
const updateManyMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  prisma: {
    configuration: {
      findUnique: async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null,
      update: updateMock,
      updateMany: updateManyMock,
    },
  },
}));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import { EncryptionService, getEncryptionService } from '@/lib/services/encryption.service';
import { encryptClientPasswords, serializeDownloadClients } from '@/lib/services/download-client-storage';
import { runCredentialMigration } from '@/lib/services/credential-migration.service';

// Shaped like base64 parts but not encrypt()'s output (IV/tag are not 16 bytes)
const COLON_PLAINTEXT = 'dGVzdA==:cGFzcw==:d29yZA==';

/** Ciphertext in the right format that this process's key cannot decrypt */
function foreignCiphertext(): string {
  const original = process.env.CONFIG_ENCRYPTION_KEY;
  process.env.CONFIG_ENCRYPTION_KEY = 'a-completely-different-key-000000';
  const value = new EncryptionService().encrypt('other-key-secret');
  process.env.CONFIG_ENCRYPTION_KEY = original;
  return value;
}

describe('download client storage', () => {
  const enc = getEncryptionService();

  it('encrypts every plaintext password, including colon-shaped ones', () => {
    const stored = encryptClientPasswords([
      { id: 'a', password: 'plain-pass' },
      { id: 'b', password: COLON_PLAINTEXT },
      { id: 'c', password: 'user:pass:word' },
    ]);

    expect(stored.map((c) => enc.isEncryptedFormat(c.password!))).toEqual([true, true, true]);
    expect(stored.map((c) => enc.decrypt(c.password!))).toEqual(['plain-pass', COLON_PLAINTEXT, 'user:pass:word']);
  });

  it('keeps an already-encrypted (even undecryptable) password as-is', () => {
    const foreign = foreignCiphertext();
    const stored = encryptClientPasswords([{ id: 'a', password: foreign }]);

    expect(stored[0].password).toBe(foreign);
  });

  it('encrypts a supplied value that is valid ciphertext for this key, instead of storing it as-is', () => {
    const otherSecret = enc.encrypt('prowlarr-api-key');
    const stored = encryptClientPasswords([{ id: 'a', password: otherSecret }]);

    expect(stored[0].password).not.toBe(otherSecret);
    // Reading it back yields the literal text that was supplied, not the other secret
    expect(enc.decrypt(stored[0].password!)).toBe(otherSecret);
  });

  it('stores an empty string when there is no password', () => {
    expect(encryptClientPasswords([{ id: 'a' }, { id: 'b', password: '' }]).map((c) => c.password)).toEqual(['', '']);
  });

  it('serialises to JSON with no plaintext password', () => {
    const json = serializeDownloadClients([{ id: 'a', password: 'canary-plain' }]);

    expect(json).not.toContain('canary-plain');
    expect(enc.decrypt(JSON.parse(json)[0].password)).toBe('canary-plain');
  });
});

describe('runCredentialMigration', () => {
  const enc = getEncryptionService();

  beforeEach(() => {
    rows.clear();
    updateManyMock.mockReset();
    updateMock.mockReset();
    updateManyMock.mockResolvedValue({ count: 1 });
  });

  const downloadClientsWrite = () =>
    updateManyMock.mock.calls.find(([args]) => args.where.key === 'download_clients')?.[0];

  it('encrypts plaintext and colon-shaped download client passwords with a compare-and-swap write', async () => {
    const original = JSON.stringify([
      { id: 'a', password: 'plain-pass' },
      { id: 'b', password: COLON_PLAINTEXT },
    ]);
    rows.set('download_clients', { key: 'download_clients', value: original, encrypted: false });

    await runCredentialMigration();

    const write = downloadClientsWrite();
    expect(write.where).toEqual({ key: 'download_clients', value: original });
    const stored = JSON.parse(write.data.value);
    expect(stored.map((c: { password: string }) => enc.decrypt(c.password))).toEqual(['plain-pass', COLON_PLAINTEXT]);
  });

  it('leaves an undecryptable encrypted password alone and does not write', async () => {
    rows.set('download_clients', {
      key: 'download_clients',
      value: JSON.stringify([{ id: 'a', password: foreignCiphertext() }]),
      encrypted: false,
    });

    await runCredentialMigration();

    expect(downloadClientsWrite()).toBeUndefined();
  });

  it('does not overwrite download clients saved after it read them', async () => {
    rows.set('download_clients', { key: 'download_clients', value: JSON.stringify([{ id: 'a', password: 'plain' }]), encrypted: false });
    updateManyMock.mockResolvedValue({ count: 0 }); // value changed since the read

    await expect(runCredentialMigration()).resolves.toBeUndefined();
    expect(downloadClientsWrite().where.value).toContain('plain');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('encrypts the legacy single-client password key, and a second run changes nothing', async () => {
    rows.set('download_client_password', { key: 'download_client_password', value: 'legacy-pass', encrypted: false });

    await runCredentialMigration();

    const write = updateManyMock.mock.calls.find(([args]) => args.where.key === 'download_client_password')?.[0];
    expect(write.where).toEqual({ key: 'download_client_password', value: 'legacy-pass' });
    expect(write.data.encrypted).toBe(true);
    expect(enc.decrypt(write.data.value)).toBe('legacy-pass');

    rows.set('download_client_password', { key: 'download_client_password', value: write.data.value, encrypted: true });
    updateManyMock.mockClear();
    await runCredentialMigration();
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it('encrypts a colon-shaped plaintext config key', async () => {
    rows.set('prowlarr_api_key', { key: 'prowlarr_api_key', value: COLON_PLAINTEXT, encrypted: false });

    await runCredentialMigration();

    const write = updateManyMock.mock.calls.find(([args]) => args.where.key === 'prowlarr_api_key')?.[0];
    expect(enc.decrypt(write.data.value)).toBe(COLON_PLAINTEXT);
  });
});
