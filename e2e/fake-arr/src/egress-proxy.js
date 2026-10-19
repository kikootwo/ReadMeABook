/**
 * Component: E2E allowlist egress proxy (tainted mode: the only way out of the internal stack network)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * RMAB's axios clients honour HTTP(S)_PROXY. For an https target axios sends an absolute-URI request
 * in plain HTTP to the proxy, which re-issues it over TLS; CONNECT tunnels are also supported.
 * Only hosts in EGRESS_ALLOW (exact match, port 443 or 80) are reached; everything else gets 403.
 * Every decision is logged as one JSON line (compose.log evidence).
 */

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { pathToFileURL } from 'node:url';

const DEFAULT_PORTS = new Set([80, 443]);

export function parseAllow(value) {
  return new Set(String(value || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
}

export function allowed(allow, host, port, ports = DEFAULT_PORTS) {
  return allow.has(String(host).toLowerCase()) && ports.has(port);
}

function log(entry) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), proxy: 'egress', ...entry }));
}

export function createEgressProxy(allow, ports = DEFAULT_PORTS) {
  const server = http.createServer((req, res) => {
    let target;
    try {
      target = new URL(req.url);
    } catch {
      log({ decision: 'deny', reason: 'not-a-proxy-request', url: req.url });
      res.writeHead(400).end('proxy requests only');
      return;
    }
    const port = Number(target.port) || (target.protocol === 'https:' ? 443 : 80);
    if (!['http:', 'https:'].includes(target.protocol) || !allowed(allow, target.hostname, port, ports)) {
      log({ decision: 'deny', method: req.method, host: target.hostname, port });
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end(`egress to ${target.hostname} is not allowlisted`);
      return;
    }
    log({ decision: 'allow', method: req.method, host: target.hostname, port, path: target.pathname });
    const headers = { ...req.headers, host: target.host };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    const client = target.protocol === 'https:' ? https : http;
    const upstream = client.request(target, { method: req.method, headers, timeout: 30_000 }, (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')));
    upstream.on('error', (error) => {
      log({ decision: 'error', host: target.hostname, error: error.message });
      if (!res.headersSent) res.writeHead(502).end('upstream error');
      else res.destroy();
    });
    req.pipe(upstream);
  });

  server.on('connect', (req, socket, head) => {
    const [host, portText] = String(req.url).split(':');
    const port = Number(portText);
    if (!allowed(allow, host, port, ports)) {
      log({ decision: 'deny', method: 'CONNECT', host, port });
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    log({ decision: 'allow', method: 'CONNECT', host, port });
    const upstream = net.connect(port, host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.setTimeout(60_000, () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const allow = parseAllow(process.env.EGRESS_ALLOW);
  const port = Number(process.env.EGRESS_PORT || 3128);
  createEgressProxy(allow).listen(port, '0.0.0.0', () => log({ decision: 'start', port, allow: [...allow] }));
  process.on('SIGTERM', () => process.exit(0));
}
