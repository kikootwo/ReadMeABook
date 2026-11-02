/**
 * Component: Download Client Storage
 * Documentation: documentation/phase3/download-clients.md
 *
 * The single way to serialise download clients for the `download_clients` config key:
 * every password is stored encrypted.
 */

import type { DownloadClientConfig } from './download-client-manager.service';
import { getEncryptionService } from './encryption.service';

type StoredClient = { password?: DownloadClientConfig['password'] | null };

/**
 * Return the clients with every password encrypted.
 *
 * Callers pass passwords decrypted (getAllClients) or as typed in a request. The only
 * value kept as-is is one in the encrypted format that does NOT decrypt with the current
 * key: the manager could not decrypt it, so wrapping it again would bury it. A value that
 * does decrypt is text someone supplied (it cannot have come from getAllClients, which
 * would have decrypted it), so it is encrypted like any other password and never used as
 * stored ciphertext.
 */
export function encryptClientPasswords<T extends StoredClient>(clients: T[]): T[] {
  const encryptionService = getEncryptionService();
  const decryptsWithCurrentKey = (value: string): boolean => {
    try {
      encryptionService.decrypt(value);
      return true;
    } catch {
      return false;
    }
  };

  return clients.map((client) => {
    const password = typeof client.password === 'string' ? client.password : '';
    if (!password) return { ...client, password: '' };
    if (encryptionService.isEncryptedFormat(password) && !decryptsWithCurrentKey(password)) {
      return { ...client, password };
    }
    return { ...client, password: encryptionService.encrypt(password) };
  });
}

/** JSON value for the `download_clients` config key, with every password encrypted. */
export function serializeDownloadClients<T extends StoredClient>(clients: T[]): string {
  return JSON.stringify(encryptClientPasswords(clients));
}
