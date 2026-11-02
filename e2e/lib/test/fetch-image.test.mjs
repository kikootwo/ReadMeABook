/**
 * Component: E2E fetch-image tests: hostile registry descriptors are rejected before use
 * Documentation: documentation/testing/e2e-harness.md
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { validateDescriptor, blobPath, fetchToLayout, parseRef } from '../fetch-image.mjs';

const sha = (buf) => `sha256:${createHash('sha256').update(buf).digest('hex')}`;
const INDEX = 'application/vnd.oci.image.index.v1+json';
const MANIFEST = 'application/vnd.oci.image.manifest.v1+json';

// A fake registry whose responses each test sets.
let routes = {};
const hits = [];
let server;
let base;

before(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url);
    const r = routes[req.url];
    if (!r) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': r.type }).end(r.body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/v2/x/y`;
});
after(() => new Promise((r) => server.close(r)));

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-fetch-test-'));
}

test('validateDescriptor rejects hostile digests and sizes', () => {
  const good = { digest: `sha256:${'a'.repeat(64)}`, size: 10 };
  assert.equal(validateDescriptor(good), good);
  for (const digest of ['../../../etc/passwd', `sha256:${'a'.repeat(63)}`, `sha256:${'A'.repeat(64)}`, `sha512:${'a'.repeat(128)}`, `sha256:${'a'.repeat(64)}/..`, null, 42]) {
    assert.throws(() => validateDescriptor({ digest, size: 1 }), /invalid digest/, String(digest));
  }
  for (const size of [-1, 1.5, '10', 2 ** 60, undefined]) {
    assert.throws(() => validateDescriptor({ digest: good.digest, size }), /invalid size/, String(size));
  }
  assert.throws(() => blobPath('/tmp', 'sha256:../x'), /invalid digest/);
});

test('parseRef keeps registry/repo/tag/digest apart', () => {
  assert.deepEqual(parseRef(`ghcr.io/kikootwo/readmeabook:1.2.3@sha256:${'b'.repeat(64)}`), {
    registry: 'ghcr.io', repo: 'kikootwo/readmeabook', tag: '1.2.3', digest: `sha256:${'b'.repeat(64)}`,
  });
});

test('a hostile platform-manifest digest in the index is rejected before any further request', async () => {
  const index = JSON.stringify({ manifests: [{ digest: 'sha256:../../../../escape', size: 5, platform: { os: 'linux', architecture: 'amd64' } }] });
  routes = { '/v2/x/y/manifests/1.0': { type: INDEX, body: index } };
  hits.length = 0;
  const dir = tmpdir();
  await assert.rejects(fetchToLayout({ base, auth: 't', tag: '1.0', name: 'x/y:1.0', dir }), /invalid digest/);
  assert.deepEqual(hits, ['/v2/x/y/manifests/1.0']);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'blobs', 'sha256')), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a layer whose content does not match its declared size or digest is rejected', async () => {
  const layer = Buffer.from('layer-bytes');
  const config = Buffer.from('{}');
  const manifest = (layerDesc) => Buffer.from(JSON.stringify({ mediaType: MANIFEST, config: { digest: sha(config), size: config.length }, layers: [layerDesc] }));
  const serve = (m) => {
    routes = {
      '/v2/x/y/manifests/1.0': { type: MANIFEST, body: m },
      [`/v2/x/y/blobs/${sha(config)}`]: { type: 'application/octet-stream', body: config },
      [`/v2/x/y/blobs/${sha(layer)}`]: { type: 'application/octet-stream', body: layer },
    };
  };
  serve(manifest({ digest: sha(layer), size: layer.length + 1 }));
  await assert.rejects(fetchToLayout({ base, auth: 't', tag: '1.0', name: 'x/y:1.0', dir: tmpdir() }), /size mismatch/);
  serve(manifest({ digest: sha(Buffer.from('other')), size: layer.length }));
  routes[`/v2/x/y/blobs/${sha(Buffer.from('other'))}`] = { type: 'application/octet-stream', body: layer };
  await assert.rejects(fetchToLayout({ base, auth: 't', tag: '1.0', name: 'x/y:1.0', dir: tmpdir() }), /digest mismatch/);
  serve(manifest({ digest: sha(layer), size: layer.length }));
  const dir = tmpdir();
  await fetchToLayout({ base, auth: 't', tag: '1.0', name: 'x/y:1.0', dir });
  const written = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))[0];
  assert.equal(written.Layers[0], `blobs/sha256/${sha(layer).slice(7)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an invalid tag is rejected before any request', async () => {
  hits.length = 0;
  await assert.rejects(fetchToLayout({ base, auth: 't', tag: '../../x', name: 'n', dir: tmpdir() }), /invalid tag/);
  assert.equal(hits.length, 0);
});
