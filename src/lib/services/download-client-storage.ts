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
 * Return the clients with every password encrypted. A password that is already in
 * the encrypted format (for example one the manager could not decrypt) is kept as-is,
 * so it is never wrapped twice.
 */
export function encryptClientPasswords<T extends StoredClient>(clients: T[]): T[] {
  const encryptionService = getEncryptionService();
  return clients.map((client) => {
    const password = typeof client.password === 'string' ? client.password : '';
    if (!password) return { ...client, password: '' };
    if (encryptionService.isEncryptedFormat(password)) return { ...client, password };
    return { ...client, password: encryptionService.encrypt(password) };
  });
}

/** JSON value for the `download_clients` config key, with every password encrypted. */
export function serializeDownloadClients<T extends StoredClient>(clients: T[]): string {
  return JSON.stringify(encryptClientPasswords(clients));
}
