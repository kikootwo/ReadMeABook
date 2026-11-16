/**
 * Component: E2E fake-arr TLS sinkhole (Discord hosts)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * compose.yml maps discord.com, gateway.discord.gg, cdn.discordapp.com and discordapp.com
 * to fake-arr for RMAB, so any Discord connection lands here on :443. Each connection is
 * recorded (service 'sinkhole', host = the TLS SNI from the ClientHello, '' if none) and
 * closed. No TLS is spoken and no certificate exists: the point is to count attempts.
 * discord.js ignores HTTP(S)_PROXY, so an egress proxy would never see it.
 */

import net from 'node:net';

/** SNI host name from a TLS ClientHello record, or '' when absent or unparseable. */
export function parseSni(buf) {
  try {
    if (buf.length < 5 || buf[0] !== 0x16) return ''; // handshake record
    let p = 5;
    if (buf[p] !== 0x01) return ''; // ClientHello
    p += 4; // type + 3-byte length
    p += 2 + 32; // client_version + random
    p += 1 + buf[p]; // session id
    p += 2 + buf.readUInt16BE(p); // cipher suites
    p += 1 + buf[p]; // compression methods
    const extEnd = p + 2 + buf.readUInt16BE(p);
    p += 2;
    while (p + 4 <= extEnd && p + 4 <= buf.length) {
      const type = buf.readUInt16BE(p);
      const len = buf.readUInt16BE(p + 2);
      p += 4;
      if (type === 0x0000) {
        // server_name: list length (2), name type (1), name length (2), name
        const nameLen = buf.readUInt16BE(p + 3);
        return buf.subarray(p + 5, p + 5 + nameLen).toString('ascii');
      }
      p += len;
    }
  } catch {
    // truncated hello
  }
  return '';
}

/** Raw TCP listener: record one entry per connection (SNI from the first bytes), then close. */
export function createSinkhole(state) {
  return net.createServer((socket) => {
    let recorded = false;
    // Read now: after destroy() the socket no longer reports its addresses
    const listener = socket.localPort;
    const client = socket.remoteAddress || '';
    const record = (buf) => {
      if (recorded) return;
      recorded = true;
      state.record({
        service: 'sinkhole',
        listener,
        method: 'TLS',
        host: buf ? parseSni(buf) : '',
        path: '',
        query: {},
        headers: {},
        client,
      });
    };
    socket.setTimeout(3000, () => {
      record(null);
      socket.destroy();
    });
    socket.once('data', (buf) => {
      record(buf);
      socket.destroy();
    });
    socket.on('error', () => record(null));
    socket.on('close', () => record(null));
  });
}
