/**
 * Component: Saved Credential Loaders (settings test/save routes)
 * Documentation: documentation/settings-pages.md
 *
 * Each loader returns a saved secret together with the URL it belongs to,
 * for resolveSecretForUrl() in src/lib/utils/saved-credential.ts.
 */

import { getConfigService } from '@/lib/services/config.service';
import type { SavedCredential } from '@/lib/utils/saved-credential';

export async function savedPlexCredential(): Promise<SavedCredential> {
  const config = getConfigService();
  return { secret: await config.get('plex_token'), url: await config.get('plex_url') };
}

export async function savedProwlarrCredential(): Promise<SavedCredential> {
  const config = getConfigService();
  return {
    secret: await config.get('prowlarr_api_key'),
    url: (await config.get('prowlarr_url')) || process.env.PROWLARR_URL,
  };
}

export async function savedAudiobookshelfCredential(): Promise<SavedCredential> {
  const config = getConfigService();
  return {
    secret: await config.get('audiobookshelf.api_token'),
    url: await config.get('audiobookshelf.server_url'),
  };
}

/** A saved download client's password/API key and URL (null-safe). */
export function savedClientCredential(client: { password?: string | null; url?: string | null } | null | undefined): SavedCredential {
  return { secret: client?.password, url: client?.url };
}
