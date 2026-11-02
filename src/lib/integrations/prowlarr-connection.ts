/**
 * Component: Prowlarr Connection Settings Resolver
 * Documentation: documentation/phase3/prowlarr.md
 *
 * Single source for the configured Prowlarr URL and API key
 * (database config → env → default URL).
 */

import { parseProwlarrBase, type ProwlarrBase } from '@/lib/utils/prowlarr-url';

export const PROWLARR_DEFAULT_URL = 'http://prowlarr:9696';

export interface ProwlarrConnection {
  baseUrl: string;
  apiKey: string | undefined;
  /** Parsed origin/base path, or null when the configured URL is not plain http(s) */
  base: ProwlarrBase | null;
}

export async function getProwlarrConnection(): Promise<ProwlarrConnection> {
  const { getConfigService } = await import('@/lib/services/config.service');
  const config = await getConfigService().getMany(['prowlarr_url', 'prowlarr_api_key']);
  const baseUrl = config.prowlarr_url || process.env.PROWLARR_URL || PROWLARR_DEFAULT_URL;
  const apiKey = config.prowlarr_api_key || process.env.PROWLARR_API_KEY || undefined;
  return { baseUrl, apiKey, base: parseProwlarrBase(baseUrl) };
}
