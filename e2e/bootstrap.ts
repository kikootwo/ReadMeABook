/**
 * Component: E2E bootstrap (Playwright globalSetup): ABS root + library, RMAB setup, tokens
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Idempotent: on an already-configured stack (upgrade verify phase) it only logs in.
 * Writes <evidence>/auth.json and <evidence>/storage-state.json for the specs.
 */

import fs from 'node:fs';
import { env, urls, waitFor, evidencePath, writeEvidence, Abs } from './lib/harness';

const ABS_LIBRARY_PATH = '/media/audiobooks';

async function bootstrapAbs() {
  await waitFor('Audiobookshelf /status', async () => (await fetch(`${urls.abs()}/status`)).ok, { timeoutMs: 120_000 });
  const status = await (await fetch(`${urls.abs()}/status`)).json();
  if (!status.isInit) {
    const res = await fetch(`${urls.abs()}/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newRoot: { username: env('ABS_ROOT_USER'), password: env('ABS_ROOT_PASSWORD') } }),
    });
    if (!res.ok) throw new Error(`ABS init: HTTP ${res.status} ${await res.text()}`);
  }
  const abs = await Abs.login();
  const libs = await abs.req<{ libraries: any[] }>('GET', '/api/libraries');
  let library = libs.libraries.find((l) => l.folders?.some((f: any) => f.fullPath === ABS_LIBRARY_PATH));
  if (!library) {
    library = await abs.req('POST', '/api/libraries', {
      name: 'Audiobooks',
      folders: [{ fullPath: ABS_LIBRARY_PATH }],
      icon: 'audiobookshelf',
      mediaType: 'book',
      provider: 'audible',
    });
  }
  // Long-lived API key for RMAB (ABS >= 2.26); fall back to the legacy user token on older images.
  let apiToken: string | undefined;
  try {
    const me = await abs.req<{ id: string }>('GET', '/api/me');
    const key = await abs.req<{ apiKey: { apiKey: string } }>('POST', '/api/api-keys', { name: `rmab-e2e-${Date.now()}`, userId: me.id, isActive: true });
    apiToken = key.apiKey?.apiKey;
  } catch {
    apiToken = undefined;
  }
  if (!apiToken) {
    const res = await fetch(`${urls.abs()}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: env('ABS_ROOT_USER'), password: env('ABS_ROOT_PASSWORD') }),
    });
    apiToken = (await res.json()).user?.token;
  }
  if (!apiToken) throw new Error('could not obtain an Audiobookshelf API token');
  return { libraryId: library.id as string, apiToken };
}

function setupPayload(abs: { libraryId: string; apiToken: string }) {
  const indexers = [
    { id: 1, name: 'E2E Torrents', priority: 10, audiobookCategories: [3030] },
    { id: 2, name: 'E2E Usenet', priority: 10, audiobookCategories: [3030] },
  ];
  const common = {
    audibleRegion: 'us',
    admin: { username: env('E2E_ADMIN_USER'), password: env('E2E_ADMIN_PASSWORD') },
    prowlarr: { url: 'http://fake-arr:9696', api_key: env('PROWLARR_API_KEY'), indexers },
    downloadClient: [
      { id: 'e2e-qbit', type: 'qbittorrent', name: 'qBittorrent (fake)', enabled: true, url: 'http://fake-arr:8081', username: env('QBIT_USER'), password: env('QBIT_PASS'), disableSSLVerify: false, remotePathMappingEnabled: false, category: 'readmeabook' },
      { id: 'e2e-sab', type: 'sabnzbd', name: 'SABnzbd (fake)', enabled: true, url: 'http://fake-arr:8085', password: env('SAB_API_KEY'), disableSSLVerify: false, remotePathMappingEnabled: false, category: 'readmeabook' },
    ],
    paths: { download_dir: '/downloads', media_dir: ABS_LIBRARY_PATH, metadata_tagging_enabled: true, chapter_merging_enabled: false },
  };
  if (env('E2E_BACKEND') === 'plex') {
    return { ...common, backendMode: 'plex', plex: { url: 'http://fake-arr:32400', token: env('PLEX_TOKEN'), audiobook_library_id: '1', trigger_scan_after_import: true } };
  }
  return {
    ...common,
    backendMode: 'audiobookshelf',
    authMethod: 'manual',
    // Required by setup/complete in manual mode (it 500s without it, after writing part of the config).
    registration: { require_admin_approval: true },
    audiobookshelf: { server_url: 'http://abs:80', api_token: abs.apiToken, library_id: abs.libraryId, trigger_scan_after_import: true },
  };
}

export default async function globalSetup() {
  const base = urls.rmab();
  await waitFor('fake-arr control', async () => (await fetch(`${urls.control()}/__control/health`)).ok, { timeoutMs: 60_000 });
  const abs = await bootstrapAbs();
  await waitFor('RMAB /api/health', async () => (await fetch(`${base}/api/health`)).ok, { timeoutMs: 300_000, intervalMs: 2_000 });

  const status = await (await fetch(`${base}/api/setup/status`)).json();
  let accessToken: string;
  let refreshToken: string | undefined;
  let user: unknown;
  if (!status.setupComplete) {
    const res = await fetch(`${base}/api/setup/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(setupPayload(abs)) });
    const body = await res.json();
    if (!res.ok || !body.accessToken) throw new Error(`setup/complete failed: HTTP ${res.status} ${JSON.stringify(body)}`);
    ({ accessToken, refreshToken, user } = body);
  } else {
    const res = await fetch(`${base}/api/auth/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: env('E2E_ADMIN_USER'), password: env('E2E_ADMIN_PASSWORD') }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`admin login failed: HTTP ${res.status} ${JSON.stringify(body)}`);
    ({ accessToken, refreshToken, user } = body);
  }

  writeEvidence('auth.json', { accessToken, refreshToken, absLibraryId: abs.libraryId, setupRan: !status.setupComplete });
  // Browser state for specs that start already signed in (the smoke spec signs in through the UI itself).
  fs.writeFileSync(
    evidencePath('storage-state.json'),
    JSON.stringify({ cookies: [], origins: [{ origin: base, localStorage: [
      { name: 'accessToken', value: accessToken },
      ...(refreshToken ? [{ name: 'refreshToken', value: refreshToken }] : []),
      ...(user ? [{ name: 'user', value: JSON.stringify(user) }] : []),
    ] }] })
  );
  // run.mjs maps "Playwright failed without this marker" to exit 2 (harness/bootstrap error, not a spec failure).
  writeEvidence('bootstrap-ok', new Date().toISOString());
}
