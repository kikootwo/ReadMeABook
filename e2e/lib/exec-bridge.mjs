/**
 * Component: E2E exec bridge (UNTAINTED runs only): lets specs in the runner container `docker exec` into the stack
 * Documentation: documentation/testing/e2e-harness.md
 *
 * A host HTTP endpoint on 127.0.0.1 (Docker Desktop forwards host.docker.internal to it) with a per-run
 * token. One operation: run argv in one of the stack's services via `docker compose exec -T`, optional
 * user and stdin. Never started for --tainted runs; specs that need it skip with a clear message there.
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { composeArgs, childEnv, log } from './docker.mjs';

const SERVICES = new Set(['rmab', 'fake-arr', 'abs']);
const USER_RE = /^(?:\d{1,6}(?::\d{1,6})?|[a-z_][a-z0-9_-]{0,31})$/;
const MAX_BODY = 32 * 1024 * 1024;
const EXEC_TIMEOUT_MS = 180_000;

/**
 * Two operations: `exec` (default; argv in a service, optional user/stdin) and `logs` (read-only
 * `docker compose logs --no-color <service>`).
 */
export function validateExec(body) {
  if (!body || typeof body !== 'object') throw new Error('body must be an object');
  if (!SERVICES.has(body.service)) throw new Error(`service must be one of ${[...SERVICES].join(', ')}`);
  if (body.op === 'logs') return { op: 'logs', service: body.service };
  if (body.op !== undefined && body.op !== 'exec') throw new Error('op must be exec or logs');
  if (body.user !== undefined && !USER_RE.test(String(body.user))) throw new Error('invalid user');
  if (!Array.isArray(body.argv) || body.argv.length === 0 || body.argv.length > 64 || !body.argv.every((a) => typeof a === 'string' && a.length < 65536)) {
    throw new Error('argv must be 1-64 strings');
  }
  // spawn() throws synchronously on NUL bytes in argv; reject them as a 400 instead.
  if (body.argv.some((a) => a.includes('\0'))) throw new Error('argv must not contain NUL bytes');
  if (body.input !== undefined && typeof body.input !== 'string') throw new Error('input must be a string');
  return body;
}

function execInStack({ project, env, tainted }, { op, service, user, argv, input }) {
  return new Promise((resolve) => {
    const sub = op === 'logs' ? ['logs', '--no-color', service] : ['exec', '-T', ...(user ? ['-u', String(user)] : []), service, ...argv];
    // Nothing here may throw past the request handler: a crash would kill run.mjs before cleanup.
    let child;
    try {
      const args = composeArgs(project, sub, { tainted, overrides: env.E2E_OVERRIDES });
      child = spawn('docker', args, { env: childEnv(env), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ status: 127, stdout: '', stderr: `exec bridge: spawn failed: ${error.message}` });
      return;
    }
    const out = [];
    const err = [];
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => child.kill(), EXEC_TIMEOUT_MS);
    child.on('error', (error) => finish({ status: 127, stdout: Buffer.concat(out).toString('utf8'), stderr: `exec bridge: ${error.message}` }));
    child.stdin.on('error', () => {}); // EPIPE when the command exits before reading stdin
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('close', (code) => finish({ status: code ?? 1, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }));
    child.stdin.end(input ?? '');
  });
}

/** Start the bridge for an untainted stack. Returns { url (as seen from containers), token, close }. */
export async function startExecBridge({ project, env }) {
  if (env.E2E_TAINTED === '1') throw new Error('exec bridge refused: tainted run');
  const token = randomBytes(24).toString('hex');
  const want = Buffer.from(token);
  const server = http.createServer((req, res) => {
    const got = Buffer.from(String(req.headers['x-exec-token'] || ''));
    if (req.method !== 'POST' || req.url !== '/exec') return res.writeHead(404).end();
    if (got.length !== want.length || !timingSafeEqual(got, want)) return res.writeHead(401).end();
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(c);
    });
    req.on('end', async () => {
      let body;
      try {
        body = validateExec(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message }));
        return;
      }
      try {
        log(body.op === 'logs' ? `exec-bridge: logs ${body.service}` : `exec-bridge: ${body.service}${body.user ? ` -u ${body.user}` : ''} ${body.argv.join(' ').slice(0, 120)}`);
        const result = await execInStack({ project, env, tainted: false }, body);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
      } catch (error) {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message }));
      }
    });
    req.on('error', () => res.destroy());
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { url: `http://host.docker.internal:${port}`, port, token, close: () => new Promise((r) => server.close(r)) };
}
