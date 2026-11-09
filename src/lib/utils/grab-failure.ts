/**
 * Component: Grab Failure Messages (which server answered a failed download-link fetch)
 * Documentation: documentation/phase3/download-clients.md
 *
 * The request message names Prowlarr or the indexer but never a host; the job log
 * line carries the host (scheme + host only, from DownloadSourceError.sourceUrl).
 */

import type { DownloadSourceError } from '@/lib/interfaces/download-client.interface';

const PROXY_LOGIN_HINT =
  "This usually means a reverse proxy asks for a login on Prowlarr's download links " +
  '(<Prowlarr URL>/<number>/download) while <Prowlarr URL>/api is open.';

const HOP_LABEL = {
  prowlarr: 'the configured Prowlarr address',
  redirect: 'a redirect target',
  direct: 'the download link host',
} as const;

/** Message for the request and the job error: no host, path, query or key */
export function grabFailedMessage(error: DownloadSourceError, indexer: string, title: string): string {
  const status = error.status;
  switch (error.failure?.hop) {
    case 'prowlarr': {
      const message = `Grab failed: Prowlarr returned HTTP ${status} for "${title}" (${indexer})`;
      return status === 401 || status === 403 ? `${message}. ${PROXY_LOGIN_HINT}` : message;
    }
    case 'redirect':
      return `Grab failed: ${indexer} returned HTTP ${status} for "${title}" after a redirect`;
    default:
      return `Grab failed: ${indexer} returned HTTP ${status} while fetching "${title}" through Prowlarr`;
  }
}

/** Job log detail for an admin: answering host (scheme + host), redirect count, auth scheme word */
export function grabFailureLogLine(error: DownloadSourceError): string {
  const failure = error.failure;
  if (!failure) return `Download link answered HTTP ${error.status} from ${error.sourceUrl}`;
  const redirects = `${failure.redirects} redirect${failure.redirects === 1 ? '' : 's'}`;
  const auth = failure.authScheme ? `WWW-Authenticate: ${failure.authScheme}` : 'no WWW-Authenticate';
  return `Download link answered HTTP ${error.status} from ${error.sourceUrl} (${HOP_LABEL[failure.hop]}) after ${redirects}; ${auth}`;
}
