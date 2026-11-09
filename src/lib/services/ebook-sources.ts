/**
 * Component: Ebook sources enabled (one server rule)
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * At least one ebook source is on: Anna's Archive, or indexer search. Legacy installs set only
 * `ebook_sidecar_enabled`; it counts as Anna's Archive while the new key is absent.
 */

import { getConfigService } from './config.service';

export async function ebookSourcesEnabled(): Promise<boolean> {
  const config = getConfigService();
  const [annasArchive, indexerSearch, legacy] = await Promise.all([
    config.get('ebook_annas_archive_enabled'),
    config.get('ebook_indexer_search_enabled'),
    config.get('ebook_sidecar_enabled'),
  ]);
  const annasOn = annasArchive === 'true' || (annasArchive == null && legacy === 'true');
  return annasOn || indexerSearch === 'true';
}
