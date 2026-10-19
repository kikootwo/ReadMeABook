/**
 * Component: E2E public-image fetch fallback (registry HTTP API -> OCI layout -> docker load)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Used only when `docker pull` of a PUBLIC ghcr.io image fails (e.g. a daemon whose ghcr.io auth is
 * broken while anonymous HTTPS from the host works). Every blob is verified against its sha256
 * digest, so the loaded image is bit-identical to what `docker pull` would have produced.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const INDEX_TYPES = ['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json'];
const MANIFEST_TYPES = ['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'];
const NUL = String.fromCharCode(0);

export function parseRef(ref) {
  const m = /^([^/]+)\/([^:@]+)(?::([^@]+))?(?:@(sha256:[0-9a-f]{64}))?$/.exec(ref);
  if (!m) throw new Error(`cannot parse image ref ${ref}`);
  return { registry: m[1], repo: m[2], tag: m[3] || 'latest', digest: m[4] };
}

/** Minimal ustar writer (names < 100 chars, regular files only); avoids host tar quirks on Windows. */
function writeTar(root, relPaths, out) {
  const fd = fs.openSync(out, 'w');
  const chunk = Buffer.alloc(1 << 20);
  const octal = (n, width) => `${n.toString(8).padStart(width - 1, '0')}${NUL}`;
  try {
    for (const rel of relPaths) {
      const file = path.join(root, rel);
      const size = fs.statSync(file).size;
      const h = Buffer.alloc(512);
      h.write(rel.split(path.sep).join('/'), 0, 100, 'utf8');
      h.write(octal(0o644, 8), 100);
      h.write(octal(0, 8), 108);
      h.write(octal(0, 8), 116);
      h.write(octal(size, 12), 124);
      h.write(octal(Math.floor(Date.now() / 1000), 12), 136);
      h.write(' '.repeat(8), 148);
      h.write('0', 156);
      h.write(`ustar${NUL}00`, 257);
      let sum = 0;
      for (const b of h) sum += b;
      h.write(`${sum.toString(8).padStart(6, '0')}${NUL} `, 148);
      fs.writeSync(fd, h);
      const src = fs.openSync(file, 'r');
      let read;
      while ((read = fs.readSync(src, chunk, 0, chunk.length)) > 0) fs.writeSync(fd, chunk, 0, read);
      fs.closeSync(src);
      const pad = (512 - (size % 512)) % 512;
      if (pad) fs.writeSync(fd, Buffer.alloc(pad));
    }
    fs.writeSync(fd, Buffer.alloc(1024));
  } finally {
    fs.closeSync(fd);
  }
}

async function token(registry, repo) {
  if (registry !== 'ghcr.io') throw new Error(`fetch fallback only supports ghcr.io (got ${registry})`);
  const res = await fetch(`https://ghcr.io/token?scope=repository:${repo}:pull`);
  if (!res.ok) throw new Error(`token: HTTP ${res.status}`);
  return (await res.json()).token;
}

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const MAX_BLOB_BYTES = 8 * 1024 ** 3;

/**
 * Validate a registry descriptor BEFORE it is fetched or used in a path: the digest must be a plain
 * sha256 digest and the size a non-negative safe integer under the cap. Throws on anything else.
 */
export function validateDescriptor(desc, what = 'descriptor') {
  if (!desc || typeof desc !== 'object') throw new Error(`${what}: not an object`);
  if (typeof desc.digest !== 'string' || !DIGEST_RE.test(desc.digest)) throw new Error(`${what}: invalid digest ${JSON.stringify(desc.digest)}`);
  if (!Number.isSafeInteger(desc.size) || desc.size < 0 || desc.size > MAX_BLOB_BYTES) throw new Error(`${what}: invalid size ${JSON.stringify(desc.size)}`);
  return desc;
}

/** Local blob path for a validated digest (never derived from unvalidated input). */
export function blobPath(blobsDir, digest) {
  if (!DIGEST_RE.test(digest)) throw new Error(`invalid digest ${JSON.stringify(digest)}`);
  return path.join(blobsDir, digest.slice('sha256:'.length));
}

/**
 * GET a manifest (accept set) or blob. `ref` is either a validated descriptor {digest,size} or, for the
 * first manifest only, a tag. Content is checked against the descriptor's digest and size.
 */
