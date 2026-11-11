/**
 * Component: Test AudioSilo Connection
 * Documentation: documentation/features/audiosilo-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSetupIncompleteOrAdmin } from '@/lib/middleware/auth';
import { resolveSecretForUrl } from '@/lib/utils/saved-credential';
import { savedAudioSiloCredential } from '@/lib/services/saved-credentials.service';
import { readJsonBody } from '@/lib/utils/request-body';
import { apiSuffixHint, describeFetchError, fetchErrorDetails } from '@/lib/utils/fetch-error';
import { RMABLogger } from '@/lib/utils/logger';

interface SiloLibrary {
  id: number;
  name: string;
  kind: string;
}

const logger = RMABLogger.create('API.Setup.TestAudioSilo');

export async function POST(request: NextRequest) {
  return requireSetupIncompleteOrAdmin(request, async (req) => {
    try {
      const bodyResult = await readJsonBody(req);
      if (!bodyResult.ok) return bodyResult.response;
      const { serverUrl, apiToken } = bodyResult.data;

      if (!serverUrl) {
        return NextResponse.json({ error: 'Server URL is required' }, { status: 400 });
      }

      // A masked or empty key reuses the saved one, but only for the saved server URL
      const token = await resolveSecretForUrl({
        kind: 'audiosilo',
        url: serverUrl,
        supplied: apiToken,
        emptyMeansSaved: true,
        missingMessage: 'API key is required',
        loadSaved: savedAudioSiloCredential,
      });
      if (!token.ok) {
        return NextResponse.json({ error: token.error }, { status: 400 });
      }
      const effectiveApiToken = token.secret;
      const baseUrl = serverUrl.replace(/\/$/, '');

      // Listing libraries also validates the key
      const librariesUrl = `${baseUrl}/api/v1/libraries`;
      let libResponse: Response;
      try {
        libResponse = await fetch(librariesUrl, {
          headers: { Authorization: `Bearer ${effectiveApiToken}` },
        });
      } catch (error) {
        const secrets = [effectiveApiToken, apiToken];
        const reason = describeFetchError(error, librariesUrl, { service: 'AudioSilo', secrets });
        logger.error('AudioSilo connection test failed', { reason, ...fetchErrorDetails(error, librariesUrl, secrets) });
        return NextResponse.json({ error: reason }, { status: 500 });
      }

      if (!libResponse.ok) {
        const hint = apiSuffixHint(serverUrl);
        const keyHint = libResponse.status === 401 ? ' Check the API key (AudioSilo: Account → Personal API keys).' : '';
        return NextResponse.json(
          { error: `Connection failed: ${libResponse.status} ${libResponse.statusText}.${keyHint}${hint ? ` ${hint}` : ''}` },
          { status: 400 }
        );
      }

      let libData: { libraries?: unknown } | null;
      try {
        libData = await libResponse.json();
      } catch {
        return NextResponse.json(
          { error: 'Invalid response from AudioSilo server: the answer was not JSON. Check that the URL points at AudioSilo.' },
          { status: 400 }
        );
      }

      const rawLibraries = libData?.libraries;
      if (!Array.isArray(rawLibraries)) {
        return NextResponse.json({ error: 'Invalid response from AudioSilo server' }, { status: 400 });
      }

      // Name and version come from the public discovery endpoint; its failure is not fatal
      let serverInfo = { name: 'AudioSilo', version: 'Connected' };
      try {
        const infoResponse = await fetch(`${baseUrl}/api/v1/server`);
        if (infoResponse.ok) {
          const info = await infoResponse.json();
          serverInfo = { name: info?.name || 'AudioSilo', version: info?.version || 'Connected' };
        }
      } catch {
        // keep the defaults
      }

      const libraries = rawLibraries
        .filter((lib: SiloLibrary) => lib.kind === 'books')
        .map((lib: SiloLibrary) => ({ id: String(lib.id), name: lib.name, itemCount: 0 }));

      return NextResponse.json({ success: true, serverInfo, libraries });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Connection failed' },
        { status: 500 }
      );
    }
  });
}
