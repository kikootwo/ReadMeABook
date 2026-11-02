/**
 * Component: E2E regression: request size limits on API route bodies
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Against the built image: request bodies over the sign-in (64 KB) and default (1 MB) limits get
 * a 413, sent chunked or with a declared Content-Length; a POST to a page path logs Next's
 * "Request body exceeded 64KB" (experimental.proxyClientMaxBodySize); health and sign-in still work.
 * The log check needs the exec bridge (untainted runs only).
 */

import http from 'node:http';
import net from 'node:net';
import { test, expect } from '@playwright/test';
import { urls, writeEvidence, authState, Rmab, stackLogsSync, execBridgeAvailable, EXEC_BRIDGE_SKIP } from '../../lib/harness';

const KB = 1024;
const results: Record<string, unknown> = {};

/** POST/PUT a JSON body of `bytes` bytes with Transfer-Encoding: chunked; stops writing once the response arrives. */
function sendChunked(path: string, bytes: number, opts: { method?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; body: string }> {
  const base = new URL(urls.rmab());
  const json = Buffer.from(JSON.stringify({ username: 'user', password: 'x'.repeat(bytes) }));
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: base.hostname,
      port: base.port || 80,
      path,
      method: opts.method ?? 'POST',
      headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked', ...opts.headers },
    });
    let answered = false;
    req.on('response', (res) => {
      answered = true;
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        req.destroy();
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', (error) => { if (!answered) reject(error); });
    let offset = 0;
    const write = () => {
      while (!answered && offset < json.length) {
        const chunk = json.subarray(offset, offset + 16 * KB);
        offset += chunk.length;
        if (!req.write(chunk)) return void req.once('drain', write);
      }
      if (!answered) req.end();
    };
    write();
  });
}

/** Headers only with a declared Content-Length; resolves with the status line. */
function declaredLength(path: string, length: number): Promise<string> {
  const base = new URL(urls.rmab());
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(base.port || 80), base.hostname, () => {
      socket.write(`POST ${path} HTTP/1.1\r\nHost: ${base.host}\r\nContent-Type: application/json\r\nContent-Length: ${length}\r\n\r\n`);
    });
    let data = '';
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`no response: ${data}`)); }, 10_000);
    socket.setEncoding('utf8');
    socket.on('data', (d) => {
      data += d;
      const line = data.split('\r\n')[0];
      if (data.includes('\r\n') && !line.includes(' 100 ')) {
        clearTimeout(timer);
        socket.destroy();
        resolve(line);
      }
    });
    socket.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

test.describe.configure({ mode: 'serial' });
test.afterAll(() => writeEvidence('request-size-limits/results.json', results));

test('a chunked body over the sign-in limit gets a 413', async () => {
  const r = await sendChunked('/api/auth/local/login', 128 * KB);
  results.chunkedSignIn = r;
  expect(r.status, r.body).toBe(413);
  expect(JSON.parse(r.body)).toMatchObject({ message: 'Request body is larger than 64 KB' });
});

test('a chunked body over the default limit gets a 413', async () => {
  const r = await sendChunked('/api/user/home-sections', 2048 * KB, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${authState().accessToken}` },
  });
  results.chunkedDefault = r;
  expect(r.status, r.body).toBe(413);
  expect(JSON.parse(r.body)).toMatchObject({ message: 'Request body is larger than 1 MB' });
});

test('a declared Content-Length over the limit gets a 413', async () => {
  const statusLine = await declaredLength('/api/auth/local/login', 64 * KB + 1);
  results.declaredLength = statusLine;
  expect(statusLine).toMatch(/^HTTP\/1\.1 413 /);
});

test('a POST to a page path logs the 64KB middleware body warning', async () => {
  test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
  const res = await fetch(`${urls.rmab()}/login`, { method: 'POST', body: 'x'.repeat(200 * KB), redirect: 'manual' });
  await res.arrayBuffer().catch(() => undefined);
  let line: string | undefined;
  for (let i = 0; i < 20 && !line; i++) {
    line = stackLogsSync('rmab').split(/\r?\n/).find((l) => l.includes('Request body exceeded 64KB'));
    if (!line) await new Promise((r) => setTimeout(r, 500));
  }
  results.pagePost = { status: res.status, logLine: line?.trim().slice(0, 300) ?? null };
  expect(line, 'Next body-copy warning in the rmab log').toBeTruthy();
});

test('health and a normal sign-in still work afterwards', async () => {
  const health = await fetch(`${urls.rmab()}/api/health`);
  const wrong = await fetch(`${urls.rmab()}/api/auth/local/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'nobody', password: 'wrong' }),
  });
  const admin = await Rmab.loginAdmin();
  results.after = { health: health.status, wrongPassword: wrong.status, adminLogin: Boolean(admin.token) };
  expect(health.status).toBe(200);
  expect(wrong.status).not.toBe(413);
  expect(admin.token).toBeTruthy();
});
