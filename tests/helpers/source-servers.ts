/**
 * Component: Real HTTP source servers for download-source tests
 * Documentation: documentation/phase3/download-clients.md
 *
 * Two local servers on different ports (= different origins): one plays the
 * configured Prowlarr, the other an indexer/tracker. Every request is recorded
 * with its headers so tests can assert where the Prowlarr key went.
 */

import { createHash } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http';

export type SourceServerName = 'prowlarr' | 'other';

export interface RecordedRequest {
  server: SourceServerName;
  /** Path + query as received */
  url: string;
  headers: IncomingHttpHeaders;
}

type Handler = (res: ServerResponse) => void;

export const TEST_PROWLARR_KEY = 'prowlarr-test-key-0123456789abcdef';

// Minimal trackerless torrent (same shape as the qBittorrent add-response tests)
const info = Buffer.from(`d6:lengthi1e4:name8:Book.txt12:piece lengthi16384e6:pieces20:${'x'.repeat(20)}e`);
export const TEST_TORRENT = Buffer.concat([Buffer.from('d4:info'), info, Buffer.from('e')]);
export const TEST_TORRENT_HASH = createHash('sha1').update(info).digest('hex');
export const TEST_MAGNET = `magnet:?xt=urn:btih:${TEST_TORRENT_HASH}&dn=Book`;
export const TEST_NZB = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?>\n<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb"><file subject="Book"></file></nzb>'
);

export const redirectTo = (location: string, status = 302): Handler => (res) => {
  res.writeHead(status, { Location: location }).end();
};
export const serve = (body: Buffer, contentType = 'application/octet-stream'): Handler => (res) => {
  res.writeHead(200, { 'Content-Type': contentType }).end(body);
};

export class SourceServers {
  readonly requests: RecordedRequest[] = [];
  prowlarrUrl = '';
  otherUrl = '';
  private readonly servers: Server[] = [];
  private readonly routes = new Map<string, Handler>();

  async start(): Promise<void> {
    this.prowlarrUrl = await this.listen('prowlarr');
    this.otherUrl = await this.listen('other');
  }

  async stop(): Promise<void> {
    await Promise.all(this.servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  }

  reset(): void {
    this.requests.length = 0;
    this.routes.clear();
  }

  /** Register a handler for `pathname` on one server (query is ignored for matching). */
  on(server: SourceServerName, pathname: string, handler: Handler): void {
    this.routes.set(`${server} ${pathname}`, handler);
  }

  /** Requests that carried the Prowlarr key in a header or the query string. */
  keyed(server?: SourceServerName): RecordedRequest[] {
    return this.requests.filter((r) =>
      (!server || r.server === server) &&
      (r.headers['x-api-key'] === TEST_PROWLARR_KEY || r.url.includes(TEST_PROWLARR_KEY))
    );
  }

  private async listen(name: SourceServerName): Promise<string> {
    const server = createServer((req, res) => {
      this.requests.push({ server: name, url: req.url || '', headers: req.headers });
      const pathname = new URL(req.url || '/', 'http://localhost').pathname;
      const handler = this.routes.get(`${name} ${pathname}`);
      if (handler) handler(res);
      else res.writeHead(404).end();
    });
    this.servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server port');
    return `http://127.0.0.1:${address.port}`;
  }
}
