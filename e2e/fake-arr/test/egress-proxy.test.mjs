/**
 * Component: E2E allowlist egress proxy tests (node:test, host-run)
 * Documentation: documentation/testing/e2e-harness.md
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createEgressProxy, parseAllow, allowed } from '../src/egress-proxy.js';

let upstream;
let proxy;
let upPort;
let proxyPort;

const viaProxy = (target) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, method: 'GET', path: target, headers: { host: new URL(target).host } }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });

const connect = (hostPort) =>
  new Promise((resolve, reject) => {
    const sock = net.connect(proxyPort, '127.0.0.1', () => sock.write(`CONNECT ${hostPort} HTTP/1.1\r\nHost: ${hostPort}\r\n\r\n`));
    sock.once('data', (d) => {
      resolve(d.toString().split('\r\n')[0]);
      sock.destroy();
    });
    sock.on('error', reject);
  });

before(async () => {
  upstream = http.createServer((req, res) => res.end(`upstream saw ${req.url}`));
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  upPort = upstream.address().port;
  proxy = createEgressProxy(parseAllow('localhost'), new Set([upPort]));
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  proxyPort = proxy.address().port;
});

after(async () => {
  await new Promise((r) => proxy.close(r));
  await new Promise((r) => upstream.close(r));
});

test('allowlist is exact host + allowed port', () => {
  const allow = parseAllow(' API.audnex.us ,api.audible.com');
  assert.equal(allowed(allow, 'api.audnex.us', 443), true);
  assert.equal(allowed(allow, 'evil.api.audnex.us', 443), false);
  assert.equal(allowed(allow, 'api.audnex.us', 22), false);
});

test('absolute-URI requests to allowlisted hosts are forwarded; others get 403', async () => {
  const ok = await viaProxy(`http://localhost:${upPort}/books/B0TEST`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body, 'upstream saw /books/B0TEST');
  const denied = await viaProxy(`http://127.0.0.1:${upPort}/x`);
  assert.equal(denied.status, 403);
  const deniedHost = await viaProxy('http://host.docker.internal/x');
  assert.equal(deniedHost.status, 403);
});

test('CONNECT tunnels only to allowlisted host:port', async () => {
  assert.match(await connect(`localhost:${upPort}`), /^HTTP\/1\.1 200/);
  assert.match(await connect(`example.com:443`), /^HTTP\/1\.1 403/);
  assert.match(await connect(`localhost:22`), /^HTTP\/1\.1 403/);
});