async function getBlob(base, auth, ref, accept, dest) {
  const desc = typeof ref === 'string' ? null : validateDescriptor(ref);
  if (!desc && !TAG_RE.test(ref) && !DIGEST_RE.test(ref)) throw new Error(`invalid tag/digest ${JSON.stringify(ref)}`);
  const id = desc ? desc.digest : ref;
  const res = await fetch(`${base}/${accept ? 'manifests' : 'blobs'}/${id}`, {
    headers: { Authorization: `Bearer ${auth}`, ...(accept ? { Accept: accept.join(',') } : {}) },
  });
  if (!res.ok) throw new Error(`GET ${id}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const actual = `sha256:${createHash('sha256').update(buf).digest('hex')}`;
  if (DIGEST_RE.test(id) && actual !== id) throw new Error(`digest mismatch for ${id}: got ${actual}`);
  if (desc && buf.length !== desc.size) throw new Error(`size mismatch for ${id}: expected ${desc.size}, got ${buf.length}`);
  if (dest) fs.writeFileSync(dest, buf);
  return { buf, type: res.headers.get('content-type') || '', digest: actual };
}

/**
 * Fetch `<base>/manifests/<tagOrDigest>` (+ the platform manifest and every blob) into an OCI layout in
 * `dir`, validating every descriptor first. Exported for tests (a local fake registry as `base`).
 */
export async function fetchToLayout({ base, auth, tag, digest, name, dir, platform = { os: 'linux', architecture: 'amd64' }, log = () => {} }) {
  const blobs = path.join(dir, 'blobs', 'sha256');
  fs.mkdirSync(blobs, { recursive: true });
  {
    let top = await getBlob(base, auth, digest || tag, [...INDEX_TYPES, ...MANIFEST_TYPES]);
    let desc;
    if (INDEX_TYPES.some((t) => top.type.startsWith(t))) {
      const index = JSON.parse(top.buf.toString('utf8'));
      desc = (index.manifests || []).find((m) => m?.platform?.os === platform.os && m?.platform?.architecture === platform.architecture);
      if (!desc) throw new Error(`no ${platform.os}/${platform.architecture} manifest in ${name}`);
      validateDescriptor(desc, 'platform manifest');
      top = await getBlob(base, auth, desc, MANIFEST_TYPES, blobPath(blobs, desc.digest));
    } else {
      fs.writeFileSync(blobPath(blobs, top.digest), top.buf);
      desc = { mediaType: top.type, digest: top.digest, size: top.buf.length };
    }
    const manifest = JSON.parse(top.buf.toString('utf8'));
    if (!Array.isArray(manifest.layers)) throw new Error('manifest has no layers[]');
    const all = [manifest.config, ...manifest.layers].map((d, i) => validateDescriptor(d, i === 0 ? 'config' : `layer ${i}`));
    for (const [i, blob] of all.entries()) {
      log(`[e2e] fetch ${name}: blob ${i + 1}/${all.length} (${(blob.size / 1e6).toFixed(1)} MB)`);
      await getBlob(base, auth, blob, null, blobPath(blobs, blob.digest));
    }
    fs.writeFileSync(path.join(dir, 'oci-layout'), JSON.stringify({ imageLayoutVersion: '1.0.0' }));
    fs.writeFileSync(
      path.join(dir, 'index.json'),
      JSON.stringify({
        schemaVersion: 2,
        manifests: [{ mediaType: desc.mediaType || manifest.mediaType, digest: desc.digest, size: desc.size, annotations: { 'io.containerd.image.name': name, 'org.opencontainers.image.ref.name': tag } }],
      })
    );
    // docker-archive manifest alongside the OCI layout (the layout `docker save` emits): the classic
    // image store only reads manifest.json; layers may stay compressed.
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify([{ Config: `blobs/sha256/${all[0].digest.slice(7)}`, RepoTags: [name], Layers: all.slice(1).map((l) => `blobs/sha256/${l.digest.slice(7)}`) }])
    );
    return { blobs };
  }
}

/** Fetch `ref` (linux/amd64) and `docker load` it, tagged as `<registry>/<repo>:<tag>`. Returns that tag. */
export async function fetchAndLoad(ref, { platform = { os: 'linux', architecture: 'amd64' }, log = console.log } = {}) {
  const { registry, repo, tag, digest } = parseRef(ref);
  if (!TAG_RE.test(tag)) throw new Error(`invalid tag ${JSON.stringify(tag)}`);
  const base = `https://${registry}/v2/${repo}`;
  const auth = await token(registry, repo);
  const name = `${registry}/${repo}:${tag}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-e2e-oci-'));
  const tar = path.join(os.tmpdir(), `rmab-e2e-oci-${Date.now()}.tar`);
  try {
    const { blobs } = await fetchToLayout({ base, auth, tag, digest, name, dir, platform, log });
    writeTar(dir, ['oci-layout', 'index.json', 'manifest.json', ...fs.readdirSync(blobs).map((b) => path.join('blobs', 'sha256', b))], tar);
    const load = spawnSync('docker', ['load', '-i', tar], { encoding: 'utf8' });
    if (load.status !== 0) throw new Error(`docker load failed: ${load.stderr}`);
    log(`[e2e] ${load.stdout.trim()}`);
    if (spawnSync('docker', ['image', 'inspect', name], { stdio: 'ignore' }).status !== 0) {
      const id = /sha256:[0-9a-f]{64}/.exec(load.stdout)?.[0];
      if (!id || spawnSync('docker', ['tag', id, name], { stdio: 'inherit' }).status !== 0) throw new Error(`loaded image is not tagged ${name}`);
    }
    return name;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tar, { force: true });
  }
}
