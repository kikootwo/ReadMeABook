/**
 * Component: Setup Wizard Download Category Ownership
 * Documentation: documentation/phase3/download-clients.md
 *
 * Setup complete decides each client's category ownership itself, before anything is written.
 * The wizard's display-only `categoryInClient` and any sent `ownedCategory` are never trusted.
 */

import { getConfigService } from './config.service';
import { getDownloadClientManager, type DownloadClientConfig } from './download-client-manager.service';
import { CategoryChoiceError, resolveCategoryChoice, type CategoryChoice } from '@/lib/utils/download-category';

interface WizardClient {
  type: DownloadClientConfig['type'];
  name?: string;
  url: string;
  username?: string;
  password?: string;
  disableSSLVerify?: boolean;
  category?: string;
}

export async function resolveSetupCategories(
  clients: WizardClient[]
): Promise<{ ok: true; choices: CategoryChoice[] } | { ok: false; error: string }> {
  const list = (config: DownloadClientConfig) => getDownloadClientManager(getConfigService()).listCategories(config);
  const choices: CategoryChoice[] = [];
  for (const client of clients) {
    const listConfig: DownloadClientConfig = {
      id: 'setup-categories',
      type: client.type,
      name: client.name || client.type,
      enabled: true,
      url: client.url,
      username: client.username || '',
      password: client.password || '',
      disableSSLVerify: client.disableSSLVerify || false,
      remotePathMappingEnabled: false,
    };
    try {
      choices.push(await resolveCategoryChoice({ type: client.type, category: client.category }, () => list(listConfig)));
    } catch (error) {
      if (error instanceof CategoryChoiceError) return { ok: false, error: error.message };
      throw error;
    }
  }
  return { ok: true, choices };
}

/** The client as stored: the decided category and ownership, without the wizard's preview */
export function withSetupCategory<T extends Record<string, unknown>>(client: T, choice: CategoryChoice) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { categoryInClient, ownedCategory, ...rest } = client;
  return { ...rest, category: choice.category, ...(choice.ownedCategory && { ownedCategory: choice.ownedCategory }) };
}
